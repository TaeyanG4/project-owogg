import type { Context } from "hono";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  GameCreatorMeResponseSchema,
  GameCreatorApplyRequestSchema,
  GameCreatorApplicationRecordSchema,
  SandboxGameListResponseSchema,
  SandboxGameDetailResponseSchema,
  SandboxGameRecordSchema,
  toSandboxGameRecordResponse,
  SandboxGameVersionRecordSchema,
  SandboxGameUploadResponseSchema,
} from "@owogg/contracts";
import {
  SandboxGameUseCaseFailure,
  GameCreatorUseCaseFailure,
  canApplyForGameCreator,
  hasImplicitGameCreatorAccess,
} from "@owogg/core";
import type { BackblazeB2Config } from "@owogg/db";
import { createContainer } from "../container.js";
import { isTrustedAdminOrigin } from "../auth/admin.js";
import { resolveAdminEligibility, resolveEffectiveStaffRole } from "../auth/adminEligibility.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { SANDBOX_GAME_FAILURE_STATUS, SANDBOX_GAME_FAILURE_MESSAGE } from "./sandboxGameErrors.js";
import type { SandboxGameFailureStatus } from "./sandboxGameErrors.js";
import { GAME_CREATOR_FAILURE_STATUS, GAME_CREATOR_FAILURE_MESSAGE } from "./gameCreatorErrors.js";
import type { ApiEnv } from "./auth.js";

/** All five B2 values must be present or the upload path is treated as unconfigured — a partial
 * config (e.g. endpoint set but key missing) is far more likely to be a broken deploy than an
 * intentional half-setup, so it fails the same safe way as "nothing set at all". */
export function readB2Config(env: ApiEnv["Bindings"]): BackblazeB2Config | undefined {
  const { B2_ENDPOINT, B2_REGION, B2_BUCKET_NAME, B2_KEY_ID, B2_APPLICATION_KEY } = env;
  if (!B2_ENDPOINT || !B2_REGION || !B2_BUCKET_NAME || !B2_KEY_ID || !B2_APPLICATION_KEY) {
    return undefined;
  }
  return {
    endpoint: B2_ENDPOINT,
    region: B2_REGION,
    bucket: B2_BUCKET_NAME,
    keyId: B2_KEY_ID,
    applicationKey: B2_APPLICATION_KEY,
  };
}

/**
 * Game-Creator-facing sandbox game routes — powers the Game Creator Center's apply/upload/manage
 * flow. Deliberately gated by plain OwOGG session + active game_creator_access row, NOT the
 * elevated admin step-up session (adminSession.ts) — a creator who isn't also an admin must never
 * be forced through Google step-up + admin password just to upload a game. Admin/operator-only
 * actions (appoint creators, review applications, approve/reject versions, publish) live in
 * adminGameCreators.ts / adminSandboxGames.ts behind requireElevatedAdmin instead.
 *
 * GAME_CREATOR is a Program/Entitlement, never a Staff Role — see
 * packages/core/src/domain/staffRoles.ts and docs/AUTHORIZATION.md. This file (and its `/api/dev`
 * mount path, kept for URL stability) predates that distinction; nothing here grants or implies
 * any Staff Role.
 */
export const devGamesRouter = new Hono<ApiEnv>();

devGamesRouter.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method.toUpperCase())) {
    if (!isTrustedAdminOrigin(c.req.header("Origin"), c.env.FRONTEND_URL)) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "요청 출처를 확인할 수 없습니다." } },
        403,
      );
    }
  }
  await next();
});

interface DevSession {
  userId: number;
  hasGameCreatorAccess: boolean;
  isAdmin: boolean;
}

/** Resolves the caller's plain session + Game Creator access/admin standing in one pass. Returns
 * null when there is no valid session at all (caller responds 401); the boolean fields are false
 * rather than throwing when the session is valid but the user has neither, so callers can
 * distinguish "not logged in" from "logged in but not allowed here". */
async function resolveDevSession(c: Context<ApiEnv>): Promise<DevSession | null> {
  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId || !c.env?.DB) return null;

  const container = createContainer(c.env.DB);
  const sessionResult = await container.sessionRepo.findSession(sessionId);
  if (!sessionResult) return null;

  const userId = sessionResult.user.id;
  const [isActiveCreator, eligibility] = await Promise.all([
    container.gameCreatorUseCases.isActiveCreator(userId),
    resolveAdminEligibility(userId, c.env.ADMIN_USER_IDS, container.adminAccountUseCases),
  ]);

  // ADMIN/OPERATOR/SYSTEM_DEVELOPER hold Game Creator access implicitly (see
  // hasImplicitGameCreatorAccess's doc comment) — ORed with the real access-grant row, never a
  // replacement for it.
  const staffRole = resolveEffectiveStaffRole(eligibility);
  const hasGameCreatorAccess = isActiveCreator || hasImplicitGameCreatorAccess(staffRole);

  return { userId, hasGameCreatorAccess, isAdmin: eligibility.eligible };
}

function failureResponse(err: unknown): { body: unknown; status: SandboxGameFailureStatus } {
  if (!(err instanceof SandboxGameUseCaseFailure)) throw err;
  return {
    body: { error: { code: err.code, message: SANDBOX_GAME_FAILURE_MESSAGE[err.code] } },
    status: SANDBOX_GAME_FAILURE_STATUS[err.code],
  };
}

function gameCreatorFailureResponse(err: unknown): { body: unknown; status: 403 | 404 | 409 } {
  if (!(err instanceof GameCreatorUseCaseFailure)) throw err;
  return {
    body: { error: { code: err.code, message: GAME_CREATOR_FAILURE_MESSAGE[err.code] } },
    status: GAME_CREATOR_FAILURE_STATUS[err.code],
  };
}

// GET /api/dev/me
devGamesRouter.get("/me", async (c) => {
  const session = await resolveDevSession(c);
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  }
  const { gameCreatorUseCases } = createContainer(c.env.DB);
  const latestApplication = session.hasGameCreatorAccess
    ? null // already have access — an old application (if any) isn't relevant UI-wise
    : await gameCreatorUseCases.getMyApplication(session.userId);
  return c.json(
    GameCreatorMeResponseSchema.parse({
      hasAccess: session.hasGameCreatorAccess,
      canApply:
        !session.hasGameCreatorAccess &&
        latestApplication?.status !== "PENDING" &&
        canApplyForGameCreator(),
      latestApplication,
      isAdmin: session.isAdmin,
    }),
    200,
  );
});

// POST /api/dev/apply { message? } — self-serve Game Creator application.
devGamesRouter.post("/apply", async (c) => {
  const session = await resolveDevSession(c);
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = GameCreatorApplyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "요청 본문이 올바르지 않습니다." } },
      400,
    );
  }

  try {
    const { gameCreatorUseCases } = createContainer(c.env.DB);
    const application = await gameCreatorUseCases.apply(
      session.userId,
      parsed.data.message ?? null,
    );
    return c.json(GameCreatorApplicationRecordSchema.parse(application), 201);
  } catch (err) {
    const { body: errBody, status } = gameCreatorFailureResponse(err);
    return c.json(errBody, status);
  }
});

// POST /api/dev/apply/:id/withdraw — withdraws the caller's own PENDING application.
devGamesRouter.post("/apply/:id/withdraw", async (c) => {
  const session = await resolveDevSession(c);
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  }

  const applicationId = Number(c.req.param("id"));
  try {
    const { gameCreatorUseCases } = createContainer(c.env.DB);
    const application = await gameCreatorUseCases.withdrawApplication(
      applicationId,
      session.userId,
    );
    return c.json(GameCreatorApplicationRecordSchema.parse(application), 200);
  } catch (err) {
    const { body: errBody, status } = gameCreatorFailureResponse(err);
    return c.json(errBody, status);
  }
});

// GET /api/dev/games — the caller's own sandbox games, any review/visibility state.
devGamesRouter.get("/games", async (c) => {
  const session = await resolveDevSession(c);
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  }
  const { sandboxGameUseCases } = createContainer(c.env.DB);
  const games = await sandboxGameUseCases.listMine(session.userId);
  return c.json(
    SandboxGameListResponseSchema.parse({ games: games.map(toSandboxGameRecordResponse) }),
    200,
  );
});

// POST /api/dev/games/upload — drag-and-drop registration: a single ZIP whose root contains
// Creator Manifest v1 owogg.json creates the game and its first version in one call,
// instead of the manual "fill in a form, then separately upload" two-step flow. Multipart, field
// name "bundle" — same shape as /games/:id/versions. Rate limited on the same binding for the same
// reason (real B2 writes + decompression CPU per call).
devGamesRouter.post(
  "/games/upload",
  rateLimit({ name: "game-upload", binding: "GAME_UPLOAD_RATE_LIMITER" }),
  async (c) => {
    const session = await resolveDevSession(c);
    if (!session) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
    }
    if (!session.hasGameCreatorAccess) {
      return c.json(
        {
          error: { code: "FORBIDDEN", message: "게임 크리에이터 권한이 있는 사용자만 가능합니다." },
        },
        403,
      );
    }

    const container = createContainer(c.env.DB, readB2Config(c.env));
    if (!container.gameBundlesConfigured) {
      return c.json(
        {
          error: {
            code: "GAME_BUNDLES_NOT_CONFIGURED",
            message: "번들 저장소(Backblaze B2)가 아직 이 환경에 구성되지 않았습니다.",
          },
        },
        503,
      );
    }

    let body: Record<string, string | File>;
    try {
      body = await c.req.parseBody();
    } catch {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "multipart/form-data 요청이 아닙니다." } },
        400,
      );
    }

    const bundle = body.bundle;
    if (!(bundle instanceof File)) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "bundle 파일 필드가 필요합니다." } },
        400,
      );
    }

    try {
      const bytes = await bundle.arrayBuffer();
      const { game, version } = await container.sandboxGameUseCases.createGameFromBundle({
        developerUserId: session.userId,
        bytes,
        contentType: bundle.type || undefined,
      });
      return c.json(
        SandboxGameUploadResponseSchema.parse({ game: toSandboxGameRecordResponse(game), version }),
        201,
      );
    } catch (err) {
      const { body: errBody, status } = failureResponse(err);
      return c.json(errBody, status);
    }
  },
);

// GET /api/dev/games/:id — detail (owner or admin only).
devGamesRouter.get("/games/:id", async (c) => {
  const session = await resolveDevSession(c);
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  }
  const id = Number(c.req.param("id"));
  const { sandboxGameUseCases } = createContainer(c.env.DB);
  const game = await sandboxGameUseCases.getById(id);
  if (!game) {
    return c.json({ error: { code: "GAME_NOT_FOUND", message: "존재하지 않는 게임입니다." } }, 404);
  }
  if (game.developerUserId !== session.userId && !session.isAdmin) {
    return c.json({ error: { code: "FORBIDDEN", message: "접근 권한이 없습니다." } }, 403);
  }

  const [versions, auditLog] = await Promise.all([
    sandboxGameUseCases.listVersions(id),
    sandboxGameUseCases.getReviewAudit(id),
  ]);
  return c.json(
    SandboxGameDetailResponseSchema.parse({
      game: toSandboxGameRecordResponse(game),
      versions,
      auditLog,
    }),
    200,
  );
});

// POST /api/dev/games/:id/withdraw — creator self-service withdrawal of a not-yet-decided
// submission, releasing the review slot it was holding (see SANDBOX_GAME_POLICY.
// MAX_CONCURRENT_REVIEW_SLOTS). Owner only — an admin/operator who wants a submission gone uses
// decideVersion(REJECTED) instead, which is a real decision, not the creator's own withdrawal.
devGamesRouter.post("/games/:id/withdraw", async (c) => {
  const session = await resolveDevSession(c);
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  }

  const id = Number(c.req.param("id"));
  try {
    const { sandboxGameUseCases } = createContainer(c.env.DB);
    const game = await sandboxGameUseCases.withdrawSubmission({
      gameId: id,
      actingUserId: session.userId,
    });
    return c.json(SandboxGameRecordSchema.parse(toSandboxGameRecordResponse(game)), 200);
  } catch (err) {
    const { body: errBody, status } = failureResponse(err);
    return c.json(errBody, status);
  }
});

// DELETE /api/dev/games/:id — creator self-service full removal of their OWN game, only while it
// has never been approved (see SandboxGameUseCases.deleteOwnGame). No permission grant needed
// beyond ownership; once a version is approved, only ADMIN/OPERATOR can remove it from then on
// (DELETE /api/admin/sandbox-games/:id, sandbox_games.delete permission).
devGamesRouter.delete("/games/:id", async (c) => {
  const session = await resolveDevSession(c);
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  }

  const id = Number(c.req.param("id"));
  try {
    const { sandboxGameUseCases } = createContainer(c.env.DB);
    await sandboxGameUseCases.deleteOwnGame({ gameId: id, developerUserId: session.userId });
    return c.json({ deleted: true }, 200);
  } catch (err) {
    const { body: errBody, status } = failureResponse(err);
    return c.json(errBody, status);
  }
});

// POST /api/dev/games/:id/versions — multipart upload, field name "bundle". Owner or admin only.
// Rate limited on its own binding (see wrangler.jsonc GAME_UPLOAD_RATE_LIMITER) — this is a
// capacity/abuse guard against upload spam (each call costs real B2 writes + decompression CPU),
// deliberately separate from and much stricter than score-submit's RATE_LIMITER. It is NOT the
// submission-quota mechanism; that is SANDBOX_GAME_POLICY.MAX_CONCURRENT_REVIEW_SLOTS, enforced as
// a DB invariant regardless of what this middleware does.
devGamesRouter.post(
  "/games/:id/versions",
  rateLimit({ name: "game-upload", binding: "GAME_UPLOAD_RATE_LIMITER" }),
  async (c) => {
    const session = await resolveDevSession(c);
    if (!session) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
    }

    const container = createContainer(c.env.DB, readB2Config(c.env));
    if (!container.gameBundlesConfigured) {
      return c.json(
        {
          error: {
            code: "GAME_BUNDLES_NOT_CONFIGURED",
            message: "번들 저장소(Backblaze B2)가 아직 이 환경에 구성되지 않았습니다.",
          },
        },
        503,
      );
    }

    const gameId = Number(c.req.param("id"));
    let body: Record<string, string | File>;
    try {
      body = await c.req.parseBody();
    } catch {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "multipart/form-data 요청이 아닙니다." } },
        400,
      );
    }

    const bundle = body.bundle;
    if (!(bundle instanceof File)) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "bundle 파일 필드가 필요합니다." } },
        400,
      );
    }

    try {
      const bytes = await bundle.arrayBuffer();
      const version = await container.sandboxGameUseCases.uploadVersion({
        gameId,
        actingUserId: session.userId,
        isAdmin: session.isAdmin,
        bytes,
        contentType: bundle.type || undefined,
      });
      return c.json(SandboxGameVersionRecordSchema.parse(version), 201);
    } catch (err) {
      const { body: errBody, status } = failureResponse(err);
      return c.json(errBody, status);
    }
  },
);
