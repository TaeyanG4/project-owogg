import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { createContainer, evaluateAchievementsForUser } from "../container.js";
import { createReadContainer } from "../readReplica.js";
import { edgeCache } from "../middleware/edgeCache.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { readB2Config } from "./devGames.js";
import { scoreSubmissionSchema } from "@owogg/contracts";
import { formatScore } from "@owogg/game-sdk/contracts";
import { validateDifficultyAgainstDefinition, type GameScoreAcceptError } from "@owogg/core";
import type { ApiEnv } from "./auth.js";

export const scoresRouter = new Hono<ApiEnv>();

function scoreAcceptErrorStatus(error: GameScoreAcceptError): 400 | 401 | 404 | 409 | 503 {
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
    default:
      return 400;
  }
}

function scoreAcceptErrorMessage(error: GameScoreAcceptError, reason?: string): string {
  switch (error) {
    case "GAME_NOT_AVAILABLE":
      return "게임을 찾을 수 없습니다.";
    case "GAME_DISABLED":
      return "현재 비활성화된 게임입니다.";
    case "MULTIPLAYER_MANAGED":
      return "이 게임 버전의 점수는 서버가 확정한 멀티플레이 결과로만 기록됩니다.";
    case "MULTIPLAYER_AUTHORITY_UNAVAILABLE":
      return "멀티플레이 권한 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.";
    case "INVALID_TOKEN":
      return "게임 세션이 유효하지 않거나 만료되었습니다.";
    case "CONTEXT_MISMATCH":
      return "게임 세션이 이 요청과 일치하지 않습니다. 다시 시작해 주세요.";
    case "SCORE_POLICY_NOT_CONFIGURED":
      return "이 게임은 아직 점수 제출을 지원하지 않습니다.";
    case "INVALID_DIFFICULTY":
      return reason ?? "유효하지 않은 난이도입니다.";
    case "INVALID_SCORE":
      return reason ?? "유효하지 않은 점수입니다.";
    case "ALREADY_CONSUMED":
      return "이미 처리된 플레이입니다.";
  }
}

// POST /api/scores — the most D1-expensive endpoint in the app (~10-15 serialized queries per
// submission), so it is rate limited ahead of any DB work. The configured ceiling is far above
// what human play can produce: the fastest game is a 30-second round, so a real player cannot
// approach it, while a submission loop is capped before it can monopolize D1's throughput.
scoresRouter.post("/", rateLimit({ name: "score-submit" }), async (c) => {
  try {
    const sessionId = getCookie(c, "owogg_session");
    if (!sessionId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const container = createContainer(c.env.DB, readB2Config(c.env));
    const { sessionRepo, gameScoreAcceptanceUseCases } = container;

    let authData;
    try {
      authData = await sessionRepo.findSession(sessionId);
    } catch {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!authData) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Score-submission block (see UserModerationUseCases) — a lighter tool than SUSPENDED/BANNED,
    // which are already enforced by findSession itself (an actually-suspended/banned user never
    // gets this far — authData would be null). This lets an admin stop a specific abuser from
    // polluting leaderboards without locking them out of the rest of the site.
    if (authData.user.score_submission_blocked) {
      return c.json(
        {
          error: {
            code: "SCORE_SUBMISSION_BLOCKED",
            message: "현재 점수 제출이 제한된 계정입니다.",
          },
        },
        403,
      );
    }

    const rawBody = await c.req.json().catch(() => ({}));
    const parseResult = scoreSubmissionSchema.safeParse({
      gameId: rawBody.game_id ?? rawBody.gameId,
      score: rawBody.score,
      grade: rawBody.grade,
      metadata: rawBody.metadata,
      playToken: rawBody.playToken ?? rawBody.play_token,
      gameSessionToken: rawBody.gameSessionToken ?? rawBody.game_session_token ?? rawBody.token,
      timestamp: rawBody.timestamp,
      difficulty: rawBody.difficulty,
    });

    if (!parseResult.success) {
      return c.json({ error: "Invalid payload", details: parseResult.error.errors }, 400);
    }

    const { gameId, score } = parseResult.data;
    const gameSessionToken = parseResult.data.gameSessionToken;
    if (!gameSessionToken) {
      return c.json(
        { error: { code: "SIGNED_GAME_SESSION_REQUIRED", message: "게임 세션이 필요합니다." } },
        401,
      );
    }

    // Server identity strictly from session user
    const userId = authData.user.id;
    const nickname = authData.user.nickname;
    const avatarUrl = authData.user.avatar_url;

    const secret = c.env.GAME_SESSION_SECRET;
    if (!secret) {
      return c.json(
        {
          error: { code: "GAME_SESSION_NOT_CONFIGURED", message: "게임 세션 서명 키가 없습니다." },
        },
        503,
      );
    }

    const result = await gameScoreAcceptanceUseCases.accept({
      slug: gameId,
      userId,
      nickname,
      avatarUrl,
      token: gameSessionToken,
      secret,
      score,
      difficulty: parseResult.data.difficulty,
    });
    if (!result.ok) {
      const status = scoreAcceptErrorStatus(result.error);
      return c.json(
        {
          error: {
            code: result.error,
            message: scoreAcceptErrorMessage(result.error, result.reason),
          },
        },
        status,
      );
    }

    // Progression side-effects: server-authoritative XP for this accepted, authenticated
    // completion (idempotent by the saved score's own row id), then re-evaluate
    // achievements. Never influences the score/leaderboard above.
    let xpAwarded = 0;
    let guildXpAwarded = 0;
    let guildId: string | undefined = undefined;
    let newlyUnlockedAchievements: string[] = [];
    try {
      const completion = await container.progressionUseCases.recordAcceptedGameCompletion({
        userId,
        gameId: result.slug,
        sourceId: String(result.scoreId),
        xpPerCompletion: result.xpPerCompletion,
      });
      xpAwarded = completion.xpAwarded;

      if (parseResult.data.playToken && completion.xpEventId) {
        const guildAttr = await container.discordGuildXpUseCases.attributeCompletionToGuild({
          userId,
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

      // Achievement re-evaluation is 3 further reads (progression summary, personal bests,
      // personalization) plus any unlock writes — the largest remaining block of D1 work in this
      // request, and the only part the caller does not need before it can render the result
      // screen. Deferred via waitUntil so it runs after the response is sent: the submission's
      // latency (and its hold on D1's serialized queue) drops accordingly, while the work still
      // completes. `newlyUnlockedAchievements` is declared optional in scoreSubmissionResponse
      // and is not read by the web client, so omitting it here is within the contract; the
      // profile/achievements screens read unlock state from the DB on their own next load.
      const deferredAchievements = evaluateAchievementsForUser(container, userId).catch(
        (achievementErr) => {
          console.error("Deferred Achievement Evaluation Error:", achievementErr);
        },
      );
      try {
        c.executionCtx.waitUntil(deferredAchievements);
      } catch {
        // No ExecutionContext (test runner / non-Workers host): await inline so the behavior is
        // still correct and observable, just without the latency benefit.
        newlyUnlockedAchievements = (await deferredAchievements) ?? [];
      }
    } catch (progressionErr) {
      // Progression bookkeeping must never fail the score submission itself.
      console.error("Progression Update Error:", progressionErr);
    }

    return c.json({
      success: true,
      score_id: result.scoreId,
      game_id: result.slug,
      score,
      nickname,
      xpAwarded,
      ...(guildXpAwarded > 0 || guildId ? { guildXpAwarded, guildId } : {}),
      newlyUnlockedAchievements,
    });
  } catch (err) {
    console.error("Submit Score Error:", err);
    return c.json({ error: "Failed to submit score" }, 500);
  }
});

// GET /api/scores/user/me
scoresRouter.get("/user/me", async (c) => {
  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) {
    return c.json({ authenticated: false, bests: {} });
  }

  try {
    const { sessionRepo, scoreReadUseCases } = createContainer(c.env.DB, readB2Config(c.env));
    const authData = await sessionRepo.findSession(sessionId);

    if (!authData) {
      return c.json({ authenticated: false, bests: {} });
    }

    const bests = await scoreReadUseCases.getUserBests(authData.user.id);

    return c.json({
      authenticated: true,
      user_id: authData.user.id,
      bests,
    });
  } catch (err) {
    console.error("Get My Scores Error:", err);
    return c.json({ authenticated: false, bests: {} });
  }
});

/** Shared public row shape. Resolution and policy formatting both come from the generic runtime
 * object, never from a publisher-specific registry. */
function formatLeaderboardEntry(
  item: {
    id: number;
    user_id: number | null;
    nickname: string;
    avatar_url: string | null;
    game_id: string;
    score: number;
    difficulty: string;
    created_at: string;
  },
  gameTitle: string,
  formattedScore: string,
) {
  return {
    id: item.id,
    user_id: item.user_id,
    nickname: item.nickname,
    playerName: item.nickname,
    avatar_url: item.avatar_url,
    avatarUrl: item.avatar_url,
    gameId: item.game_id,
    gameTitle,
    score: item.score,
    formattedScore,
    difficulty: item.difficulty,
    createdAt: item.created_at?.split("T")[0] ?? item.created_at,
    created_at: item.created_at,
  };
}

// GET /api/scores/:gameId — one generic leaderboard path for OWOGG and USER. The D1 identity/live
// guard and canonical policy are both required; incomplete B2/D1 state fails closed.
scoresRouter.get("/:gameId", edgeCache({ ttlSeconds: 30 }), async (c) => {
  const gameId = c.req.param("gameId");
  if (!c.env?.DB) {
    return c.json(
      { error: { code: "INVALID_GAME_ID", message: "존재하지 않는 게임 ID입니다." } },
      400,
    );
  }

  try {
    const container = createContainer(c.env.DB, readB2Config(c.env));
    const runtime = await container.runtimeGameRegistry.findBySlug(gameId);
    if (
      !runtime ||
      !(await container.runtimeGameAvailability.isVersionServable(
        runtime.identity.id,
        runtime.liveVersion.id,
      ))
    ) {
      return c.json(
        { error: { code: "INVALID_GAME_ID", message: "존재하지 않는 게임 ID입니다." } },
        400,
      );
    }

    // Managed multiplayer has canonical match history, not a score ranking. This exact-version
    // authority gate also hides any stale pre-multiplayer scores if a game is converted later;
    // profile lookup failure fails closed to an empty board instead of reopening legacy reads.
    const legacyFlow = await container.multiplayerLegacyFlowGate.evaluate(
      runtime.identity.id,
      runtime.liveVersion.id,
    );
    if (!legacyFlow.allowed) {
      return c.json({ game_id: gameId, leaderboard: [] });
    }

    if (!runtime.canonical.policy.leaderboard || runtime.canonical.policy.score === null) {
      return c.json({ game_id: gameId, leaderboard: [] });
    }

    const difficulty = validateDifficultyAgainstDefinition(
      runtime.canonical.difficulty,
      c.req.query("difficulty"),
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

    // Runtime identity/version/canonical and availability above deliberately stay on the primary.
    // Only this staleness-tolerant public score-row read opts into D1's read-replica session.
    const readContainer = createReadContainer(c.env.DB);
    const rows = await readContainer.scoreRepo.getLeaderboard(
      gameId,
      20,
      runtime.canonical.policy.score.direction,
      difficulty.normalizedDifficultyId,
    );
    return c.json({
      game_id: gameId,
      leaderboard: rows.map((item) =>
        formatLeaderboardEntry(
          item,
          runtime.canonical.title,
          formatScore(item.score, runtime.canonical.policy.score ?? undefined),
        ),
      ),
    });
  } catch (err) {
    console.error("Get Leaderboard Error:", err);
    return c.json({ game_id: gameId, leaderboard: [] });
  }
});
