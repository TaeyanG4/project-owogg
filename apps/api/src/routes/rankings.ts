import { Hono } from "hono";
import { PublicRankingQuerySchema, PublicRankingResponseSchema } from "@owogg/contracts";
import { formatScore, type ScoreConfig } from "@owogg/game-sdk/contracts";
import { validateDifficultyAgainstDefinition } from "@owogg/core";
import { createContainer } from "../container.js";
import { createReadContainer } from "../readReplica.js";
import { edgeCache } from "../middleware/edgeCache.js";
import { readB2Config } from "./devGames.js";
import type { ApiEnv } from "./auth.js";

export const rankingsRouter = new Hono<ApiEnv>();

rankingsRouter.get("/", edgeCache({ ttlSeconds: 30 }), async (c) => {
  const parsed = PublicRankingQuerySchema.safeParse({
    scope: c.req.query("scope"),
    metric: c.req.query("metric"),
    period: c.req.query("period"),
    gameId: c.req.query("gameId"),
    difficulty: c.req.query("difficulty"),
    platform: c.req.query("platform"),
    limit: c.req.query("limit"),
  });
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_QUERY", message: "랭킹 검색 조건이 올바르지 않습니다." } },
      400,
    );
  }
  if (!c.env?.DB) {
    return c.json(
      { error: { code: "DATABASE_UNAVAILABLE", message: "랭킹을 불러올 수 없습니다." } },
      503,
    );
  }

  const query = parsed.data;
  let scoreAuthority:
    | {
        gameId: string;
        difficulty: string;
        rulesetRevision: number;
        direction: "asc" | "desc";
        scoreConfig: ScoreConfig;
      }
    | undefined;

  if (query.metric === "score") {
    const gameId = query.gameId;
    if (!gameId) {
      return c.json(
        { error: { code: "INVALID_QUERY", message: "게임 랭킹에는 게임 ID가 필요합니다." } },
        400,
      );
    }
    const primary = createContainer(c.env.DB, readB2Config(c.env));
    const runtime = await primary.runtimeGameRegistry.findBySlug(gameId);
    if (
      !runtime ||
      !(await primary.runtimeGameAvailability.isVersionServable(
        runtime.identity.id,
        runtime.liveVersion.id,
      ))
    ) {
      return c.json(
        { error: { code: "INVALID_GAME_ID", message: "존재하지 않는 게임 ID입니다." } },
        400,
      );
    }

    const authority = await primary.selectedTopologyAuthorityGate.evaluate(
      runtime.identity.id,
      runtime.liveVersion.id,
    );
    const scoreConfig = runtime.canonical.policy.score;
    if (!authority.allowed || !runtime.canonical.policy.leaderboard || scoreConfig === null) {
      return c.json(
        { error: { code: "RANKING_DISABLED", message: "이 게임은 랭킹을 지원하지 않습니다." } },
        400,
      );
    }

    const difficulty = validateDifficultyAgainstDefinition(
      runtime.canonical.difficulty,
      query.difficulty,
    );
    if (!difficulty.valid) {
      return c.json(
        { error: { code: "INVALID_DIFFICULTY", message: "기본 난이도가 올바르지 않습니다." } },
        400,
      );
    }
    scoreAuthority = {
      gameId,
      difficulty: difficulty.normalizedDifficultyId,
      rulesetRevision: runtime.canonical.playConfig?.rulesetRevision ?? 1,
      direction: scoreConfig.direction,
      scoreConfig,
    };
  }

  const { publicRankingUseCases } = createReadContainer(c.env.DB);
  const result = await publicRankingUseCases.getRanking({
    scope: query.scope,
    metric: query.metric,
    period: query.period,
    ...(scoreAuthority
      ? {
          gameId: scoreAuthority.gameId,
          difficulty: scoreAuthority.difficulty,
          rulesetRevision: scoreAuthority.rulesetRevision,
          direction: scoreAuthority.direction,
        }
      : {}),
    ...(query.platform ? { platform: query.platform } : {}),
    limit: query.limit,
  });

  return c.json(
    PublicRankingResponseSchema.parse({
      scope: query.scope,
      metric: query.metric,
      period: query.period,
      periodStart: result.startAt,
      periodEnd: result.endAt,
      entries: result.rows.map((row) => ({
        ...row,
        formattedValue:
          query.metric === "score" && scoreAuthority
            ? formatScore(row.value, scoreAuthority.scoreConfig)
            : query.metric === "xp"
              ? `${row.value.toLocaleString()} XP`
              : String(row.value),
      })),
    }),
  );
});
