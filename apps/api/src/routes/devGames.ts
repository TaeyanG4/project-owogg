import type { Context } from "hono";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  GameCreatorMeResponseSchema,
  GameCreatorApplyRequestSchema,
  GameCreatorApplicationRecordSchema,
  SandboxGameListResponseSchema,
  SandboxGameDraftListResponseSchema,
  SandboxGameDetailResponseSchema,
  SandboxGameRecordSchema,
  toSandboxGameRecordResponse,
  SandboxGameVersionRecordSchema,
  SandboxGameUploadResponseSchema,
  SandboxGameReviewSubmitResponseSchema,
  SandboxGameReviewSubmitRequestSchema,
  SandboxGamePreviewSessionResponseSchema,
  SandboxGameBasicMetadataUpdateRequestSchema,
  GameContentUpdateRequestSchema,
  GameLogoUpdateResponseSchema,
} from "@owogg/contracts";
import {
  SandboxGameUseCaseFailure,
  GameCreatorUseCaseFailure,
  canApplyForGameCreator,
  hasImplicitGameCreatorAccess,
  GAME_PREVIEW_POLICY,
  signGamePreview,
  verifyGamePreview,
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
import { purgePublicGameReadCache } from "./publicGameCache.js";

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
 * elevated admin step-up session (adminSession.ts) — a Game Creator who isn't also an admin must never
 * be forced through Google step-up + admin password just to upload a game. Admin/operator-only
 * actions (appoint Game Creators, review applications, approve/reject versions, publish) live in
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
  const [isActiveGameCreator, eligibility] = await Promise.all([
    container.gameCreatorUseCases.isActiveGameCreator(userId),
    resolveAdminEligibility(userId, c.env.ADMIN_USER_IDS, container.adminAccountUseCases),
  ]);

  // ADMIN/OPERATOR/SYSTEM_DEVELOPER hold Game Creator access implicitly (see
  // hasImplicitGameCreatorAccess's doc comment) — ORed with the real access-grant row, never a
  // replacement for it.
  const staffRole = resolveEffectiveStaffRole(eligibility);
  const hasGameCreatorAccess = isActiveGameCreator || hasImplicitGameCreatorAccess(staffRole);

  return { userId, hasGameCreatorAccess, isAdmin: eligibility.eligible };
}

function failureResponse(err: unknown): { body: unknown; status: SandboxGameFailureStatus } {
  if (!(err instanceof SandboxGameUseCaseFailure)) throw err;
  return {
    body: {
      error: {
        code: err.code,
        message: SANDBOX_GAME_FAILURE_MESSAGE[err.code],
        ...(err.availableAt ? { availableAt: err.availableAt } : {}),
      },
    },
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

// GET /api/dev/games/drafts — private, fully-published versions that still require the creator's
// own preview confirmation. Declared before /games/:id so "drafts" can never be parsed as an id.
devGamesRouter.get("/games/drafts", async (c) => {
  const session = await resolveDevSession(c);
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  }
  const { sandboxGameUseCases } = createContainer(c.env.DB);
  const drafts = await sandboxGameUseCases.listDrafts(session.userId);
  return c.json(SandboxGameDraftListResponseSchema.parse({ drafts }), 200);
});

// POST /api/dev/games/:id/versions/:versionId/preview — issues a short-lived path capability for
// one exact READY draft. The token stays in the game-origin path so relative subresources inherit
// authorization without cookies or a public catalog entry.
devGamesRouter.post("/games/:id/versions/:versionId/preview", async (c) => {
  const session = await resolveDevSession(c);
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  }
  if (!c.env.GAME_SESSION_SECRET) {
    return c.json(
      {
        error: {
          code: "GAME_PREVIEW_NOT_CONFIGURED",
          message: "비공개 게임 미리보기가 아직 구성되지 않았습니다.",
        },
      },
      503,
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

  try {
    const gameId = Number(c.req.param("id"));
    const versionId = Number(c.req.param("versionId"));
    const version = await container.sandboxGameUseCases.getDraftForPreview({
      gameId,
      versionId,
      actingUserId: session.userId,
    });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const exp = nowSeconds + GAME_PREVIEW_POLICY.EXPIRY_SECONDS;
    const token = await signGamePreview(
      {
        userId: session.userId,
        gameId: version.gameId,
        versionId: version.id,
        nonce: crypto.randomUUID(),
        exp,
      },
      c.env.GAME_SESSION_SECRET,
    );
    return c.json(
      SandboxGamePreviewSessionResponseSchema.parse({
        gameId: version.gameId,
        versionId: version.id,
        previewToken: token,
        previewPath: `/preview/${token}/index.html`,
        expiresAt: new Date(exp * 1000).toISOString(),
      }),
      201,
    );
  } catch (error) {
    const { body, status } = failureResponse(error);
    return c.json(body, status);
  }
});

// POST /api/dev/games/:id/versions/:versionId/submit — the only creator path into the review
// queue. It atomically claims the initial quota slot and submits the exact version just previewed.
devGamesRouter.post("/games/:id/versions/:versionId/submit", async (c) => {
  const session = await resolveDevSession(c);
  if (!session) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = SandboxGameReviewSubmitRequestSchema.safeParse(body);
  if (!parsed.success || !c.env.GAME_SESSION_SECRET) {
    return c.json(
      {
        error: {
          code: "PREVIEW_REQUIRED",
          message: "현재 초안을 미리보기에서 확인한 뒤 제출해주세요.",
        },
      },
      409,
    );
  }
  const gameId = Number(c.req.param("id"));
  const versionId = Number(c.req.param("versionId"));
  const preview = await verifyGamePreview(parsed.data.previewToken, c.env.GAME_SESSION_SECRET);
  if (
    !preview.ok ||
    preview.payload.userId !== session.userId ||
    preview.payload.gameId !== gameId ||
    preview.payload.versionId !== versionId
  ) {
    return c.json(
      {
        error: {
          code: "PREVIEW_REQUIRED",
          message: "현재 초안을 미리보기에서 다시 확인한 뒤 제출해주세요.",
        },
      },
      409,
    );
  }

  try {
    const { sandboxGameUseCases } = createContainer(c.env.DB);
    const submitted = await sandboxGameUseCases.submitDraftForReview({
      gameId,
      versionId,
      actingUserId: session.userId,
    });
    return c.json(
      SandboxGameReviewSubmitResponseSchema.parse({
        game: toSandboxGameRecordResponse(submitted.game),
        version: submitted.version,
      }),
      200,
    );
  } catch (error) {
    const { body, status } = failureResponse(error);
    return c.json(body, status);
  }
});

// POST /api/dev/games/upload — drag-and-drop registration: a single ZIP whose root contains
// Game Creator Manifest v1 owogg.json creates the game and its first version in one call,
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

// POST /api/dev/games/:id/manifest — replaces only owogg.json by rebuilding a new immutable ZIP
// version from the latest valid source. The new USER version follows normal review rules.
devGamesRouter.post(
  "/games/:id/manifest",
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
    const body = await c.req.parseBody().catch(() => null);
    const manifest = body?.manifest;
    if (!(manifest instanceof File)) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "manifest 파일 필드가 필요합니다." } },
        400,
      );
    }
    try {
      const version = await container.sandboxGameUseCases.replaceManifest({
        gameId: Number(c.req.param("id")),
        actingUserId: session.userId,
        isAdmin: session.isAdmin,
        bytes: await manifest.arrayBuffer(),
      });
      return c.json(SandboxGameVersionRecordSchema.parse(version), 201);
    } catch (err) {
      const { body: errBody, status } = failureResponse(err);
      return c.json(errBody, status);
    }
  },
);

// PATCH /api/dev/games/:id/basic-metadata — edits the safe owogg.json.game subset and creates the
// same kind of reviewable immutable version as a standalone manifest replacement.
devGamesRouter.patch(
  "/games/:id/basic-metadata",
  rateLimit({ name: "game-upload", binding: "GAME_UPLOAD_RATE_LIMITER" }),
  async (c) => {
    const session = await resolveDevSession(c);
    if (!session) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = SandboxGameBasicMetadataUpdateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "수정할 게임 속성이 올바르지 않습니다." } },
        400,
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
    try {
      const version = await container.sandboxGameUseCases.updateBasicMetadataAsVersion({
        gameId: Number(c.req.param("id")),
        actingUserId: session.userId,
        isAdmin: session.isAdmin,
        metadata: parsed.data,
      });
      return c.json(SandboxGameVersionRecordSchema.parse(version), 201);
    } catch (err) {
      const { body: errBody, status } = failureResponse(err);
      return c.json(errBody, status);
    }
  },
);

// PATCH /api/dev/games/:id/content — inline game-page editor. Localized title/summary, tags, and
// optional Markdown become one reviewable immutable version so the creator cooldown is atomic.
devGamesRouter.patch(
  "/games/:id/content",
  rateLimit({ name: "game-upload", binding: "GAME_UPLOAD_RATE_LIMITER" }),
  async (c) => {
    const session = await resolveDevSession(c);
    if (!session) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
    }
    const parsed = GameContentUpdateRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "수정할 게임 정보가 올바르지 않습니다." } },
        400,
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
    try {
      const version = await container.sandboxGameUseCases.updateContentAsVersion({
        gameId: Number(c.req.param("id")),
        actingUserId: session.userId,
        isAdmin: session.isAdmin,
        content: parsed.data,
      });
      return c.json(SandboxGameVersionRecordSchema.parse(version), 201);
    } catch (error) {
      const { body, status } = failureResponse(error);
      return c.json(body, status);
    }
  },
);

// POST /api/dev/games/:id/logo — game-level artwork replacement, independent of a code version.
devGamesRouter.post(
  "/games/:id/logo",
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
    const body = await c.req.parseBody().catch(() => null);
    const logo = body?.logo;
    if (!(logo instanceof File)) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "logo 파일 필드가 필요합니다." } },
        400,
      );
    }
    try {
      const game = await container.sandboxGameUseCases.replaceLogo({
        gameId: Number(c.req.param("id")),
        actingUserId: session.userId,
        isAdmin: session.isAdmin,
        fileName: logo.name,
        bytes: await logo.arrayBuffer(),
      });
      await purgePublicGameReadCache(c.req.url, [game.slug], c.env.GAME_ORIGIN);
      c.header("Clear-Site-Data", '"cache"');
      return c.json(
        GameLogoUpdateResponseSchema.parse({
          gameId: game.id,
          slug: game.slug,
          hasLogo: true,
          updatedAt: game.updatedAt,
        }),
        200,
      );
    } catch (err) {
      const { body: errBody, status } = failureResponse(err);
      return c.json(errBody, status);
    }
  },
);

devGamesRouter.post(
  "/games/:id/description",
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
    const body = await c.req.parseBody().catch(() => null);
    const description = body?.description;
    if (!(description instanceof File)) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "description Markdown 또는 ZIP 파일이 필요합니다.",
          },
        },
        400,
      );
    }
    try {
      const version = await container.sandboxGameUseCases.replaceDescriptionPackage({
        gameId: Number(c.req.param("id")),
        actingUserId: session.userId,
        isAdmin: session.isAdmin,
        fileName: description.name,
        bytes: await description.arrayBuffer(),
      });
      return c.json(SandboxGameVersionRecordSchema.parse(version), 201);
    } catch (error) {
      const { body: errorBody, status } = failureResponse(error);
      return c.json(errorBody, status);
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

// POST /api/dev/games/:id/withdraw — Game Creator self-service withdrawal of a not-yet-decided
// submission, releasing the review slot it was holding (see SANDBOX_GAME_POLICY.
// MAX_CONCURRENT_REVIEW_SLOTS). Owner only — an admin/operator who wants a submission gone uses
// decideVersion(REJECTED) instead, which is a real decision, not the Game Creator's own withdrawal.
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

// DELETE /api/dev/games/:id — Game Creator self-service full removal of their OWN game, only while it
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
