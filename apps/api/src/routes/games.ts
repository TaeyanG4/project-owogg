import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import {
  GameScoreAcceptRequestSchema,
  GameScoreAcceptResponseSchema,
  GameResultAcceptRequestSchema,
  GameResultAcceptResponseSchema,
  GameSessionRequestSchema,
  GameSessionResponseSchema,
  PublicGameAvailabilityResponseSchema,
  PublicGameListResponseSchema,
  PublicGameSchema,
  GameEditorContextResponseSchema,
} from "@owogg/contracts";
import {
  GAME_SESSION_POLICY,
  canonicalizeGameEvidence,
  emptyPublicGameStats,
  effectivePermissions,
  evaluateClientAuthoredResultFlow,
  gameDescriptionFilePaths,
  gameDescriptionImagePaths,
  GAME_DESCRIPTION_FILE_LOCALES,
  GAME_DESCRIPTION_POLICY,
  publishedObjectKey,
  publicGamePlayModes,
  publicGameMediaUrl,
  resolveBundleContentType,
  toPublicGame,
  validateDifficultyAgainstDefinition,
  signGameSession,
  signVerifiedGameSession,
  type GameScoreAcceptError,
  type GameResultAcceptError,
  type GameVerifiedResultAcceptError,
  type NormalizedGameCreatorResult,
  type GameSessionPayload,
  type VerifiedGameSessionPayload,
  type RuntimeGame,
  type PublicGameStats,
} from "@owogg/core";
import type { OwoggAchievementDefinition } from "@owogg/game-sdk/contracts";
import { createContainer, evaluateAchievementsForUser, type AppContainer } from "../container.js";
import { edgeCache } from "../middleware/edgeCache.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { readB2Config } from "./devGames.js";
import { MAX_GAME_RESULT_REQUEST_BYTES, readBoundedJsonBody } from "./boundedJsonBody.js";
import type { ApiEnv } from "./auth.js";
import { isMultiplayerFeatureEnabled } from "../multiplayer/config.js";
import { resolveAdminEligibility, resolveEffectiveStaffRole } from "../auth/adminEligibility.js";

// Same local requireAuth as streamers.ts/discordGuilds.ts — not shared from auth.ts, matching this
// codebase's existing per-route-file convention rather than introducing a shared import for it.
async function requireAuth(c: Context<ApiEnv>): Promise<{
  userId: number;
  rawSessionToken: string;
  user: { id: number; nickname: string };
} | null> {
  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) return null;
  const { sessionRepo } = createContainer(c.env.DB);
  const result = await sessionRepo.findSession(sessionId);
  if (!result) return null;
  return {
    userId: result.user.id,
    rawSessionToken: sessionId,
    user: { id: result.user.id, nickname: result.user.nickname },
  };
}

export const gamesRouter = new Hono<ApiEnv>();

// GET /api/games/availability — public, no auth. Just the set of game_ids an admin has
// explicitly disabled, so the web catalog/gameplay screen can filter/block without exposing who
// disabled a game or why (that detail is admin-only, see adminGames.ts).
//
// Edge-cached (60s). This fires on essentially every catalog/gameplay page load, so uncached it
// would be one of the highest-volume D1 reads in the app despite the answer being identical for
// everyone and changing only when an admin flips a switch. The kill switch stays effective
// because POST /api/scores re-checks the disabled set against D1 directly on submission — the
// cache only ever delays the catalog *display* update by up to a minute, never the enforcement.
gamesRouter.get("/availability", edgeCache({ ttlSeconds: 60, browserTtlSeconds: 0 }), async (c) => {
  if (!c.env?.DB) {
    return c.json(
      PublicGameAvailabilityResponseSchema.parse({
        disabledGameIds: [],
        multiplayerEnabled: false,
        externalPlatformGamesVisible: false,
      }),
      200,
    );
  }

  const { gameSettingsUseCases, platformFeatureSettingsUseCases } = createContainer(c.env.DB);
  const [disabledGameIds, featureSettings] = await Promise.all([
    gameSettingsUseCases.getDisabledGameIds(),
    platformFeatureSettingsUseCases.get().catch(() => ({
      multiplayerEnabled: false,
      externalPlatformGamesVisible: false,
    })),
  ]);

  return c.json(
    PublicGameAvailabilityResponseSchema.parse({
      disabledGameIds,
      multiplayerEnabled:
        isMultiplayerFeatureEnabled(c.env.MULTIPLAYER_ENABLED) &&
        featureSettings.multiplayerEnabled,
      externalPlatformGamesVisible: featureSettings.externalPlatformGamesVisible,
    }),
    200,
  );
});

// ── Generic public Game read model ───────────────────────────────────────────
//
// Generic D1 identity + live READY version + strict B2 canonical is the sole public authority.
// The catalog/detail path never merges sandbox control-plane metadata and never falls back when
// generic state is incomplete.

async function publicGameProjection(
  c: Context<ApiEnv>,
  container: AppContainer,
  runtime: RuntimeGame | null,
  stats: PublicGameStats = emptyPublicGameStats(),
): Promise<ReturnType<typeof toPublicGame> | null> {
  if (!runtime) return null;
  try {
    const asset = await container.gameAssetRepo.findByGameId(runtime.identity.id, "LOGO");
    const canonicalOfficial = runtime.canonical.publisher.official;
    if (canonicalOfficial !== (runtime.identity.publisher.type === "OWOGG")) return null;
    const publisherName =
      runtime.identity.publisher.type === "OWOGG"
        ? "OWOGG"
        : ((await container.userRepo.findById(runtime.identity.publisher.userId))?.nickname ??
          null);
    if (!publisherName) return null;
    const endpoint = new URL(
      `/api/games/${encodeURIComponent(runtime.identity.slug)}/media/logo`,
      c.req.url,
    ).toString();
    return toPublicGame(runtime, publicGameMediaUrl(asset, endpoint), publisherName, stats);
  } catch {
    return null;
  }
}

// GET /api/games — every currently public, live, READY generic game. D1 kill-switch state is
// applied after the provider-neutral runtime registry has resolved identity/version/canonical.
gamesRouter.get("/", edgeCache({ ttlSeconds: 60, browserTtlSeconds: 0 }), async (c) => {
  if (!c.env?.DB) return c.json(PublicGameListResponseSchema.parse({ games: [] }), 200);

  const container = createContainer(c.env.DB, readB2Config(c.env));
  const runtimes = await container.publicGameCatalog.list();
  const statsBySlug = await container.publicGameMetricsUseCases
    .getBySlugs(runtimes.map((runtime) => runtime.identity.slug))
    .catch(() => new Map<string, PublicGameStats>());
  const games = await Promise.all(
    runtimes.map(async (runtime) => {
      const projection = await publicGameProjection(
        c,
        container,
        runtime,
        statsBySlug.get(runtime.identity.slug),
      );
      return projection ? PublicGameSchema.parse(projection) : null;
    }),
  );

  return c.json(
    PublicGameListResponseSchema.parse({
      games: games.filter((game): game is NonNullable<typeof game> => game !== null),
    }),
    200,
  );
});

interface PublicLogoCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

async function publicDescriptionProjection(
  c: Context<ApiEnv>,
  container: AppContainer,
  runtime: RuntimeGame,
): Promise<{
  descriptions: Array<{
    locale: "en" | "ko" | "ja" | "zh";
    path: "description.md" | "description_kr.md" | "description_ja.md" | "description_zh.md";
    markdown: string;
  }>;
  descriptionImages: Array<{ path: string; url: string }>;
}> {
  const manifest = runtime.canonical.creatorManifest;
  const versionId = runtime.identity.liveVersionId;
  if (!manifest || versionId === null) return { descriptions: [], descriptionImages: [] };

  const descriptions = (
    await Promise.all(
      gameDescriptionFilePaths(manifest).map(async (path) => {
        const bytes = await container.gameBundleStorageRepo.getObject(
          publishedObjectKey(runtime.identity.id, versionId, path),
        );
        if (
          !bytes ||
          bytes.byteLength === 0 ||
          bytes.byteLength > GAME_DESCRIPTION_POLICY.MAX_MARKDOWN_BYTES_PER_FILE
        ) {
          return null;
        }
        try {
          return {
            locale: GAME_DESCRIPTION_FILE_LOCALES[path],
            path,
            markdown: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          };
        } catch {
          return null;
        }
      }),
    )
  ).filter((item): item is NonNullable<typeof item> => item !== null);

  const descriptionImages = gameDescriptionImagePaths(manifest).map((path) => {
    const endpoint = new URL(
      `/api/games/${encodeURIComponent(runtime.identity.slug)}/media/description`,
      c.req.url,
    );
    endpoint.searchParams.set("path", path);
    endpoint.searchParams.set("v", String(versionId));
    return { path, url: endpoint.toString() };
  });
  return { descriptions, descriptionImages };
}

// Generic public logo bytes. Availability and the exact D1 asset revision are checked BEFORE the
// B2 byte cache on every request. The logo gate is deliberately D1-only: loading a public image
// never needs catalog/policy canonical metadata, and fetching that B2 JSON before an already-cached
// logo added ~1.4s to every first-page image. A conventional edgeCache middleware would return its
// hit before these checks and could keep a deleted/disabled game's logo public for an hour.
gamesRouter.get("/:slug/media/logo", async (c) => {
  if (!c.env?.DB) return c.text("Not Found", 404);
  const container = createContainer(c.env.DB, readB2Config(c.env));
  try {
    const identity = await container.gameIdentityRepo.findBySlug(c.req.param("slug"));
    if (!identity || !(await container.runtimeGameAvailability.isIdentityServable(identity))) {
      return c.text("Not Found", 404);
    }
    const asset = await container.gameAssetRepo.findByGameId(identity.id, "LOGO");
    if (!asset) return c.text("Not Found", 404);
    if (c.req.query("v") !== asset.updatedAt) return c.text("Not Found", 404);

    const cacheKey = new Request(c.req.url, { method: "GET" });
    const cache =
      typeof caches === "undefined"
        ? null
        : ((caches as unknown as { default: PublicLogoCache }).default ?? null);
    const cached = await cache?.match(cacheKey);
    if (cached) {
      return new Response(cached.body, {
        status: 200,
        headers: {
          "Content-Type": cached.headers.get("Content-Type") ?? "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Cache": "HIT",
        },
      });
    }

    const bytes = await container.gameBundleStorageRepo.getObject(asset.objectKey);
    if (!bytes) return c.text("Not Found", 404);
    const contentType = resolveBundleContentType(asset.objectKey).contentType;
    const response = new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-Cache": "MISS",
      },
    });
    if (cache) {
      const stored = new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600, s-maxage=3600",
        },
      });
      try {
        c.executionCtx.waitUntil(cache.put(cacheKey, stored));
      } catch {
        // Plain-Node tests have no execution context. The fresh response remains valid.
      }
    }
    return response;
  } catch {
    // Unknown, private, disabled, malformed, or unavailable media is indistinguishable.
    return c.text("Not Found", 404);
  }
});

// Only manifest-allowlisted raster assets from the current live immutable version are public.
gamesRouter.get("/:slug/media/description", async (c) => {
  if (!c.env?.DB) return c.text("Not Found", 404);
  const container = createContainer(c.env.DB, readB2Config(c.env));
  try {
    const runtime = await container.publicGameCatalog.findBySlug(c.req.param("slug"));
    const path = c.req.query("path");
    const requestedVersion = Number(c.req.query("v"));
    const manifest = runtime?.canonical.creatorManifest;
    if (
      !runtime ||
      !manifest ||
      !path ||
      runtime.identity.liveVersionId === null ||
      requestedVersion !== runtime.identity.liveVersionId ||
      !gameDescriptionImagePaths(manifest).includes(path)
    ) {
      return c.text("Not Found", 404);
    }
    const contentType = resolveBundleContentType(path).contentType;
    if (
      !new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]).has(
        contentType,
      )
    ) {
      return c.text("Not Found", 404);
    }
    const bytes = await container.gameBundleStorageRepo.getObject(
      publishedObjectKey(runtime.identity.id, runtime.identity.liveVersionId, path),
    );
    if (
      !bytes ||
      bytes.byteLength === 0 ||
      bytes.byteLength > GAME_DESCRIPTION_POLICY.MAX_IMAGE_BYTES_PER_FILE
    ) {
      return c.text("Not Found", 404);
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return c.text("Not Found", 404);
  }
});

/** Authenticated capability projection for the inline game-information editor. Publisher user ids
 * remain private: callers receive a concrete route mode only when they own the USER game or hold
 * the matching permission in a currently elevated admin session. Mutation routes re-check every
 * fact; this endpoint is only the safe UI discovery layer. */
gamesRouter.get("/:slug/edit-context", async (c) => {
  c.header("Cache-Control", "no-store");
  if (!c.env?.DB) return c.text("Not Found", 404);
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } }, 401);
  }

  const container = createContainer(c.env.DB, readB2Config(c.env));
  const identity = await container.gameIdentityRepo.findBySlug(c.req.param("slug"));
  if (!identity || identity.deletedAt !== null) return c.text("Not Found", 404);

  let elevatedPermissions: readonly string[] = [];
  const eligibility = await resolveAdminEligibility(
    auth.userId,
    c.env.ADMIN_USER_IDS,
    container.adminAccountUseCases,
  );
  if (eligibility.eligible) {
    const elevated = await container.adminAuthUseCases.validateAdminSession({
      rawToken: getCookie(c, "owogg_admin_session"),
      rawSessionToken: auth.rawSessionToken,
    });
    if (elevated) {
      const staffRole = resolveEffectiveStaffRole(eligibility);
      const [rolePermissions, individualPermissions] =
        !staffRole || staffRole === "ADMIN"
          ? [[], []]
          : await Promise.all([
              container.adminAccountUseCases.listRolePermissions(staffRole),
              eligibility.account
                ? container.adminAccountUseCases.listPermissions(eligibility.account.id)
                : Promise.resolve([]),
            ]);
      elevatedPermissions = effectivePermissions(staffRole, rolePermissions, individualPermissions);
    }
  }

  if (identity.publisher.type === "OWOGG") {
    return c.json(
      GameEditorContextResponseSchema.parse({
        editor: elevatedPermissions.includes("games.moderate")
          ? {
              gameId: identity.id,
              mode: "OFFICIAL_ADMIN",
              publisherType: "OWOGG",
              contentEditAvailableAt: null,
            }
          : null,
      }),
      200,
    );
  }

  const sandboxGame = await container.sandboxGameRepo.findById(identity.id);
  const editor = elevatedPermissions.includes("sandbox_games.review")
    ? {
        gameId: identity.id,
        mode: "USER_ADMIN" as const,
        publisherType: "USER" as const,
        contentEditAvailableAt: null,
      }
    : identity.publisher.userId === auth.userId
      ? {
          gameId: identity.id,
          mode: "USER_CREATOR" as const,
          publisherType: "USER" as const,
          contentEditAvailableAt: sandboxGame?.contentEditAvailableAt ?? null,
        }
      : null;
  return c.json(GameEditorContextResponseSchema.parse({ editor }), 200);
});

// GET /api/games/:slug — one provider-neutral runtime resolution path for OWOGG and USER.
gamesRouter.get("/:slug", edgeCache({ ttlSeconds: 60, browserTtlSeconds: 0 }), async (c) => {
  if (!c.env?.DB) return c.text("Not Found", 404);

  const container = createContainer(c.env.DB, readB2Config(c.env));
  const runtime = await container.publicGameCatalog.findBySlug(c.req.param("slug"));
  const stats = runtime
    ? await container.publicGameMetricsUseCases
        .getBySlugs([runtime.identity.slug])
        .then((metrics) => metrics.get(runtime.identity.slug))
        .catch(() => undefined)
    : undefined;
  const game = await publicGameProjection(c, container, runtime, stats);
  if (!game) return c.text("Not Found", 404);
  const descriptionProjection = runtime
    ? await publicDescriptionProjection(c, container, runtime).catch(() => ({
        descriptions: [],
        descriptionImages: [],
      }))
    : { descriptions: [], descriptionImages: [] };
  return c.json(PublicGameSchema.parse({ ...game, ...descriptionProjection }), 200);
});

// ── Generic Game Session ─────────────────────────────────────────────────────
//
// Both token formats resolve the exact generic D1 identity/live READY version. gs1 preserves the
// legacy client-result path unchanged; gs2 additionally binds one generic topology and canonical
// PlayConfig pair. Tokens remain in the parent Web host and never cross the iframe Bridge.

gamesRouter.post("/:slug/session", rateLimit({ name: "game-session" }), async (c) => {
  if (!c.env?.DB) return c.text("Not Found", 404);

  const secret = c.env.GAME_SESSION_SECRET;
  if (!secret) {
    // Fails closed rather than signing with an empty/predictable secret — same posture as
    // GAME_BUNDLES_NOT_CONFIGURED in devGames.ts for a feature this environment hasn't set up.
    return c.json(
      {
        error: {
          code: "GAME_SESSION_NOT_CONFIGURED",
          message: "게임 세션 서명 키가 아직 이 환경에 구성되지 않았습니다.",
        },
      },
      503,
    );
  }

  const auth = await requireAuth(c);
  if (!auth)
    return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);

  const container = createContainer(c.env.DB, readB2Config(c.env));
  const runtime = await container.runtimeGameRegistry.findBySlug(c.req.param("slug"));
  if (!runtime) return c.text("Not Found", 404);

  if (
    (await container.gameSettingsUseCases.getDisabledGameIds()).includes(runtime.identity.slug) ||
    !(await container.runtimeGameAvailability.isVersionServable(
      runtime.identity.id,
      runtime.liveVersion.id,
    ))
  ) {
    return c.json(
      { error: { code: "GAME_DISABLED", message: "현재 비활성화된 게임입니다." } },
      400,
    );
  }

  const rawBody = await c.req.json().catch(() => ({}));
  const request = GameSessionRequestSchema.safeParse(rawBody);
  if (!request.success) {
    return c.json(
      { error: { code: "INVALID_PAYLOAD", message: "요청 형식이 올바르지 않습니다." } },
      400,
    );
  }

  const canonicalPlayConfig = runtime.canonical.playConfig;
  if (canonicalPlayConfig !== undefined) {
    if (!("playConfig" in request.data)) {
      return c.json(
        {
          error: {
            code: "PLAY_CONFIG_REQUIRED",
            message: "서버가 승인한 난이도와 모드를 선택해야 합니다.",
          },
        },
        400,
      );
    }
    const playConfigRequest = request.data;

    const declaredPlayModes = publicGamePlayModes(runtime);
    if (!declaredPlayModes.includes(playConfigRequest.playMode)) {
      return c.json(
        { error: { code: "INVALID_PLAY_MODE", message: "허용되지 않은 실행 모드입니다." } },
        400,
      );
    }
    const allowedConfig = canonicalPlayConfig.allowedConfigs.find(
      (candidate) =>
        candidate.difficultyId === playConfigRequest.playConfig.difficultyId &&
        candidate.variantId === playConfigRequest.playConfig.variantId,
    );
    if (!allowedConfig) {
      return c.json(
        {
          error: {
            code: "INVALID_PLAY_CONFIG",
            message: "허용되지 않은 난이도와 모드 조합입니다.",
          },
        },
        400,
      );
    }
    if (!container.gameVerifierRegistry.has(canonicalPlayConfig.verifierId)) {
      return c.json(
        {
          error: {
            code: "GAME_VERIFIER_NOT_REGISTERED",
            message: "이 게임의 서버 검증기가 아직 등록되지 않았습니다.",
          },
        },
        503,
      );
    }

    const issuedAtMs = Date.now();
    const nowSeconds = Math.floor(issuedAtMs / 1000);
    const challengeSeed = crypto.randomUUID();
    const payload: VerifiedGameSessionPayload = {
      userId: auth.userId,
      gameId: runtime.identity.id,
      versionId: runtime.liveVersion.id,
      attemptId: crypto.randomUUID(),
      playMode: playConfigRequest.playMode,
      difficultyId: allowedConfig.difficultyId,
      variantId: allowedConfig.variantId,
      rewardFactor: allowedConfig.rewardFactor,
      rulesetRevision: canonicalPlayConfig.rulesetRevision,
      verifierId: canonicalPlayConfig.verifierId,
      challengeSeed,
      issuedAtMs,
      exp: nowSeconds + GAME_SESSION_POLICY.EXPIRY_SECONDS,
    };
    const token = await signVerifiedGameSession(payload, secret);
    return c.json(
      GameSessionResponseSchema.parse({
        token,
        expiresAt: new Date(payload.exp * 1000).toISOString(),
        startContext: {
          ranked: true,
          playConfig: {
            difficultyId: payload.difficultyId,
            variantId: payload.variantId,
          },
          rulesetRevision: payload.rulesetRevision,
          challengeSeed: payload.challengeSeed,
          rewardFactor: payload.rewardFactor,
        },
      }),
      200,
    );
  }

  if ("playConfig" in request.data) {
    return c.json(
      {
        error: {
          code: "PLAY_CONFIG_NOT_SUPPORTED",
          message: "이 게임 버전은 PlayConfig 세션을 지원하지 않습니다.",
        },
      },
      400,
    );
  }

  const authoritySelection = await container.selectedTopologyAuthorityGate.evaluate(
    runtime.identity.id,
    runtime.liveVersion.id,
  );
  if (!authoritySelection.allowed) {
    const unavailable = authoritySelection.error === "MULTIPLAYER_AUTHORITY_UNAVAILABLE";
    return c.json(
      {
        error: {
          code: authoritySelection.error,
          message: unavailable
            ? "멀티플레이 권한 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요."
            : "이 게임 버전은 서버 관리형 멀티플레이 세션만 지원합니다.",
        },
      },
      unavailable ? 503 : 409,
    );
  }

  const clientAuthoredFlow = evaluateClientAuthoredResultFlow(runtime.canonical);
  if (!clientAuthoredFlow.allowed) {
    return c.json(
      {
        error: {
          code: clientAuthoredFlow.error,
          message: "이 게임의 서버 검증 플레이 경로가 아직 준비되지 않았습니다.",
        },
      },
      503,
    );
  }

  const difficulty = validateDifficultyAgainstDefinition(
    runtime.canonical.difficulty,
    request.data.difficulty,
  );
  if (!difficulty.valid) {
    return c.json(
      {
        error: {
          code: "INVALID_DIFFICULTY",
          message: difficulty.reason ?? "유효하지 않은 난이도입니다.",
        },
      },
      400,
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: GameSessionPayload = {
    userId: auth.userId,
    gameId: runtime.identity.id,
    versionId: runtime.liveVersion.id,
    attemptId: crypto.randomUUID(),
    exp: nowSeconds + GAME_SESSION_POLICY.EXPIRY_SECONDS,
    difficulty: difficulty.normalizedDifficultyId,
  };
  const token = await signGameSession(payload, secret);

  return c.json(
    GameSessionResponseSchema.parse({
      token,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    }),
    200,
  );
});

// ── Generic score acceptance ─────────────────────────────────────────────────

function gameScoreAcceptErrorStatus(error: GameScoreAcceptError): 400 | 401 | 404 | 409 | 503 {
  switch (error) {
    case "GAME_NOT_AVAILABLE":
      return 404;
    case "GAME_DISABLED":
      return 400;
    case "MULTIPLAYER_MANAGED":
      return 409;
    case "MULTIPLAYER_AUTHORITY_UNAVAILABLE":
      return 503;
    case "PLAY_CONFIG_AUTHORITY_UNAVAILABLE":
      return 503;
    case "INVALID_TOKEN":
    case "CONTEXT_MISMATCH":
      return 401;
    case "SCORE_POLICY_NOT_CONFIGURED":
    case "INVALID_DIFFICULTY":
    case "INVALID_SCORE":
      return 400;
    case "ALREADY_CONSUMED":
      return 409;
  }
}

function gameScoreAcceptErrorMessage(error: GameScoreAcceptError, reason?: string): string {
  switch (error) {
    case "GAME_NOT_AVAILABLE":
      return "게임을 찾을 수 없습니다.";
    case "INVALID_TOKEN":
      return "게임 세션이 유효하지 않거나 만료되었습니다.";
    case "CONTEXT_MISMATCH":
      return "게임 세션이 이 요청과 일치하지 않습니다. 다시 시작해 주세요.";
    case "SCORE_POLICY_NOT_CONFIGURED":
      return "이 게임은 아직 점수 제출을 지원하지 않습니다.";
    case "GAME_DISABLED":
      return "현재 비활성화된 게임입니다.";
    case "MULTIPLAYER_MANAGED":
      return "이 게임 버전의 점수는 서버가 확정한 멀티플레이 결과로만 기록됩니다.";
    case "MULTIPLAYER_AUTHORITY_UNAVAILABLE":
      return "멀티플레이 권한 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.";
    case "PLAY_CONFIG_AUTHORITY_UNAVAILABLE":
      return "이 게임의 서버 검증 점수 경로가 아직 준비되지 않았습니다.";
    case "INVALID_DIFFICULTY":
      return reason || "유효하지 않은 난이도입니다.";
    case "INVALID_SCORE":
      return reason || "유효하지 않은 점수입니다.";
    case "ALREADY_CONSUMED":
      return "이미 처리된 플레이입니다.";
  }
}

gamesRouter.post("/:slug/score", rateLimit({ name: "game-score-accept" }), async (c) => {
  if (!c.env?.DB) return c.text("Not Found", 404);

  const secret = c.env.GAME_SESSION_SECRET;
  if (!secret) {
    return c.json(
      {
        error: {
          code: "GAME_SESSION_NOT_CONFIGURED",
          message: "게임 세션 서명 키가 아직 이 환경에 구성되지 않았습니다.",
        },
      },
      503,
    );
  }

  // Inlined rather than the narrower local requireAuth() above — this needs avatar_url too (for
  // the score row), the same fields POST /api/scores itself reads off the session directly.
  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
  }
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const { sessionRepo, gameScoreAcceptanceUseCases } = container;
  const authData = await sessionRepo.findSession(sessionId);
  if (!authData) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
  }

  // Same score-submission block POST /api/scores already enforces (see UserModerationUseCases) —
  // applies identically regardless of which kind of game the score is for.
  if (authData.user.score_submission_blocked) {
    return c.json(
      {
        error: { code: "SCORE_SUBMISSION_BLOCKED", message: "현재 점수 제출이 제한된 계정입니다." },
      },
      403,
    );
  }

  const rawBody = await c.req.json().catch(() => ({}));
  const parseResult = GameScoreAcceptRequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json(
      { error: { code: "INVALID_PAYLOAD", message: "요청 형식이 올바르지 않습니다." } },
      400,
    );
  }

  const result = await gameScoreAcceptanceUseCases.accept({
    slug: c.req.param("slug"),
    userId: authData.user.id,
    nickname: authData.user.nickname,
    avatarUrl: authData.user.avatar_url,
    token: parseResult.data.token,
    secret,
    score: parseResult.data.score,
    difficulty: parseResult.data.difficulty,
  });

  if (!result.ok) {
    return c.json(
      {
        error: {
          code: result.error,
          message: gameScoreAcceptErrorMessage(result.error, result.reason),
        },
      },
      gameScoreAcceptErrorStatus(result.error),
    );
  }

  let xpAwarded = 0;
  let guildXpAwarded = 0;
  let guildId: string | undefined;
  let newlyUnlockedAchievements: string[] = [];
  try {
    const completion = await container.progressionUseCases.recordAcceptedGameCompletion({
      userId: authData.user.id,
      gameId: result.slug,
      sourceId: String(result.scoreId),
      xpPerCompletion: result.xpPerCompletion,
    });
    xpAwarded = completion.xpAwarded;

    if (parseResult.data.playToken && completion.xpEventId) {
      const guildAttr = await container.discordGuildXpUseCases.attributeCompletionToGuild({
        userId: authData.user.id,
        gameId: result.slug,
        sourceXpEventId: completion.xpEventId,
        xpAmount: xpAwarded,
        playToken: parseResult.data.playToken,
      });
      if (guildAttr.attributed) {
        guildXpAwarded = guildAttr.amount ?? 0;
        guildId = guildAttr.guildId;
      }
    }

    const deferredAchievements = evaluateAchievementsForUser(container, authData.user.id).catch(
      (achievementErr) => console.error("Deferred Achievement Evaluation Error:", achievementErr),
    );
    try {
      c.executionCtx.waitUntil(deferredAchievements);
    } catch {
      newlyUnlockedAchievements = (await deferredAchievements) ?? [];
    }
  } catch (progressionErr) {
    console.error("Progression Update Error:", progressionErr);
  }

  return c.json(
    GameScoreAcceptResponseSchema.parse({
      success: true,
      score_id: result.scoreId,
      game_id: result.slug,
      score: parseResult.data.score,
      nickname: authData.user.nickname,
      xpAwarded,
      ...(guildXpAwarded > 0 || guildId ? { guildXpAwarded, guildId } : {}),
      newlyUnlockedAchievements,
    }),
    200,
  );
});

function gameResultAcceptErrorStatus(error: GameResultAcceptError): 400 | 401 | 404 | 409 | 503 {
  switch (error) {
    case "GAME_NOT_AVAILABLE":
      return 404;
    case "INVALID_TOKEN":
    case "CONTEXT_MISMATCH":
      return 401;
    case "ALREADY_CONSUMED":
      return 409;
    case "MULTIPLAYER_MANAGED":
      return 409;
    case "MULTIPLAYER_AUTHORITY_UNAVAILABLE":
      return 503;
    case "PLAY_CONFIG_AUTHORITY_UNAVAILABLE":
      return 503;
    case "GAME_DISABLED":
    case "MANIFEST_NOT_CONFIGURED":
    case "INVALID_DIFFICULTY":
    case "INVALID_RESULT":
      return 400;
  }
}

function gameResultAcceptErrorMessage(error: GameResultAcceptError, reason?: string): string {
  switch (error) {
    case "GAME_NOT_AVAILABLE":
      return "게임을 찾을 수 없습니다.";
    case "GAME_DISABLED":
      return "현재 비활성화된 게임입니다.";
    case "MULTIPLAYER_MANAGED":
      return "이 게임 버전의 결과는 서버가 확정한 멀티플레이 결과로만 기록됩니다.";
    case "MULTIPLAYER_AUTHORITY_UNAVAILABLE":
      return "멀티플레이 권한 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.";
    case "PLAY_CONFIG_AUTHORITY_UNAVAILABLE":
      return "이 게임의 서버 검증 결과 경로가 아직 준비되지 않았습니다.";
    case "INVALID_TOKEN":
      return "게임 세션이 유효하지 않거나 만료되었습니다.";
    case "CONTEXT_MISMATCH":
      return "게임 세션이 이 요청과 일치하지 않습니다. 다시 시작해 주세요.";
    case "MANIFEST_NOT_CONFIGURED":
      return "이 게임에는 유효한 owogg.json 결과 계약이 없습니다.";
    case "INVALID_DIFFICULTY":
      return reason || "유효하지 않은 난이도입니다.";
    case "INVALID_RESULT":
      return reason || "게임 결과가 owogg.json 계약과 일치하지 않습니다.";
    case "ALREADY_CONSUMED":
      return "이미 처리된 플레이입니다.";
  }
}

function verifiedResultAcceptErrorStatus(
  error: GameVerifiedResultAcceptError,
): 400 | 401 | 404 | 409 | 503 {
  switch (error) {
    case "GAME_NOT_AVAILABLE":
      return 404;
    case "INVALID_TOKEN":
    case "CONTEXT_MISMATCH":
      return 401;
    case "CLAIM_CONFLICT":
    case "VERIFICATION_IN_PROGRESS":
      return 409;
    case "PLAY_CONFIG_NOT_CONFIGURED":
    case "VERIFIER_NOT_REGISTERED":
    case "CLAIM_AUTHORITY_UNAVAILABLE":
    case "VERIFIER_EXECUTION_FAILED":
    case "VERIFIER_INVALID_OUTPUT":
    case "CLAIM_STATE_ERROR":
    case "RESULT_PERSISTENCE_UNAVAILABLE":
      return 503;
    default:
      return 400;
  }
}

function verifiedResultAcceptErrorMessage(
  error: GameVerifiedResultAcceptError,
  reason?: string,
): string {
  switch (error) {
    case "GAME_NOT_AVAILABLE":
      return "게임을 찾을 수 없습니다.";
    case "GAME_DISABLED":
      return "현재 비활성화된 게임입니다.";
    case "INVALID_TOKEN":
      return "게임 세션이 유효하지 않거나 만료되었습니다.";
    case "CONTEXT_MISMATCH":
      return "게임 세션이 이 요청과 일치하지 않습니다. 다시 시작해 주세요.";
    case "CLAIM_CONFLICT":
      return "이미 다른 플레이 증거가 제출된 세션입니다.";
    case "VERIFICATION_IN_PROGRESS":
      return "이 플레이 증거를 이미 검증하고 있습니다.";
    case "VERIFIER_REJECTED":
      return reason ? `플레이 증거가 거절되었습니다: ${reason}` : "플레이 증거가 거절되었습니다.";
    case "PLAY_CONFIG_NOT_CONFIGURED":
    case "VERIFIER_NOT_REGISTERED":
      return "이 게임의 서버 검증기가 아직 준비되지 않았습니다.";
    case "CLAIM_AUTHORITY_UNAVAILABLE":
    case "RESULT_PERSISTENCE_UNAVAILABLE":
    case "CLAIM_STATE_ERROR":
      return "서버 검증 결과를 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.";
    case "VERIFIER_EXECUTION_FAILED":
    case "VERIFIER_INVALID_OUTPUT":
      return "서버 검증기가 유효한 결과를 만들지 못했습니다.";
    default:
      return "플레이 증거가 허용된 형식이나 크기 제한을 충족하지 않습니다.";
  }
}

async function recordAcceptedResultRewards(
  container: AppContainer,
  input: {
    readonly userId: number;
    readonly gameId: number;
    readonly slug: string;
    readonly resultId: number;
    readonly normalized: NormalizedGameCreatorResult;
    readonly xpPerCompletion: number;
    readonly achievements: readonly OwoggAchievementDefinition[];
    readonly playToken?: string | undefined;
  },
): Promise<{
  xpAwarded: number;
  guildXpAwarded: number;
  guildId?: string | undefined;
  newlyUnlockedAchievements: string[];
}> {
  let xpAwarded = 0;
  let guildXpAwarded = 0;
  let guildId: string | undefined;
  let newlyUnlockedAchievements: string[] = [];
  if (!input.normalized.rewardEligible) {
    return { xpAwarded, guildXpAwarded, newlyUnlockedAchievements };
  }

  try {
    const completion = await container.progressionUseCases.recordAcceptedGameCompletion({
      userId: input.userId,
      gameId: input.slug,
      sourceType: "result",
      sourceId: String(input.resultId),
      xpPerCompletion: input.xpPerCompletion,
    });
    xpAwarded = completion.xpAwarded;
    newlyUnlockedAchievements = await container.gameAchievementUseCases.evaluate({
      userId: input.userId,
      gameId: input.gameId,
      resultId: input.resultId,
      result: input.normalized,
      achievements: input.achievements,
    });

    if (input.playToken && completion.xpEventId) {
      const guild = await container.discordGuildXpUseCases.attributeCompletionToGuild({
        userId: input.userId,
        gameId: input.slug,
        sourceXpEventId: completion.xpEventId,
        xpAmount: xpAwarded,
        playToken: input.playToken,
      });
      if (guild.attributed) {
        guildXpAwarded = guild.amount ?? 0;
        guildId = guild.guildId;
      }
    }

    const platformAchievements = await evaluateAchievementsForUser(container, input.userId);
    newlyUnlockedAchievements = Array.from(
      new Set([...newlyUnlockedAchievements, ...platformAchievements]),
    );
  } catch (error) {
    console.error("Game Creator result progression error:", error);
  }

  return {
    xpAwarded,
    guildXpAwarded,
    ...(guildId ? { guildId } : {}),
    newlyUnlockedAchievements,
  };
}

// Unified Manifest v1 result acceptance. gs1 carries declared client facts; gs2 carries only bounded
// evidence for a trusted verifier. Both tokens stay in the parent host and never cross the iframe.
gamesRouter.post("/:slug/result", rateLimit({ name: "game-result-accept" }), async (c) => {
  if (!c.env?.DB) return c.text("Not Found", 404);
  const secret = c.env.GAME_SESSION_SECRET;
  if (!secret) {
    return c.json(
      {
        error: {
          code: "GAME_SESSION_NOT_CONFIGURED",
          message: "게임 세션 서명 키가 아직 이 환경에 구성되지 않았습니다.",
        },
      },
      503,
    );
  }

  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
  }
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const authData = await container.sessionRepo.findSession(sessionId);
  if (!authData) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
  }
  if (authData.user.score_submission_blocked) {
    return c.json(
      {
        error: { code: "SCORE_SUBMISSION_BLOCKED", message: "현재 결과 제출이 제한된 계정입니다." },
      },
      403,
    );
  }

  const body = await readBoundedJsonBody(c.req.raw, MAX_GAME_RESULT_REQUEST_BYTES);
  if (!body.ok) {
    return c.json(
      {
        error: {
          code: body.error,
          message:
            body.error === "REQUEST_TOO_LARGE"
              ? "결과 제출 본문이 허용 크기를 초과했습니다."
              : "요청 형식이 올바르지 않습니다.",
        },
      },
      body.error === "REQUEST_TOO_LARGE" ? 413 : 400,
    );
  }

  const parsed = GameResultAcceptRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_PAYLOAD", message: "요청 형식이 올바르지 않습니다." } },
      400,
    );
  }

  if ("evidence" in parsed.data) {
    const evidence = await canonicalizeGameEvidence(parsed.data.evidence);
    if (!evidence.ok) {
      return c.json(
        {
          error: {
            code: evidence.code,
            message: "플레이 증거가 허용된 형식이나 크기 제한을 충족하지 않습니다.",
          },
        },
        400,
      );
    }

    const accepted = await container.gameVerifiedResultAcceptanceUseCases.accept({
      slug: c.req.param("slug"),
      userId: authData.user.id,
      nickname: authData.user.nickname,
      avatarUrl: authData.user.avatar_url,
      token: parsed.data.token,
      secret,
      evidence: evidence.value,
    });
    if (!accepted.ok) {
      return c.json(
        {
          error: {
            code: accepted.error,
            message: verifiedResultAcceptErrorMessage(accepted.error, accepted.reason),
          },
        },
        verifiedResultAcceptErrorStatus(accepted.error),
      );
    }

    const rewards = await recordAcceptedResultRewards(container, {
      userId: authData.user.id,
      gameId: accepted.gameId,
      slug: accepted.slug,
      resultId: accepted.resultId,
      normalized: accepted.normalized,
      xpPerCompletion: accepted.xpPerCompletion,
      achievements: accepted.achievements,
      ...(parsed.data.playToken ? { playToken: parsed.data.playToken } : {}),
    });
    return c.json(
      GameResultAcceptResponseSchema.parse({
        success: true,
        result_id: accepted.resultId,
        score_id: accepted.scoreId,
        game_id: accepted.slug,
        score: accepted.competitiveScore,
        rawScore: accepted.normalized.rawScore,
        normalizedScore: accepted.normalized.normalizedScore,
        competitiveScore: accepted.competitiveScore,
        difficultyId: accepted.difficultyId,
        variantId: accepted.variantId,
        rulesetRevision: accepted.rulesetRevision,
        verified: true,
        adjusted: false,
        rewardEligible: accepted.normalized.rewardEligible,
        xpAwarded: rewards.xpAwarded,
        ...(rewards.guildXpAwarded > 0 || rewards.guildId
          ? { guildXpAwarded: rewards.guildXpAwarded, guildId: rewards.guildId }
          : {}),
        newlyUnlockedAchievements: rewards.newlyUnlockedAchievements,
      }),
      200,
    );
  }

  const accepted = await container.gameResultAcceptanceUseCases.accept({
    slug: c.req.param("slug"),
    userId: authData.user.id,
    nickname: authData.user.nickname,
    avatarUrl: authData.user.avatar_url,
    token: parsed.data.token,
    secret,
    difficulty: parsed.data.difficulty,
    result: {
      ...(parsed.data.outcome !== undefined ? { outcome: parsed.data.outcome } : {}),
      ...(parsed.data.score !== undefined ? { score: parsed.data.score } : {}),
      ...(parsed.data.progression !== undefined ? { progression: parsed.data.progression } : {}),
      ...(parsed.data.metrics !== undefined ? { metrics: parsed.data.metrics } : {}),
      ...(parsed.data.events !== undefined ? { events: parsed.data.events } : {}),
    },
  });
  if (!accepted.ok) {
    return c.json(
      {
        error: {
          code: accepted.error,
          message: gameResultAcceptErrorMessage(accepted.error, accepted.reason),
        },
      },
      gameResultAcceptErrorStatus(accepted.error),
    );
  }

  const rewards = await recordAcceptedResultRewards(container, {
    userId: authData.user.id,
    gameId: accepted.gameId,
    slug: accepted.slug,
    resultId: accepted.resultId,
    normalized: accepted.normalized,
    xpPerCompletion: accepted.xpPerCompletion,
    achievements: accepted.achievements,
    ...(parsed.data.playToken ? { playToken: parsed.data.playToken } : {}),
  });

  return c.json(
    GameResultAcceptResponseSchema.parse({
      success: true,
      result_id: accepted.resultId,
      score_id: accepted.scoreId,
      game_id: accepted.slug,
      score: accepted.normalized.normalizedScore,
      rawScore: accepted.normalized.rawScore,
      normalizedScore: accepted.normalized.normalizedScore,
      competitiveScore: accepted.normalized.normalizedScore,
      difficultyId: accepted.difficultyId,
      variantId: "standard",
      rulesetRevision: 1,
      verified: false,
      adjusted: accepted.normalized.adjusted,
      rewardEligible: accepted.normalized.rewardEligible,
      xpAwarded: rewards.xpAwarded,
      ...(rewards.guildXpAwarded > 0 || rewards.guildId
        ? { guildXpAwarded: rewards.guildXpAwarded, guildId: rewards.guildId }
        : {}),
      newlyUnlockedAchievements: rewards.newlyUnlockedAchievements,
    }),
    200,
  );
});
