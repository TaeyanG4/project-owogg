import { Hono } from "hono";
import {
  SandboxGameReviewQueueQuerySchema,
  SandboxGameReviewQueueResponseSchema,
  SandboxGameVersionDecisionRequestSchema,
  SandboxGameVersionRecordSchema,
  SandboxGameMetadataUpdateRequestSchema,
  SandboxGameBasicMetadataUpdateRequestSchema,
  GameContentUpdateRequestSchema,
  SandboxGameVisibilityUpdateRequestSchema,
  SandboxGameLiveVersionUpdateRequestSchema,
  SandboxGameRecordSchema,
  toSandboxGameRecordResponse,
  SandboxGameDetailResponseSchema,
  AdminSandboxGameListQuerySchema,
  AdminSandboxGameListResponseSchema,
  GameLogoUpdateResponseSchema,
} from "@owogg/contracts";
import { SandboxGameUseCaseFailure } from "@owogg/core";
import { createContainer } from "../container.js";
import { isTrustedAdminOrigin } from "../auth/admin.js";
import {
  requireElevatedAdmin,
  isElevatedAdminResponse,
  requirePermission,
} from "../auth/adminSession.js";
import { SANDBOX_GAME_FAILURE_STATUS, SANDBOX_GAME_FAILURE_MESSAGE } from "./sandboxGameErrors.js";
import type { SandboxGameFailureStatus } from "./sandboxGameErrors.js";
import { readB2Config } from "./devGames.js";
import type { ApiEnv } from "./auth.js";
import { purgePublicGameReadCache } from "./publicGameCache.js";
import { rateLimit } from "../middleware/rateLimit.js";

/** Admin-only review/publish surface for sandbox games — approve/reject an uploaded version,
 * adjust the generalized metadata (title/description/genre/XP/score config), and flip
 * PRIVATE/PUBLIC visibility. See docs/GAME_CREATION_GUIDE.md §3.6. */
export const adminSandboxGamesRouter = new Hono<ApiEnv>();

adminSandboxGamesRouter.use("*", async (c, next) => {
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

function failureResponse(err: unknown): { body: unknown; status: SandboxGameFailureStatus } {
  if (!(err instanceof SandboxGameUseCaseFailure)) throw err;
  return {
    body: { error: { code: err.code, message: SANDBOX_GAME_FAILURE_MESSAGE[err.code] } },
    status: SANDBOX_GAME_FAILURE_STATUS[err.code],
  };
}

// GET /api/admin/sandbox-games — every game (including soft-deleted rows), admin-facing
// "browse everything" list
// (regardless of visibility/developer) so an operator can find and toggle a game without already
// knowing its id. Registered before "/:id" is irrelevant here since this path has no id segment,
// but kept up top for readability alongside the other list endpoint.
adminSandboxGamesRouter.get("/", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "sandbox_games.review");
  if (denied) return denied;

  const parsed = AdminSandboxGameListQuerySchema.safeParse({
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
  });
  if (!parsed.success) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "잘못된 목록 조건입니다." } }, 400);
  }
  const { page, pageSize } = parsed.data;

  const { sandboxGameUseCases } = createContainer(c.env.DB);
  const result = await sandboxGameUseCases.listAllPage(pageSize, (page - 1) * pageSize);
  return c.json(
    AdminSandboxGameListResponseSchema.parse({
      entries: result.entries.map((entry) => ({
        game: toSandboxGameRecordResponse(entry.game),
        latestUploadedAt: entry.latestUploadedAt,
      })),
      total: result.total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
    }),
    200,
  );
});

// GET /api/admin/sandbox-games/review-queue?page=&pageSize=
adminSandboxGamesRouter.get("/review-queue", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "sandbox_games.review");
  if (denied) return denied;

  const parsed = SandboxGameReviewQueueQuerySchema.safeParse({
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
  });
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "잘못된 페이지 조건입니다." } },
      400,
    );
  }
  const { page, pageSize } = parsed.data;

  const { sandboxGameUseCases } = createContainer(c.env.DB);
  const { versions, total } = await sandboxGameUseCases.listPendingReview(
    pageSize,
    (page - 1) * pageSize,
  );

  // One lookup per distinct game in this page (not per version) — the review queue is a small,
  // low-traffic admin tool (pageSize capped at 100), so this stays well within a single request.
  const uniqueGameIds = [...new Set(versions.map((v) => v.gameId))];
  const games = await Promise.all(uniqueGameIds.map((id) => sandboxGameUseCases.getById(id)));
  const gameById = new Map(games.filter((g) => g !== null).map((g) => [g.id, g]));

  const entries = versions.flatMap((version) => {
    const game = gameById.get(version.gameId);
    if (!game) return []; // defensive — a game row vanishing mid-request should never happen
    return [
      {
        version,
        gameId: game.id,
        gameSlug: game.slug,
        gameTitle: game.title,
        developerUserId: game.developerUserId,
      },
    ];
  });

  return c.json(
    SandboxGameReviewQueueResponseSchema.parse({ entries, total, page, pageSize }),
    200,
  );
});

// GET /api/admin/sandbox-games/:id — full detail for the review UI.
adminSandboxGamesRouter.get("/:id", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "sandbox_games.review");
  if (denied) return denied;

  const id = Number(c.req.param("id"));
  const { sandboxGameUseCases } = createContainer(c.env.DB);
  const game = await sandboxGameUseCases.getById(id);
  if (!game) {
    return c.json({ error: { code: "GAME_NOT_FOUND", message: "존재하지 않는 게임입니다." } }, 404);
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

// POST /api/admin/sandbox-games/versions/:versionId/approve
adminSandboxGamesRouter.post("/versions/:versionId/approve", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "sandbox_games.review");
  if (denied) return denied;

  const versionId = Number(c.req.param("versionId"));
  try {
    const { sandboxGameUseCases } = createContainer(c.env.DB);
    const version = await sandboxGameUseCases.decideVersion({
      versionId,
      adminId: admin.userId,
      decision: "APPROVED",
      reason: null,
    });
    return c.json(SandboxGameVersionRecordSchema.parse(version), 200);
  } catch (err) {
    const { body, status } = failureResponse(err);
    return c.json(body, status);
  }
});

// POST /api/admin/sandbox-games/versions/:versionId/reject { reason }
adminSandboxGamesRouter.post("/versions/:versionId/reject", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "sandbox_games.review");
  if (denied) return denied;

  const versionId = Number(c.req.param("versionId"));
  const body = await c.req.json().catch(() => ({}));
  const parsed = SandboxGameVersionDecisionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "reason이 필요합니다." } }, 400);
  }

  try {
    const { sandboxGameUseCases } = createContainer(c.env.DB);
    const version = await sandboxGameUseCases.decideVersion({
      versionId,
      adminId: admin.userId,
      decision: "REJECTED",
      reason: parsed.data.reason ?? null,
    });
    return c.json(SandboxGameVersionRecordSchema.parse(version), 200);
  } catch (err) {
    const { body: errBody, status } = failureResponse(err);
    return c.json(errBody, status);
  }
});

// POST /api/admin/sandbox-games/versions/:versionId/revoke { reason? } — reverts an APPROVED
// decision back to PENDING_REVIEW ("승인 결정 자체를 취소") — an admin undoing a mistaken
// approval, distinct from toggling visibility (that only hides/shows an already-approved game) or
// rejecting (only valid while still pending). If this was the game's live version, visibility is
// forced back to PRIVATE in the same call — see SandboxGameUseCases.revokeApproval.
adminSandboxGamesRouter.post("/versions/:versionId/revoke", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "sandbox_games.review");
  if (denied) return denied;

  const versionId = Number(c.req.param("versionId"));
  const body = await c.req.json().catch(() => ({}));
  const parsed = SandboxGameVersionDecisionRequestSchema.safeParse(body);
  const reason = parsed.success ? (parsed.data.reason ?? null) : null;

  try {
    const { sandboxGameUseCases } = createContainer(c.env.DB);
    const version = await sandboxGameUseCases.revokeApproval({
      versionId,
      adminId: admin.userId,
      reason,
    });
    const game = await sandboxGameUseCases.getById(version.gameId);
    if (game) {
      await purgePublicGameReadCache(c.req.url, [game.slug], c.env.GAME_ORIGIN);
      c.header("Clear-Site-Data", '"cache"');
    }
    return c.json(SandboxGameVersionRecordSchema.parse(version), 200);
  } catch (err) {
    const { body: errBody, status } = failureResponse(err);
    return c.json(errBody, status);
  }
});

// POST /api/admin/sandbox-games/versions/:versionId/republish — re-runs the publish pipeline from
// the version's stored source archive. The recovery path for a version left FAILED/PUBLISHING by a
// transient storage error, without making the developer re-upload. Idempotent (published objects
// are immutable, so rewriting stores identical bytes).
adminSandboxGamesRouter.post("/versions/:versionId/republish", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "sandbox_games.review");
  if (denied) return denied;

  const versionId = Number(c.req.param("versionId"));
  try {
    const { sandboxGameUseCases } = createContainer(c.env.DB, readB2Config(c.env));
    const version = await sandboxGameUseCases.republishVersion(versionId);
    return c.json(SandboxGameVersionRecordSchema.parse(version), 200);
  } catch (err) {
    const { body, status } = failureResponse(err);
    return c.json(body, status);
  }
});

// PATCH /api/admin/sandbox-games/:id/live-version { versionId } — rollback / roll-forward. Points
// the game at a different already-approved, already-published version. Re-uploads nothing: each
// version keeps its own immutable object prefix, so this is a single metadata update.
adminSandboxGamesRouter.patch("/:id/live-version", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "sandbox_games.review");
  if (denied) return denied;

  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const parsed = SandboxGameLiveVersionUpdateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "versionId가 필요합니다." } }, 400);
  }

  try {
    const { sandboxGameUseCases } = createContainer(c.env.DB);
    const game = await sandboxGameUseCases.setLiveVersion(id, admin.userId, parsed.data.versionId);
    await purgePublicGameReadCache(c.req.url, [game.slug], c.env.GAME_ORIGIN);
    c.header("Clear-Site-Data", '"cache"');
    return c.json(SandboxGameRecordSchema.parse(toSandboxGameRecordResponse(game)), 200);
  } catch (err) {
    const { body: errBody, status } = failureResponse(err);
    return c.json(errBody, status);
  }
});

// PATCH /api/admin/sandbox-games/:id/metadata — legacy/admin operational metadata. New UI edits
// to owogg.json fields use /basic-metadata below so the source ZIP and review history remain the
// authority; this route stays compatible for score/XP and older administrative callers.
//
// Stage C-2: this now also keeps a B2 canonical document in sync (see SandboxGameUseCases.
// updateMetadata's own doc comment), which requires the same real Backblaze B2 config every
// bundle-upload route already requires — so this route checks `gameBundlesConfigured` and returns
// a clean 503 up front, exactly like devGames.ts's upload route, rather than ever silently
// degrading to a D1-only update when B2 isn't configured for this environment.
adminSandboxGamesRouter.patch("/:id/metadata", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "sandbox_games.review");
  if (denied) return denied;

  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const parsed = SandboxGameMetadataUpdateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "잘못된 메타데이터입니다." } }, 400);
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
    const game = await container.sandboxGameUseCases.updateMetadata(id, admin.userId, parsed.data);
    await purgePublicGameReadCache(c.req.url, [game.slug], c.env.GAME_ORIGIN);
    c.header("Clear-Site-Data", '"cache"');
    return c.json(SandboxGameRecordSchema.parse(toSandboxGameRecordResponse(game)), 200);
  } catch (err) {
    const { body: errBody, status } = failureResponse(err);
    return c.json(errBody, status);
  }
});

// PATCH /api/admin/sandbox-games/:id/basic-metadata — support edit of the safe owogg.json subset
// on a USER-owned game. It creates a normal immutable PENDING_REVIEW version; elevated access
// bypasses the creator cooldown but never changes server-owned publisher identity.
adminSandboxGamesRouter.patch(
  "/:id/basic-metadata",
  rateLimit({ name: "game-upload", binding: "GAME_UPLOAD_RATE_LIMITER" }),
  async (c) => {
    const admin = await requireElevatedAdmin(c);
    if (isElevatedAdminResponse(admin)) return admin;
    const denied = requirePermission(admin, "sandbox_games.review");
    if (denied) return denied;
    const parsed = SandboxGameBasicMetadataUpdateRequestSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
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
        actingUserId: admin.userId,
        isAdmin: true,
        metadata: parsed.data,
      });
      return c.json(SandboxGameVersionRecordSchema.parse(version), 201);
    } catch (err) {
      const { body: errBody, status } = failureResponse(err);
      return c.json(errBody, status);
    }
  },
);

adminSandboxGamesRouter.patch(
  "/:id/content",
  rateLimit({ name: "game-upload", binding: "GAME_UPLOAD_RATE_LIMITER" }),
  async (c) => {
    const admin = await requireElevatedAdmin(c);
    if (isElevatedAdminResponse(admin)) return admin;
    const denied = requirePermission(admin, "sandbox_games.review");
    if (denied) return denied;
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
        { error: { code: "GAME_BUNDLES_NOT_CONFIGURED", message: "B2가 구성되지 않았습니다." } },
        503,
      );
    }
    try {
      const version = await container.sandboxGameUseCases.updateContentAsVersion({
        gameId: Number(c.req.param("id")),
        actingUserId: admin.userId,
        isAdmin: true,
        content: parsed.data,
      });
      return c.json(SandboxGameVersionRecordSchema.parse(version), 201);
    } catch (error) {
      const { body, status } = failureResponse(error);
      return c.json(body, status);
    }
  },
);

// Admin support uploads use the same core version/manifest/logo operations as the Game Creator
// Center. Publisher ownership remains USER; elevated access only acts on the owner's behalf.
adminSandboxGamesRouter.post(
  "/:id/versions",
  rateLimit({ name: "game-upload", binding: "GAME_UPLOAD_RATE_LIMITER" }),
  async (c) => {
    const admin = await requireElevatedAdmin(c);
    if (isElevatedAdminResponse(admin)) return admin;
    const denied = requirePermission(admin, "sandbox_games.review");
    if (denied) return denied;
    const container = createContainer(c.env.DB, readB2Config(c.env));
    if (!container.gameBundlesConfigured) {
      return c.json(
        { error: { code: "GAME_BUNDLES_NOT_CONFIGURED", message: "B2가 구성되지 않았습니다." } },
        503,
      );
    }
    const body = await c.req.parseBody().catch(() => null);
    const bundle = body?.bundle;
    if (!(bundle instanceof File)) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "bundle ZIP 파일이 필요합니다." } },
        400,
      );
    }
    try {
      const version = await container.sandboxGameUseCases.uploadVersion({
        gameId: Number(c.req.param("id")),
        actingUserId: admin.userId,
        isAdmin: true,
        bytes: await bundle.arrayBuffer(),
        contentType: bundle.type || undefined,
      });
      return c.json(SandboxGameVersionRecordSchema.parse(version), 201);
    } catch (err) {
      const { body: errBody, status } = failureResponse(err);
      return c.json(errBody, status);
    }
  },
);

adminSandboxGamesRouter.post(
  "/:id/manifest",
  rateLimit({ name: "game-upload", binding: "GAME_UPLOAD_RATE_LIMITER" }),
  async (c) => {
    const admin = await requireElevatedAdmin(c);
    if (isElevatedAdminResponse(admin)) return admin;
    const denied = requirePermission(admin, "sandbox_games.review");
    if (denied) return denied;
    const container = createContainer(c.env.DB, readB2Config(c.env));
    if (!container.gameBundlesConfigured) {
      return c.json(
        { error: { code: "GAME_BUNDLES_NOT_CONFIGURED", message: "B2가 구성되지 않았습니다." } },
        503,
      );
    }
    const body = await c.req.parseBody().catch(() => null);
    const manifest = body?.manifest;
    if (!(manifest instanceof File)) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "manifest 파일이 필요합니다." } },
        400,
      );
    }
    try {
      const version = await container.sandboxGameUseCases.replaceManifest({
        gameId: Number(c.req.param("id")),
        actingUserId: admin.userId,
        isAdmin: true,
        bytes: await manifest.arrayBuffer(),
      });
      return c.json(SandboxGameVersionRecordSchema.parse(version), 201);
    } catch (err) {
      const { body: errBody, status } = failureResponse(err);
      return c.json(errBody, status);
    }
  },
);

adminSandboxGamesRouter.post(
  "/:id/description",
  rateLimit({ name: "game-upload", binding: "GAME_UPLOAD_RATE_LIMITER" }),
  async (c) => {
    const admin = await requireElevatedAdmin(c);
    if (isElevatedAdminResponse(admin)) return admin;
    const denied = requirePermission(admin, "sandbox_games.review");
    if (denied) return denied;
    const container = createContainer(c.env.DB, readB2Config(c.env));
    if (!container.gameBundlesConfigured) {
      return c.json(
        { error: { code: "GAME_BUNDLES_NOT_CONFIGURED", message: "B2가 구성되지 않았습니다." } },
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
            message: "description.md 또는 설명 ZIP 파일이 필요합니다.",
          },
        },
        400,
      );
    }
    try {
      const version = await container.sandboxGameUseCases.replaceDescriptionPackage({
        gameId: Number(c.req.param("id")),
        actingUserId: admin.userId,
        isAdmin: true,
        fileName: description.name,
        bytes: await description.arrayBuffer(),
      });
      return c.json(SandboxGameVersionRecordSchema.parse(version), 201);
    } catch (err) {
      const { body: errBody, status } = failureResponse(err);
      return c.json(errBody, status);
    }
  },
);

adminSandboxGamesRouter.post(
  "/:id/logo",
  rateLimit({ name: "game-upload", binding: "GAME_UPLOAD_RATE_LIMITER" }),
  async (c) => {
    const admin = await requireElevatedAdmin(c);
    if (isElevatedAdminResponse(admin)) return admin;
    const denied = requirePermission(admin, "sandbox_games.review");
    if (denied) return denied;
    const container = createContainer(c.env.DB, readB2Config(c.env));
    if (!container.gameBundlesConfigured) {
      return c.json(
        { error: { code: "GAME_BUNDLES_NOT_CONFIGURED", message: "B2가 구성되지 않았습니다." } },
        503,
      );
    }
    const body = await c.req.parseBody().catch(() => null);
    const logo = body?.logo;
    if (!(logo instanceof File)) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "logo 파일이 필요합니다." } },
        400,
      );
    }
    try {
      const game = await container.sandboxGameUseCases.replaceLogo({
        gameId: Number(c.req.param("id")),
        actingUserId: admin.userId,
        isAdmin: true,
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

// PATCH /api/admin/sandbox-games/:id/visibility { visibility } — the actual "go live" switch.
adminSandboxGamesRouter.patch("/:id/visibility", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "sandbox_games.review");
  if (denied) return denied;

  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const parsed = SandboxGameVisibilityUpdateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "visibility가 필요합니다." } }, 400);
  }

  try {
    const { sandboxGameUseCases } = createContainer(c.env.DB);
    const game = await sandboxGameUseCases.setVisibility(id, admin.userId, parsed.data.visibility);
    await purgePublicGameReadCache(c.req.url, [game.slug], c.env.GAME_ORIGIN);
    c.header("Clear-Site-Data", '"cache"');
    return c.json(SandboxGameRecordSchema.parse(toSandboxGameRecordResponse(game)), 200);
  } catch (err) {
    const { body: errBody, status } = failureResponse(err);
    return c.json(errBody, status);
  }
});

// DELETE /api/admin/sandbox-games/:id — soft delete (migration 0026). Deliberately gated on its
// own permission (sandbox_games.delete), not sandbox_games.review — MODERATOR has the latter but
// must not have this (2026-08-18 product decision: only ADMIN/OPERATOR).
adminSandboxGamesRouter.delete("/:id", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "sandbox_games.delete");
  if (denied) return denied;

  const id = Number(c.req.param("id"));
  try {
    const { sandboxGameUseCases } = createContainer(c.env.DB);
    const game = await sandboxGameUseCases.deleteGame({ gameId: id, actorAdminId: admin.userId });
    await purgePublicGameReadCache(c.req.url, [game.slug], c.env.GAME_ORIGIN);
    c.header("Clear-Site-Data", '"cache"');
    return c.json(SandboxGameRecordSchema.parse(toSandboxGameRecordResponse(game)), 200);
  } catch (err) {
    const { body: errBody, status } = failureResponse(err);
    return c.json(errBody, status);
  }
});

// DELETE /api/admin/sandbox-games/:id/purge — permanently erases already-soft-deleted draft/test
// data only. Any durable D1 slug reservation returns 409 even if review/audit rows were removed;
// prevents historical score/XP/favorite records from attaching to unrelated content.
adminSandboxGamesRouter.delete("/:id/purge", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "sandbox_games.delete");
  if (denied) return denied;

  const id = Number(c.req.param("id"));
  try {
    const { sandboxGameUseCases } = createContainer(c.env.DB);
    const existing = await sandboxGameUseCases.getById(id);
    await sandboxGameUseCases.purgeGame({ gameId: id, actorAdminId: admin.userId });
    await purgePublicGameReadCache(c.req.url, existing ? [existing.slug] : [], c.env.GAME_ORIGIN);
    c.header("Clear-Site-Data", '"cache"');
    return c.json({ purged: true }, 200);
  } catch (err) {
    const { body: errBody, status } = failureResponse(err);
    return c.json(errBody, status);
  }
});
