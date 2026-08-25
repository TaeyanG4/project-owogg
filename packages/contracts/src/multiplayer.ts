import { z } from "zod";

const OpaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
const StableIdentifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._:/-]{0,95}$/);

export const MultiplayerRuntimeStatusResponseSchema = z
  .object({
    status: z.enum(["DISABLED", "NOT_READY", "READY"]),
    protocolVersion: z.literal(1),
  })
  .strict();
export type MultiplayerRuntimeStatusResponse = z.infer<
  typeof MultiplayerRuntimeStatusResponseSchema
>;

export const MultiplayerJoinTicketRequestSchema = z
  .object({
    expectedConnectionGeneration: z.number().int().nonnegative(),
  })
  .strict();
export type MultiplayerJoinTicketRequest = z.infer<typeof MultiplayerJoinTicketRequestSchema>;

export const MultiplayerBootstrapSchema = z
  .object({
    type: z.literal("MULTI_INIT"),
    v: z.literal(1),
    participantId: OpaqueIdSchema,
    gameVersionId: z.number().int().positive(),
    profileRevision: z.number().int().positive(),
    rulesetKey: StableIdentifierSchema,
    rulesetRevision: z.number().int().positive(),
    generation: z.number().int().positive(),
  })
  .strict();
export type MultiplayerBootstrap = z.infer<typeof MultiplayerBootstrapSchema>;

/**
 * Parent-only WebSocket admission response. `socketPath` is relative, never an iframe-visible API
 * address; the second protocol value carries the short-lived bearer ticket without putting it in
 * a URL. The parent forwards only `bootstrap` and later canonical messages to the game iframe.
 */
export const MultiplayerJoinTicketResponseSchema = z
  .object({
    socketPath: z.string().regex(/^\/api\/multiplayer\/instances\/[A-Za-z0-9_-]{8,128}\/socket$/),
    protocols: z.tuple([
      z.literal("owogg.multiplayer.v1"),
      z.string().startsWith("owogg.ticket.").max(2200),
    ]),
    expiresAt: z.string().datetime(),
    connectionGeneration: z.number().int().positive(),
    bootstrap: MultiplayerBootstrapSchema,
  })
  .strict();
export type MultiplayerJoinTicketResponse = z.infer<typeof MultiplayerJoinTicketResponseSchema>;
