import { Hono } from "hono";
import {
  AdminGameListResponseSchema,
  AdminGameToggleRequestSchema,
  AdminOfficialGameDeleteResponseSchema,
  AdminOfficialGameUploadResponseSchema,
} from "@owogg/contracts";
import { OfficialGameDeleteFailure, OfficialGameUploadFailure } from "@owogg/core";
import { createContainer } from "../container.js";
import { isTrustedAdminOrigin } from "../auth/admin.js";
import {
  requireElevatedAdmin,
  isElevatedAdminResponse,
  requirePermission,
} from "../auth/adminSession.js";
import type { ApiEnv } from "./auth.js";
import { readB2Config } from "./devGames.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { purgePublicGameReadCache } from "./publicGameCache.js";

export const adminGamesRouter = new Hono<ApiEnv>();

adminGamesRouter.use("*", async (c, next) => {
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

// GET /api/admin/games — every known game merged with its live enable/disable override.
adminGamesRouter.get("/", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "games.moderate");
  if (denied) return denied;

  const { gameSettingsUseCases } = createContainer(c.env.DB);
  const games = await gameSettingsUseCases.listAll();

  return c.json(AdminGameListResponseSchema.parse({ games }), 200);
});

// POST /api/admin/games/upload — publishes a ZIP as an official OWOGG game. Authority comes only
// from this elevated admin route; no archive field or public creator endpoint can select OWOGG.
adminGamesRouter.post(
  "/upload",
  rateLimit({ name: "game-upload", binding: "GAME_UPLOAD_RATE_LIMITER" }),
  async (c) => {
    const admin = await requireElevatedAdmin(c);
    if (isElevatedAdminResponse(admin)) return admin;
    const denied = requirePermission(admin, "games.moderate");
    if (denied) return denied;

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
        { error: { code: "INVALID_REQUEST", message: "bundle ZIP 파일이 필요합니다." } },
        400,
      );
    }

    try {
      const result = await container.officialGameUploadUseCases.upload({
        bytes: await bundle.arrayBuffer(),
        contentType: bundle.type || undefined,
      });
      await purgePublicGameReadCache(c.req.url, [result.slug]);
      c.header("Clear-Site-Data", '"cache"');
      return c.json(AdminOfficialGameUploadResponseSchema.parse(result), 201);
    } catch (error) {
      if (!(error instanceof OfficialGameUploadFailure)) throw error;
      const status =
        error.code === "SLUG_CONFLICT" ? 409 : error.code === "PUBLISH_FAILED" ? 500 : 400;
      const message =
        error.code === "SLUG_CONFLICT"
          ? "동일한 slug가 사용자 게임 또는 삭제된 게임에 이미 사용되고 있습니다."
          : error.code === "PUBLISH_FAILED"
            ? "OWOGG 게임을 D1/B2에 게시하지 못했습니다."
            : "게임 ZIP 또는 owogg.json Creator Manifest v1이 올바르지 않습니다.";
      return c.json({ error: { code: error.code, message } }, status);
    }
  },
);

// DELETE /api/admin/games/:gameId — permanently removes an OWOGG-owned identity and all of its
// B2 bundle/canonical objects, then releases the slug for clean re-registration. Two permissions
// are required because this is stronger than the ordinary game kill switch.
adminGamesRouter.delete("/:gameId", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const moderateDenied = requirePermission(admin, "games.moderate");
  if (moderateDenied) return moderateDenied;
  const deleteDenied = requirePermission(admin, "sandbox_games.delete");
  if (deleteDenied) return deleteDenied;

  const container = createContainer(c.env.DB, readB2Config(c.env));
  if (!container.gameBundlesConfigured) {
    return c.json(
      {
        error: {
          code: "GAME_BUNDLES_NOT_CONFIGURED",
          message: "B2가 구성되지 않아 공식 게임 오브젝트를 안전하게 삭제할 수 없습니다.",
        },
      },
      503,
    );
  }

  try {
    const result = await container.officialGameLifecycleUseCases.deleteGame({
      slug: c.req.param("gameId"),
      actorAdminId: admin.userId,
    });
    await purgePublicGameReadCache(c.req.url, [result.slug]);
    c.header("Clear-Site-Data", '"cache"');
    return c.json(AdminOfficialGameDeleteResponseSchema.parse(result), 200);
  } catch (error) {
    if (!(error instanceof OfficialGameDeleteFailure)) throw error;
    if (error.code === "GAME_NOT_FOUND") {
      return c.json(
        {
          error: {
            code: error.code,
            message: "삭제할 OWOGG 공식 게임을 찾을 수 없습니다.",
          },
        },
        404,
      );
    }
    // prepareDeletion quarantines the identity before touching B2. Even when later cleanup fails,
    // evict public reads so the already-private game disappears immediately while an operator
    // retries the idempotent deletion.
    await purgePublicGameReadCache(c.req.url, [c.req.param("gameId")]);
    c.header("Clear-Site-Data", '"cache"');
    const message =
      error.code === "STORAGE_DELETE_FAILED"
        ? "게임은 즉시 비공개 처리됐지만 B2 정리가 완료되지 않았습니다. 같은 삭제 작업을 다시 시도해 주세요."
        : "B2 정리 후 D1 삭제를 완료하지 못했습니다. 같은 삭제 작업을 다시 시도해 주세요.";
    return c.json({ error: { code: error.code, message } }, 500);
  }
});

// POST /api/admin/games/:gameId/toggle — enable/disable a game without a deploy. Disabling also
// rejects new score submissions for it (see scores.ts) — this is a real kill switch, not just a
// catalog-visibility flag.
adminGamesRouter.post("/:gameId/toggle", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "games.moderate");
  if (denied) return denied;

  const gameId = c.req.param("gameId");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "요청 본문이 올바르지 않습니다." } },
      400,
    );
  }
  const parsed = AdminGameToggleRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "enabled 값이 필요합니다." } }, 400);
  }

  const { gameSettingsUseCases } = createContainer(c.env.DB);
  const result = await gameSettingsUseCases.setEnabled(
    gameId,
    parsed.data.enabled,
    parsed.data.reason ?? null,
    admin.userId,
  );

  if (!result.ok) {
    return c.json({ error: { code: result.code, message: "존재하지 않는 게임입니다." } }, 404);
  }

  await purgePublicGameReadCache(c.req.url, [gameId]);
  c.header("Clear-Site-Data", '"cache"');

  return c.json(
    {
      gameId: result.record.gameId,
      enabled: result.record.enabled,
      disabledReason: result.record.disabledReason,
    },
    200,
  );
});
