import { z } from "zod";

/** Upload permission record for one user — see packages/db/migrations/0025_staff_roles_and_game_creator_program.sql
 * (renamed from game_developers; same rows, same ids, same meaning). GAME_CREATOR is a Program/
 * Entitlement, never a Staff Role — see packages/core/src/domain/staffRoles.ts. */
export const GameCreatorAccessStatusSchema = z.enum(["ACTIVE", "REVOKED"]);

export const GameCreatorAccessRecordSchema = z.object({
  userId: z.number().int().positive(),
  grantedByAdminId: z.number().int().positive(),
  status: GameCreatorAccessStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GameCreatorAccessRecord = z.infer<typeof GameCreatorAccessRecordSchema>;

export const GameCreatorAccessAuditEntrySchema = z.object({
  id: z.number().int(),
  targetUserId: z.number().int(),
  actorAdminId: z.number().int(),
  action: z.enum(["GRANTED", "REVOKED", "REINSTATED"]),
  createdAt: z.string(),
});
export type GameCreatorAccessAuditEntry = z.infer<typeof GameCreatorAccessAuditEntrySchema>;

export const GameCreatorGrantRequestSchema = z.object({
  userId: z.number().int().positive(),
});
export type GameCreatorGrantRequest = z.infer<typeof GameCreatorGrantRequestSchema>;

export const GameCreatorAccessListResponseSchema = z.object({
  creators: z.array(GameCreatorAccessRecordSchema),
});
export type GameCreatorAccessListResponse = z.infer<typeof GameCreatorAccessListResponseSchema>;

// ── Self-serve application flow ──────────────────────────────────────────────

export const GameCreatorApplicationStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
]);
export type GameCreatorApplicationStatusValue = z.infer<typeof GameCreatorApplicationStatusSchema>;

export const GameCreatorApplicationRecordSchema = z.object({
  id: z.number().int().positive(),
  userId: z.number().int().positive(),
  status: GameCreatorApplicationStatusSchema,
  message: z.string().nullable(),
  reviewedByAdminId: z.number().int().positive().nullable(),
  reviewedAt: z.string().nullable(),
  rejectReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GameCreatorApplicationRecord = z.infer<typeof GameCreatorApplicationRecordSchema>;

export const GameCreatorApplyRequestSchema = z.object({
  message: z.string().trim().max(1000).nullable().optional(),
});
export type GameCreatorApplyRequest = z.infer<typeof GameCreatorApplyRequestSchema>;

export const GameCreatorApplicationListResponseSchema = z.object({
  items: z.array(GameCreatorApplicationRecordSchema),
  total: z.number().int().nonnegative(),
});
export type GameCreatorApplicationListResponse = z.infer<
  typeof GameCreatorApplicationListResponseSchema
>;

export const GameCreatorApplicationDecisionRequestSchema = z.object({
  rejectReason: z.string().trim().max(1000).nullable().optional(),
});
export type GameCreatorApplicationDecisionRequest = z.infer<
  typeof GameCreatorApplicationDecisionRequestSchema
>;

/** GET /api/dev/me — everything a session needs to render "신청하기" vs "신청 대기 중" vs "게임
 * 게임 크리에이터 센터" without a second round-trip. Also carries `isAdmin` (unrelated to the Game
 * Creator program itself) since the settings/Game-Creator-Center UI has always needed to know
 * that too, to show admin-only review links alongside the Game Creator's own tools — kept on this one
 * response rather than a second call. Replaces the old narrower DevMeResponseSchema
 * ({isGameDeveloper, isAdmin}) from the game_developers-only era. */
export const GameCreatorMeResponseSchema = z.object({
  hasAccess: z.boolean(),
  canApply: z.boolean(),
  latestApplication: GameCreatorApplicationRecordSchema.nullable(),
  isAdmin: z.boolean(),
});
export type GameCreatorMeResponse = z.infer<typeof GameCreatorMeResponseSchema>;
