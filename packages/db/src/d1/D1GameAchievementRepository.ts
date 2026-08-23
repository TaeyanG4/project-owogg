import type { GameAchievementRepository } from "@owogg/core";
import type { D1Database } from "./D1UserRepository.js";

type AggregateInput = Parameters<GameAchievementRepository["aggregate"]>[0];

export class D1GameAchievementRepository implements GameAchievementRepository {
  constructor(private readonly db: D1Database) {}

  async aggregate(input: AggregateInput): Promise<number | null> {
    let expression: string;
    let jsonPath: string | undefined;
    switch (input.source) {
      case "score":
        expression = "normalized_score";
        break;
      case "progression":
        expression = "progression_value";
        break;
      case "metric":
        if (!input.key) return null;
        expression = "json_extract(metrics_json, ?)";
        jsonPath = `$.${input.key}`;
        break;
      case "event":
        if (!input.key) return null;
        expression = "json_extract(events_json, ?)";
        jsonPath = `$.${input.key}`;
        break;
    }

    const aggregateExpression =
      input.aggregate === "count"
        ? input.source === "event"
          ? `SUM(COALESCE(${expression}, 0))`
          : `COUNT(${expression})`
        : `${input.aggregate.toUpperCase()}(${expression})`;
    const statement = this.db.prepare(
      `SELECT ${aggregateExpression} AS value
       FROM game_results
       WHERE user_id = ? AND game_id = ? AND reward_eligible = 1`,
    );
    const row = await (
      jsonPath
        ? statement.bind(jsonPath, input.userId, input.gameId)
        : statement.bind(input.userId, input.gameId)
    ).first<{ value: number | null }>();
    if (row?.value === null || row?.value === undefined) return null;
    const value = Number(row.value);
    return Number.isFinite(value) ? value : null;
  }

  async unlock(input: {
    userId: number;
    gameId: number;
    achievementId: string;
    resultId: number;
    unlockedAt: string;
  }): Promise<boolean> {
    const write = await this.db
      .prepare(
        `INSERT INTO user_game_achievements (
           user_id, game_id, achievement_id, unlocked_at, source_result_id
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, game_id, achievement_id) DO NOTHING`,
      )
      .bind(input.userId, input.gameId, input.achievementId, input.unlockedAt, input.resultId)
      .run();
    return (write.meta?.changes ?? 0) > 0;
  }
}
