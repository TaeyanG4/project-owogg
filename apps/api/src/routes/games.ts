import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import {
  GameScoreAcceptRequestSchema,
  GameScoreAcceptResponseSchema,
  GameResultAcceptRequestSchema,
  GameResultAcceptResponseSchema,
  GameSessionResponseSchema,
  PublicGameAvailabilityResponseSchema,
  PublicGameListResponseSchema,
  PublicGameSchema,
} from "@owogg/contracts";
import {
  GAME_SESSION_POLICY,
  emptyPublicGameStats,
  publicGameMediaUrl,
  resolveBundleContentType,
  toPublicGame,
  validateDifficultyAgainstDefinition,
  signGameSession,
  type GameScoreAcceptError,
  type GameResultAcceptError,
  type GameSessionPayload,
  type RuntimeGame,
  type PublicGameStats,
} from "@owogg/core";
import { createContainer, evaluateAchievementsForUser, type AppContainer } from "../container.js";
import { edgeCache } from "../middleware/edgeCache.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { readB2Config } from "./devGames.js";
import type { ApiEnv } from "./auth.js";

// Same local requireAuth as streamers.ts/discordGuilds.ts — not shared from auth.ts, matching this
// codebase's existing per-route-file convention rather than introducing a shared import for it.
async function requireAuth(
  c: Context<ApiEnv>,
): Promise<{ userId: number; user: { id: number; nickname: string } } | null> {
  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) return null;
  const { sessionRepo } = createContainer(c.env.DB);
  const result = await sessionRepo.findSession(sessionId);
  if (!result) return null;
  return { userId: result.user.id, user: { id: result.user.id, nickname: result.user.nickname } };
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
    return c.json(PublicGameAvailabilityResponseSchema.parse({ disabledGameIds: [] }), 200);
  }

  const { gameSettingsUseCases } = createContainer(c.env.DB);
  const disabledGameIds = await gameSettingsUseCases.getDisabledGameIds();

  return c.json(PublicGameAvailabilityResponseSchema.parse({ disabledGameIds }), 200);
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
  return c.json(PublicGameSchema.parse(game), 200);
});

// ── Generic Game Session ─────────────────────────────────────────────────────
//
// The session is issued only for the exact generic D1 identity/live READY version and its
// canonical difficulty. The token is held by the parent Web host and is never sent to the iframe.

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

  const legacyFlow = await container.multiplayerLegacyFlowGate.evaluate(
    runtime.identity.id,
    runtime.liveVersion.id,
  );
  if (!legacyFlow.allowed) {
    const unavailable = legacyFlow.error === "MULTIPLAYER_AUTHORITY_UNAVAILABLE";
    return c.json(
      {
        error: {
          code: legacyFlow.error,
          message: unavailable
            ? "멀티플레이 권한 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요."
            : "이 게임 버전은 서버 관리형 멀티플레이 세션만 지원합니다.",
        },
      },
      unavailable ? 503 : 409,
    );
  }

  const rawBody = await c.req.json().catch(() => ({}));
  const difficulty = validateDifficultyAgainstDefinition(
    runtime.canonical.difficulty,
    typeof rawBody?.difficulty === "string" ? rawBody.difficulty : undefined,
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

// Game Creator Manifest v1 result acceptance. Tokens stay in the parent host; the iframe reports only
// declared facts over MessageChannel, and this endpoint revalidates every fact against B2 canonical.
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

  const parsed = GameResultAcceptRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_PAYLOAD", message: "요청 형식이 올바르지 않습니다." } },
      400,
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

  let xpAwarded = 0;
  let guildXpAwarded = 0;
  let guildId: string | undefined;
  let newlyUnlockedAchievements: string[] = [];
  if (accepted.normalized.rewardEligible) {
    try {
      const completion = await container.progressionUseCases.recordAcceptedGameCompletion({
        userId: authData.user.id,
        gameId: accepted.slug,
        sourceType: "result",
        sourceId: String(accepted.resultId),
        xpPerCompletion: accepted.xpPerCompletion,
      });
      xpAwarded = completion.xpAwarded;
      newlyUnlockedAchievements = await container.gameAchievementUseCases.evaluate({
        userId: authData.user.id,
        gameId: accepted.gameId,
        resultId: accepted.resultId,
        result: accepted.normalized,
        achievements: accepted.achievements,
      });

      if (parsed.data.playToken && completion.xpEventId) {
        const guild = await container.discordGuildXpUseCases.attributeCompletionToGuild({
          userId: authData.user.id,
          gameId: accepted.slug,
          sourceXpEventId: completion.xpEventId,
          xpAmount: xpAwarded,
          playToken: parsed.data.playToken,
        });
        if (guild.attributed) {
          guildXpAwarded = guild.amount ?? 0;
          guildId = guild.guildId;
        }
      }

      const platformAchievements = await evaluateAchievementsForUser(container, authData.user.id);
      newlyUnlockedAchievements = Array.from(
        new Set([...newlyUnlockedAchievements, ...platformAchievements]),
      );
    } catch (error) {
      console.error("Game Creator result progression error:", error);
    }
  }

  return c.json(
    GameResultAcceptResponseSchema.parse({
      success: true,
      result_id: accepted.resultId,
      score_id: accepted.scoreId,
      game_id: accepted.slug,
      score: accepted.normalized.normalizedScore,
      adjusted: accepted.normalized.adjusted,
      rewardEligible: accepted.normalized.rewardEligible,
      xpAwarded,
      ...(guildXpAwarded > 0 || guildId ? { guildXpAwarded, guildId } : {}),
      newlyUnlockedAchievements,
    }),
    200,
  );
});
