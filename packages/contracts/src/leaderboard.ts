import { z } from "zod";

export const LeaderRecordSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    playerName: z.string().optional(),
    nickname: z.string().optional(),
    gameId: z.string().optional(),
    game_id: z.string().optional(),
    gameTitle: z.string().optional(),
    score: z.number(),
    formattedScore: z.string().optional(),
    grade: z.string().optional(),
    createdAt: z.string().optional(),
    created_at: z.string().optional(),
    avatarUrl: z.string().nullable().optional(),
    avatar_url: z.string().nullable().optional(),
    /** Null for guest (unauthenticated) scores — no public profile to link to. */
    userId: z.number().nullable().optional(),
    user_id: z.number().nullable().optional(),
    difficulty: z.string().optional(),
    variantId: z.string().optional(),
    variant_id: z.string().optional(),
    rulesetRevision: z.number().int().positive().optional(),
    ruleset_revision: z.number().int().positive().optional(),
  })
  .transform((data) => ({
    id: String(data.id),
    playerName: data.playerName || data.nickname || "게스트",
    gameId: data.gameId || data.game_id || "all",
    gameTitle: data.gameTitle,
    score: data.score,
    formattedScore: data.formattedScore || `${data.score}`,
    grade: data.grade,
    createdAt: data.createdAt || data.created_at || "",
    avatarUrl: data.avatarUrl || data.avatar_url || null,
    userId: data.userId ?? data.user_id ?? null,
    difficulty: data.difficulty || "normal",
    variantId: data.variantId || data.variant_id || "standard",
    rulesetRevision: data.rulesetRevision ?? data.ruleset_revision ?? 1,
  }));

export type LeaderRecord = z.infer<typeof LeaderRecordSchema>;

export const LeaderboardResponseSchema = z.object({
  game_id: z.string().optional(),
  gameId: z.string().optional(),
  leaderboard: z.array(LeaderRecordSchema),
});

export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;
