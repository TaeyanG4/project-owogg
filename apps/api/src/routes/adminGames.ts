import { Hono } from "hono";
import {
  AdminOfficialMultiplayerProfileResponseSchema,
  AdminOfficialMultiplayerProfileUpdateRequestSchema,
  AdminGameListResponseSchema,
  AdminGameListQuerySchema,
  AdminGameToggleRequestSchema,
  AdminOfficialGameDeleteResponseSchema,
  AdminOfficialGameUploadResponseSchema,
  SandboxGameBasicMetadataUpdateRequestSchema,
  GameLogoUpdateResponseSchema,
} from "@owogg/contracts";
import {
  OfficialGameDeleteFailure,
  OfficialGameUploadFailure,
  type OfficialMultiplayerProfileFailureCode,
  type OfficialMultiplayerProfileResult,
} from "@owogg/core";
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

function multiplayerProfileFailure(code: OfficialMultiplayerProfileFailureCode) {
  const status = code === "GAME_NOT_FOUND" || code === "PROFILE_NOT_FOUND" ? 404 : 409;
  const message =
    code === "GAME_NOT_FOUND"
      ? "현재 게시된 exact 게임 버전을 찾을 수 없습니다."
      : code === "PROFILE_NOT_FOUND"
        ? "현재 live 버전에 비활성화할 멀티플레이 프로필이 없습니다."
        : code === "OFFICIAL_GAME_REQUIRED"
          ? "OWOGG 공식 게임만 이 관리 경로에서 프로필을 승인할 수 있습니다."
          : code === "PRESET_GAME_MISMATCH"
            ? "OMOK_V1 프로필은 official-omok 게임에만 적용할 수 있습니다."
            : code === "MULTIPLAYER_MANIFEST_REQUIRED"
              ? "owogg.json이 멀티플레이 게임으로 선언되어 있지 않습니다."
              : code === "LEADERBOARD_FORBIDDEN"
                ? "멀티플레이 게임은 score, leaderboard, client completion XP를 선언할 수 없습니다."
                : "현재 live 버전의 멀티플레이 프로필 상태가 충돌합니다.";
  return { body: { error: { code, message } }, status } as const;
}

function multiplayerProfileResponse(
  result: Extract<OfficialMultiplayerProfileResult, { ok: true }>,
) {
  const profile = result.record?.profile;
  return AdminOfficialMultiplayerProfileResponseSchema.parse({
    gameSlug: result.gameSlug,
    gameVersionId: result.gameVersionId,
    preset: "OMOK_V1",
    status: !result.record ? "NONE" : profile?.enabled ? "ENABLED" : "DISABLED",
    profile:
      !result.record || !profile
        ? null
        : {
            id: result.record.id,
            profileRevision: profile.profileRevision,
            enabled: profile.enabled,
            rulesetKey: profile.rulesetKey,
            rulesetRevision: profile.rulesetRevision,
            resolvedClass: profile.resolvedClass,
            simulationModel: profile.simulationModel,
            reconnectPolicy: profile.reconnectPolicy,
            minPlayers: profile.minPlayers,
            maxPlayers: profile.maxPlayers,
            allowedVisibility: profile.allowedVisibility,
            allowedJoinPolicies: profile.allowedJoinPolicies,
            rewardPolicyId: profile.rewardPolicyId,
            leaderboardEnabled: false,
            updatedAt: result.record.updatedAt,
          },
  });
}

function officialUpdateFailure(error: unknown) {
  if (!(error instanceof OfficialGameUploadFailure)) throw error;
  const status =
    error.code === "GAME_NOT_FOUND" || error.code === "VERSION_NOT_FOUND"
      ? 404
      : error.code === "SLUG_CONFLICT"
        ? 409
        : error.code === "PUBLISH_FAILED"
          ? 500
          : 422;
  const message =
    error.code === "GAME_NOT_FOUND"
      ? "존재하는 OWOGG 공식 게임을 찾을 수 없습니다."
      : error.code === "VERSION_NOT_FOUND"
        ? "부분 수정의 기준이 될 공식 게임 버전을 찾을 수 없습니다."
        : error.code === "SLUG_CONFLICT"
          ? "동일한 slug가 사용자 게임 또는 삭제된 게임에 이미 사용되고 있습니다."
          : error.code === "PUBLISH_FAILED"
            ? "OWOGG 게임 변경사항을 D1/B2에 게시하지 못했습니다."
            : error.code === "LOGO_INVALID"
              ? "png, jpg, jpeg, webp, svg 형식의 로고 파일이 필요합니다."
              : error.code === "LOGO_TOO_LARGE"
                ? "로고 이미지 용량이 최대 허용치를 초과했습니다."
                : "게임 ZIP 또는 owogg.json Game Creator Manifest v1이 올바르지 않습니다.";
  return { body: { error: { code: error.code, message } }, status } as const;
}

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

  const parsed = AdminGameListQuerySchema.safeParse({
    page: c.req.query("page"),
    pageSize: c.req.query("pageSize"),
  });
  if (!parsed.success) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "잘못된 목록 조건입니다." } }, 400);
  }

  const { gameSettingsUseCases } = createContainer(c.env.DB, readB2Config(c.env));
  const result = await gameSettingsUseCases.listPage({
    publisherType: "OWOGG",
    ...parsed.data,
  });

  return c.json(AdminGameListResponseSchema.parse(result), 200);
});

// Trusted control-plane approval for the current OWOGG live version. A ZIP cannot invoke this or
// choose server authority; a managed elevated admin explicitly activates the allowlisted preset.
adminGamesRouter.get("/:gameId/multiplayer-profile", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "games.moderate");
  if (denied) return denied;
  const container = createContainer(c.env.DB, readB2Config(c.env));
  if (!container.gameBundlesConfigured) {
    return c.json(
      { error: { code: "GAME_BUNDLES_NOT_CONFIGURED", message: "B2 구성이 필요합니다." } },
      503,
    );
  }
  const result = await container.officialMultiplayerProfileUseCases.get(c.req.param("gameId"));
  if (!result.ok) {
    const failure = multiplayerProfileFailure(result.code);
    return c.json(failure.body, failure.status);
  }
  return c.json(multiplayerProfileResponse(result), 200);
});

adminGamesRouter.post("/:gameId/multiplayer-profile", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "games.moderate");
  if (denied) return denied;
  if (!admin.account) {
    return c.json(
      {
        error: {
          code: "MANAGED_ADMIN_REQUIRED",
          message: "감사 가능한 관리 계정으로 로그인해야 멀티플레이 프로필을 변경할 수 있습니다.",
        },
      },
      403,
    );
  }
  const body = await c.req.json().catch(() => null);
  const parsed = AdminOfficialMultiplayerProfileUpdateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "프로필 설정이 올바르지 않습니다." } },
      400,
    );
  }
  const container = createContainer(c.env.DB, readB2Config(c.env));
  if (!container.gameBundlesConfigured) {
    return c.json(
      { error: { code: "GAME_BUNDLES_NOT_CONFIGURED", message: "B2 구성이 필요합니다." } },
      503,
    );
  }
  const result = await container.officialMultiplayerProfileUseCases.setEnabled({
    gameSlug: c.req.param("gameId"),
    enabled: parsed.data.enabled,
    changedByAdminId: admin.account.id,
    disabledReasonCode: parsed.data.reasonCode ?? null,
  });
  if (!result.ok) {
    const failure = multiplayerProfileFailure(result.code);
    return c.json(failure.body, failure.status);
  }
  return c.json(multiplayerProfileResponse(result), 200);
});

// POST /api/admin/games/upload — publishes a ZIP as an official OWOGG game. Authority comes only
// from this elevated admin route; no archive field or public Game Creator endpoint can select OWOGG.
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
      await purgePublicGameReadCache(c.req.url, [result.slug], c.env.GAME_ORIGIN);
      c.header("Clear-Site-Data", '"cache"');
      return c.json(AdminOfficialGameUploadResponseSchema.parse(result), 201);
    } catch (error) {
      const failure = officialUpdateFailure(error);
      return c.json(failure.body, failure.status);
    }
  },
);

adminGamesRouter.post(
  "/:gameId/bundle",
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
    const body = await c.req.parseBody().catch(() => null);
    const bundle = body?.bundle;
    if (!(bundle instanceof File)) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "bundle ZIP 파일이 필요합니다." } },
        400,
      );
    }
    try {
      const result = await container.officialGameUploadUseCases.replaceBundle({
        slug: c.req.param("gameId"),
        bytes: await bundle.arrayBuffer(),
        contentType: bundle.type || undefined,
      });
      await purgePublicGameReadCache(c.req.url, [result.slug], c.env.GAME_ORIGIN);
      c.header("Clear-Site-Data", '"cache"');
      return c.json(AdminOfficialGameUploadResponseSchema.parse(result), 201);
    } catch (error) {
      const failure = officialUpdateFailure(error);
      return c.json(failure.body, failure.status);
    }
  },
);

adminGamesRouter.post(
  "/:gameId/manifest",
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
    const body = await c.req.parseBody().catch(() => null);
    const manifest = body?.manifest;
    if (!(manifest instanceof File)) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "manifest 파일 필드가 필요합니다." } },
        400,
      );
    }
    try {
      const result = await container.officialGameUploadUseCases.replaceManifest({
        slug: c.req.param("gameId"),
        bytes: await manifest.arrayBuffer(),
      });
      await purgePublicGameReadCache(c.req.url, [result.slug], c.env.GAME_ORIGIN);
      c.header("Clear-Site-Data", '"cache"');
      return c.json(AdminOfficialGameUploadResponseSchema.parse(result), 201);
    } catch (error) {
      const failure = officialUpdateFailure(error);
      return c.json(failure.body, failure.status);
    }
  },
);

adminGamesRouter.patch(
  "/:gameId/basic-metadata",
  rateLimit({ name: "game-upload", binding: "GAME_UPLOAD_RATE_LIMITER" }),
  async (c) => {
    const admin = await requireElevatedAdmin(c);
    if (isElevatedAdminResponse(admin)) return admin;
    const denied = requirePermission(admin, "games.moderate");
    if (denied) return denied;
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
      const result = await container.officialGameUploadUseCases.updateBasicMetadata({
        slug: c.req.param("gameId"),
        metadata: parsed.data,
      });
      await purgePublicGameReadCache(c.req.url, [result.slug], c.env.GAME_ORIGIN);
      c.header("Clear-Site-Data", '"cache"');
      return c.json(AdminOfficialGameUploadResponseSchema.parse(result), 201);
    } catch (error) {
      const failure = officialUpdateFailure(error);
      return c.json(failure.body, failure.status);
    }
  },
);

adminGamesRouter.post(
  "/:gameId/logo",
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
    const body = await c.req.parseBody().catch(() => null);
    const logo = body?.logo;
    if (!(logo instanceof File)) {
      return c.json(
        { error: { code: "INVALID_REQUEST", message: "logo 파일 필드가 필요합니다." } },
        400,
      );
    }
    try {
      const result = await container.officialGameUploadUseCases.replaceLogo({
        slug: c.req.param("gameId"),
        fileName: logo.name,
        bytes: await logo.arrayBuffer(),
      });
      await purgePublicGameReadCache(c.req.url, [result.slug], c.env.GAME_ORIGIN);
      c.header("Clear-Site-Data", '"cache"');
      return c.json(GameLogoUpdateResponseSchema.parse(result), 200);
    } catch (error) {
      const failure = officialUpdateFailure(error);
      return c.json(failure.body, failure.status);
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
    await purgePublicGameReadCache(c.req.url, [result.slug], c.env.GAME_ORIGIN);
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
    await purgePublicGameReadCache(c.req.url, [c.req.param("gameId")], c.env.GAME_ORIGIN);
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

  await purgePublicGameReadCache(c.req.url, [gameId], c.env.GAME_ORIGIN);
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
