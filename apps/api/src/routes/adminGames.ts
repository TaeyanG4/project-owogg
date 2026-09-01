import { Hono } from "hono";
import {
  AdminManagedMultiplayerProfileRequestListResponseSchema,
  AdminManagedMultiplayerProfileListResponseSchema,
  AdminManagedMultiplayerExactVersionResponseSchema,
  AdminManagedMultiplayerProfileReviewRequestSchema,
  AdminManagedMultiplayerProfileReviewResponseSchema,
  AdminManagedMultiplayerProfileActivationRequestSchema,
  AdminManagedMultiplayerProfileActivationResponseSchema,
  AdminGameListResponseSchema,
  AdminGameListQuerySchema,
  AdminGameCatalogRoleRequestSchema,
  AdminGameCatalogRoleResponseSchema,
  AdminGameToggleRequestSchema,
  AdminPlatformFeatureSettingsUpdateRequestSchema,
  PlatformFeatureSettingsResponseSchema,
  AdminOfficialGameDeleteResponseSchema,
  AdminOfficialGameUploadResponseSchema,
  SandboxGameBasicMetadataUpdateRequestSchema,
  GameLogoUpdateResponseSchema,
} from "@owogg/contracts";
import {
  OfficialGameDeleteFailure,
  OfficialGameUploadFailure,
  isApprovedRelayMultiplayerProfileV1,
  resolveMultiplayerRuntimeProfileRequestV1,
  toOwoggMultiplayerRuntimeRequestV1,
  type MultiplayerProfileRecord,
  type MultiplayerProfileRequestRecord,
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

function managedMultiplayerRequestResponse(record: MultiplayerProfileRequestRecord) {
  const resolution = resolveMultiplayerRuntimeProfileRequestV1(record.request);
  const publicResolution =
    resolution.status === "SUPPORTED_V1"
      ? {
          status: resolution.status,
          transportKind: resolution.transportKind,
          runtimeKind: resolution.runtimeKind,
          protocolVersion: resolution.protocolVersion,
          resultTrust: resolution.resultTrust,
        }
      : resolution.status === "RUNTIME_NOT_AVAILABLE"
        ? {
            status: resolution.status,
            runtimeKind: resolution.runtimeKind,
            reason: resolution.reason,
          }
        : {
            status: resolution.status,
            runtimeKind: resolution.runtimeKind,
            unsupportedCapabilities: resolution.unsupportedCapabilities,
            reason: resolution.reason,
          };
  return {
    id: record.id,
    gameId: record.gameId,
    gameVersionId: record.gameVersionId,
    contentHash: record.contentHash,
    requestSchemaVersion: record.requestSchemaVersion,
    requestHash: record.requestHash,
    request: toOwoggMultiplayerRuntimeRequestV1(record.request),
    requestedByUserId: record.requestedByUserId,
    status: record.status,
    reviewedByAdminId: record.reviewedByAdminId,
    reviewedAt: record.reviewedAt,
    decisionReasonCode: record.decisionReasonCode,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    resolution: publicResolution,
  };
}

function managedMultiplayerProfileResponse(record: MultiplayerProfileRecord | null) {
  if (!record || !isApprovedRelayMultiplayerProfileV1(record.profile)) return null;
  return {
    id: record.id,
    gameVersionId: record.profile.gameVersionId,
    contentHash: record.profile.contentHash,
    profileRevision: record.profile.profileRevision,
    enabled: record.profile.enabled,
    transportKind: record.profile.transportKind,
    runtimeKind: record.profile.runtimeKind,
    protocolVersion: record.profile.protocolVersion,
    reconnect: record.profile.reconnectPolicy,
    directMessages: record.profile.directMessages,
    hostSnapshot: record.profile.hostSnapshot,
    minPlayers: record.profile.minPlayers,
    maxPlayers: record.profile.maxPlayers,
    resultTrust: record.profile.resultTrust,
    updatedAt: record.updatedAt,
  };
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
          ? "동일한 slug가 사용자 제작 게임에 이미 사용되고 있습니다."
          : error.code === "PUBLISH_FAILED"
            ? "OWOGG 게임 변경사항을 D1/B2에 게시하지 못했습니다."
            : error.code === "VERIFIER_NOT_REGISTERED"
              ? "playConfig.verifierId에 대응하는 검토 완료 서버 검증기가 등록되지 않았습니다."
              : error.code === "MULTIPLAYER_RUNTIME_NOT_AVAILABLE"
                ? "현재는 websocket + relay runtime만 지원합니다."
                : error.code === "MULTIPLAYER_CAPABILITY_NOT_AVAILABLE"
                  ? "현재 Relay는 join-in-progress와 spectator를 지원하지 않습니다."
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
    catalogRole: c.req.query("catalogRole"),
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

adminGamesRouter.get("/platform-settings", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "games.moderate");
  if (denied) return denied;
  const { platformFeatureSettingsUseCases } = createContainer(c.env.DB);
  return c.json(
    PlatformFeatureSettingsResponseSchema.parse(await platformFeatureSettingsUseCases.get()),
    200,
  );
});

adminGamesRouter.patch("/platform-settings", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "games.moderate");
  if (denied) return denied;
  const parsed = AdminPlatformFeatureSettingsUpdateRequestSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "변경할 운영 설정이 올바르지 않습니다." } },
      400,
    );
  }
  const { platformFeatureSettingsUseCases } = createContainer(c.env.DB);
  const result = await platformFeatureSettingsUseCases.set({
    ...parsed.data,
    adminId: admin.userId,
  });
  await purgePublicGameReadCache(c.req.url);
  c.header("Clear-Site-Data", '"cache"');
  return c.json(PlatformFeatureSettingsResponseSchema.parse(result), 200);
});

// Creator/OWOGG manifests submit only an untrusted exact-version request. This elevated route is
// the first server-owned approval boundary; an approval derives a disabled profile and never
// activates gameplay or grants ranking/reward policy.
adminGamesRouter.get("/multiplayer-requests", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "games.moderate");
  if (denied) return denied;
  const rawLimit = c.req.query("limit");
  const limit = rawLimit === undefined ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "limit은 1~100 정수여야 합니다." } },
      400,
    );
  }
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const requests = await container.managedMultiplayerProfileReviewUseCases.listPending(limit);
  return c.json(
    AdminManagedMultiplayerProfileRequestListResponseSchema.parse({
      requests: requests.map(managedMultiplayerRequestResponse),
    }),
    200,
  );
});

// Approved Relay profiles remain discoverable after review so activation is a durable,
// deliberately separate admin action instead of transient UI state from the review response.
adminGamesRouter.get("/multiplayer-profiles", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "games.moderate");
  if (denied) return denied;
  const rawLimit = c.req.query("limit");
  const limit = rawLimit === undefined ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "limit은 1~100 정수여야 합니다." } },
      400,
    );
  }
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const profiles =
    await container.managedMultiplayerProfileReviewUseCases.listManagedProfiles(limit);
  return c.json(
    AdminManagedMultiplayerProfileListResponseSchema.parse({
      profiles: profiles.map(managedMultiplayerProfileResponse),
    }),
    200,
  );
});

// The global review panel was intentionally removed. Operators resolve the current immutable
// version beside the game they are managing, while approval and activation remain two separate
// audited mutations below.
adminGamesRouter.get("/:gameSlug/multiplayer-control", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "games.moderate");
  if (denied) return denied;

  const gameSlug = c.req.param("gameSlug");
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const identity = await container.gameIdentityRepo.findBySlug(gameSlug);
  if (!identity) {
    return c.json(
      { error: { code: "GAME_NOT_FOUND", message: "관리할 게임을 찾을 수 없습니다." } },
      404,
    );
  }

  const gameVersionId = identity.liveVersionId;
  const [rawRequest, rawProfile] =
    gameVersionId === null
      ? [null, null]
      : await Promise.all([
          container.multiplayerProfileRequestRepo.findByExactVersion(gameVersionId),
          container.multiplayerProfileRepo.findLatestForExactVersion(identity.id, gameVersionId),
        ]);
  const request = rawRequest?.gameId === identity.id ? rawRequest : null;

  return c.json(
    AdminManagedMultiplayerExactVersionResponseSchema.parse({
      gameSlug: identity.slug,
      gameId: identity.id,
      gameVersionId,
      request: request ? managedMultiplayerRequestResponse(request) : null,
      profile: managedMultiplayerProfileResponse(rawProfile),
    }),
    200,
  );
});

adminGamesRouter.post("/multiplayer-requests/:requestId/review", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "games.moderate");
  if (denied) return denied;
  if (!admin.account) {
    return c.json(
      {
        error: {
          code: "MANAGED_ADMIN_REQUIRED",
          message: "감사 가능한 관리 계정으로 로그인해야 요청을 심사할 수 있습니다.",
        },
      },
      403,
    );
  }
  const requestId = Number(c.req.param("requestId"));
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "요청 ID가 올바르지 않습니다." } },
      400,
    );
  }
  const body = await c.req.json().catch(() => null);
  const parsed = AdminManagedMultiplayerProfileReviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "심사 결정이 올바르지 않습니다." } },
      400,
    );
  }
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const result =
    parsed.data.decision === "APPROVED"
      ? await container.managedMultiplayerProfileReviewUseCases.approve({
          requestId,
          reviewedByAdminId: admin.account.id,
        })
      : await container.managedMultiplayerProfileReviewUseCases.reject({
          requestId,
          reviewedByAdminId: admin.account.id,
          // The contract refinement requires a reason for rejection. Keep the controller
          // defensive so the invariant remains explicit without a non-null assertion.
          reasonCode: parsed.data.reasonCode ?? "UNSPECIFIED",
        });
  if (!result.ok) {
    const status = result.code === "REQUEST_NOT_FOUND" ? 404 : 409;
    return c.json(
      {
        error: {
          code: result.code,
          message:
            result.code === "REQUEST_NOT_FOUND"
              ? "멀티플레이 요청을 찾을 수 없습니다."
              : result.code === "MULTIPLAYER_RUNTIME_NOT_AVAILABLE"
                ? "요청한 멀티플레이 runtime은 아직 활성화할 수 없습니다."
                : result.code === "MULTIPLAYER_CAPABILITY_NOT_AVAILABLE"
                  ? "요청한 Relay 기능은 아직 지원되지 않습니다."
                  : result.code === "PROFILE_CREATE_FAILED"
                    ? "승인 결정은 저장됐지만 exact-version Relay profile 생성에 실패했습니다. 같은 요청을 다시 승인해 복구할 수 있습니다."
                    : "이미 결정된 멀티플레이 요청입니다.",
        },
      },
      status,
    );
  }
  return c.json(
    AdminManagedMultiplayerProfileReviewResponseSchema.parse({
      request: managedMultiplayerRequestResponse(result.request),
      profile: managedMultiplayerProfileResponse(result.profile),
    }),
    200,
  );
});

adminGamesRouter.post("/multiplayer-profiles/:profileId/activation", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "games.moderate");
  if (denied) return denied;
  if (!admin.account) {
    return c.json(
      { error: { code: "MANAGED_ADMIN_REQUIRED", message: "감사 가능한 관리 계정이 필요합니다." } },
      403,
    );
  }
  const profileId = Number(c.req.param("profileId"));
  if (!Number.isSafeInteger(profileId) || profileId <= 0) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "프로필 ID가 올바르지 않습니다." } },
      400,
    );
  }
  const parsed = AdminManagedMultiplayerProfileActivationRequestSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "활성화 요청이 올바르지 않습니다." } },
      400,
    );
  }
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const result = await container.managedMultiplayerProfileReviewUseCases.setProfileEnabled({
    profileId,
    enabled: parsed.data.enabled,
    changedByAdminId: admin.account.id,
    reasonCode: parsed.data.reasonCode,
  });
  if (!result.ok) {
    return c.json(
      {
        error: {
          code: result.code,
          message:
            result.code === "PROFILE_NOT_FOUND"
              ? "일반 Relay 프로필을 찾을 수 없습니다."
              : result.code === "PROFILE_NOT_MANAGED"
                ? "승인 요청에 연결된 일반 Relay 프로필만 변경할 수 있습니다."
                : "다른 프로필 활성화 또는 exact-version 상태와 충돌했습니다.",
        },
      },
      result.code === "PROFILE_NOT_FOUND" ? 404 : 409,
    );
  }
  return c.json(
    AdminManagedMultiplayerProfileActivationResponseSchema.parse({
      request: managedMultiplayerRequestResponse(result.request),
      profile: managedMultiplayerProfileResponse(result.profile),
    }),
    200,
  );
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

adminGamesRouter.post(
  "/:gameId/description",
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
      const result = await container.officialGameUploadUseCases.replaceDescriptionPackage({
        slug: c.req.param("gameId"),
        fileName: description.name,
        bytes: await description.arrayBuffer(),
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

// DELETE /api/admin/games/:gameId — removes every B2 bundle/canonical object and releases the slug
// for clean re-registration. An identity with immutable multiplayer history remains tombstoned
// until a successful replacement publish; history-free identities are physically removed.
// Two permissions are required because this is stronger than the ordinary game kill switch.
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

// POST /api/admin/games/:gameId/catalog-role — operator-owned UI classification. This is never
// accepted from owogg.json, so an uploaded ZIP cannot grant itself an internal control surface.
adminGamesRouter.post("/:gameId/catalog-role", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "games.moderate");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "요청 본문이 올바르지 않습니다." } },
      400,
    );
  }
  const parsed = AdminGameCatalogRoleRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "catalogRole 값이 올바르지 않습니다." } },
      400,
    );
  }

  const { gameSettingsUseCases } = createContainer(c.env.DB);
  const result = await gameSettingsUseCases.setCatalogRole(
    c.req.param("gameId"),
    parsed.data.catalogRole,
    admin.userId,
  );
  if (!result.ok) {
    return c.json({ error: { code: result.code, message: "존재하지 않는 게임입니다." } }, 404);
  }

  await purgePublicGameReadCache(c.req.url, [result.record.gameId], c.env.GAME_ORIGIN);
  c.header("Clear-Site-Data", '"cache"');
  return c.json(
    AdminGameCatalogRoleResponseSchema.parse({
      gameId: result.record.gameId,
      catalogRole: result.record.catalogRole,
    }),
    200,
  );
});
