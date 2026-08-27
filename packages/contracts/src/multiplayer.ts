import { z } from "zod";

/** Exact text frames handled by the Durable Object WebSocket auto-response path. They contain no
 * identity or credential and keep an idle browser connection alive without waking a hibernated
 * game instance. */
export const MULTIPLAYER_HEARTBEAT_REQUEST = "owogg.multiplayer.heartbeat.v1";
export const MULTIPLAYER_HEARTBEAT_RESPONSE = "owogg.multiplayer.heartbeat-ack.v1";

const OpaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
const StableIdentifierSchema = z.string().regex(/^[a-z0-9][a-z0-9._:/-]{0,95}$/);
const GameSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const PublicRoomCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{12,64}$/);
const InviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);

export const MultiplayerRuntimeStatusResponseSchema = z
  .object({
    status: z.enum(["DISABLED", "NOT_READY", "READY"]),
    protocolVersion: z.literal(1),
  })
  .strict();
export type MultiplayerRuntimeStatusResponse = z.infer<
  typeof MultiplayerRuntimeStatusResponseSchema
>;

const MultiplayerPublicProfileSchema = z
  .object({
    profileRevision: z.number().int().positive(),
    resolvedClass: z.enum(["M1", "M2"]),
    simulationModel: z.enum(["turn", "event", "realtime"]),
    rulesetKey: StableIdentifierSchema,
    rulesetRevision: z.number().int().positive(),
    reconnectPolicy: z.enum(["none", "rejoin", "resume"]),
    minPlayers: z.number().int().min(2).max(8),
    maxPlayers: z.number().int().min(2).max(8),
    allowedVisibility: z.array(z.enum(["PUBLIC", "UNLISTED", "PRIVATE"])).min(1),
    allowedJoinPolicies: z.array(z.enum(["OPEN", "INVITE_ONLY"])).min(1),
  })
  .strict();

/**
 * Public, credential-free capability discovery. The server exposes only UI-safe profile facts;
 * resolved config, profile ids, tickets, socket paths, and user identity never enter this shape.
 */
export const MultiplayerGameAvailabilityResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("UNAVAILABLE"),
      protocolVersion: z.literal(1),
    })
    .strict(),
  z
    .object({
      status: z.literal("AVAILABLE"),
      protocolVersion: z.literal(1),
      gameSlug: GameSlugSchema,
      profile: MultiplayerPublicProfileSchema,
    })
    .strict(),
]);
export type MultiplayerGameAvailabilityResponse = z.infer<
  typeof MultiplayerGameAvailabilityResponseSchema
>;

export const AdminOfficialMultiplayerProfileUpdateRequestSchema = z
  .object({
    preset: z.literal("OMOK_V1"),
    enabled: z.boolean(),
    reasonCode: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.enabled && value.reasonCode != null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCode"],
        message: "reasonCode is forbidden when enabling",
      });
    }
  });
export type AdminOfficialMultiplayerProfileUpdateRequest = z.infer<
  typeof AdminOfficialMultiplayerProfileUpdateRequestSchema
>;

const AdminOfficialMultiplayerProfileSchema = z
  .object({
    id: z.number().int().positive(),
    profileRevision: z.number().int().positive(),
    enabled: z.boolean(),
    rulesetKey: z.literal("official:omok"),
    // Revision 1 remains readable for immutable in-flight matches and audited upgrades; all new
    // official Omok profiles are emitted as revision 2 by the server-owned preset.
    rulesetRevision: z.union([z.literal(1), z.literal(2)]),
    resolvedClass: z.literal("M1"),
    simulationModel: z.literal("turn"),
    reconnectPolicy: z.literal("resume"),
    minPlayers: z.literal(2),
    maxPlayers: z.literal(2),
    allowedVisibility: z.tuple([z.literal("PRIVATE")]),
    // Legacy Staging profiles used one-use invite credentials. Keep that exact historical
    // shape readable so an administrator can perform the audited preset upgrade; newly created
    // OMOK_V1 revisions use the single room-code access policy.
    allowedJoinPolicies: z.union([
      z.tuple([z.literal("OPEN")]),
      z.tuple([z.literal("INVITE_ONLY")]),
    ]),
    rewardPolicyId: z.null(),
    leaderboardEnabled: z.literal(false),
    updatedAt: z.string().datetime(),
  })
  .strict();

const AdminOfficialMultiplayerProfileResponseBase = {
  gameSlug: GameSlugSchema,
  gameVersionId: z.number().int().positive(),
  preset: z.literal("OMOK_V1"),
} as const;

export const AdminOfficialMultiplayerProfileResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      ...AdminOfficialMultiplayerProfileResponseBase,
      status: z.literal("NONE"),
      profile: z.null(),
    })
    .strict(),
  z
    .object({
      ...AdminOfficialMultiplayerProfileResponseBase,
      status: z.literal("ENABLED"),
      profile: AdminOfficialMultiplayerProfileSchema.extend({ enabled: z.literal(true) }).strict(),
    })
    .strict(),
  z
    .object({
      ...AdminOfficialMultiplayerProfileResponseBase,
      status: z.literal("DISABLED"),
      profile: AdminOfficialMultiplayerProfileSchema.extend({ enabled: z.literal(false) }).strict(),
    })
    .strict(),
]);
export type AdminOfficialMultiplayerProfileResponse = z.infer<
  typeof AdminOfficialMultiplayerProfileResponseSchema
>;

const ManagedMultiplayerManifestRequestSchema = z
  .object({
    requestVersion: z.literal(1),
    kind: z.literal("managed-template"),
    template: z
      .object({
        id: z.enum(["turn-grid", "reaction-arena", "realtime-paddle"]),
        version: z.literal(1),
      })
      .strict(),
    players: z
      .object({ min: z.number().int().min(2).max(64), max: z.number().int().min(2).max(64) })
      .strict(),
    requirements: z
      .object({
        simulation: z.enum(["turn", "event", "continuous", "rollback"]),
        lifecycle: z.enum(["match", "continuous", "persistent"]),
        persistence: z.enum(["none", "match", "player", "world"]),
        latency: z.enum(["relaxed", "interactive", "critical"]),
        reconnect: z.enum(["none", "rejoin", "resume"]),
        hiddenInformation: z.boolean(),
        simultaneousResponse: z.boolean(),
        joinInProgress: z.boolean(),
        spectators: z.boolean(),
      })
      .strict(),
    config: z.record(z.number().int()).refine((value) => Object.keys(value).length <= 8),
    client: z.object({ protocolVersion: z.literal(1) }).strict(),
  })
  .strict();

const AdminManagedMultiplayerProfileRequestSchema = z
  .object({
    id: z.number().int().positive(),
    gameId: z.number().int().positive(),
    gameVersionId: z.number().int().positive(),
    requestSchemaVersion: z.literal(1),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    request: ManagedMultiplayerManifestRequestSchema,
    requestedByUserId: z.number().int().positive().nullable(),
    status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN"]),
    reviewedByAdminId: z.number().int().positive().nullable(),
    reviewedAt: z.string().datetime().nullable(),
    decisionReasonCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
      .nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    resolution: z
      .object({
        status: z.literal("SUPPORTED_V1"),
        resolvedClass: z.enum(["M1", "M2"]),
        runtimeBackend: z.literal("durable-object"),
      })
      .strict(),
  })
  .strict();

const AdminManagedMultiplayerProfileSchema = z
  .object({
    id: z.number().int().positive(),
    profileRevision: z.number().int().positive(),
    enabled: z.boolean(),
    resolvedClass: z.enum(["M1", "M2"]),
    simulationModel: z.enum(["turn", "event", "realtime"]),
    rulesetKey: StableIdentifierSchema,
    rulesetRevision: z.number().int().positive(),
    minPlayers: z.number().int().min(2).max(8),
    maxPlayers: z.number().int().min(2).max(8),
    rewardPolicyId: z.null(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const AdminManagedMultiplayerProfileRequestListResponseSchema = z
  .object({ requests: z.array(AdminManagedMultiplayerProfileRequestSchema).max(100) })
  .strict();
export type AdminManagedMultiplayerProfileRequestListResponse = z.infer<
  typeof AdminManagedMultiplayerProfileRequestListResponseSchema
>;

export const AdminManagedMultiplayerProfileReviewRequestSchema = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED"]),
    reasonCode: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "APPROVED" && value.reasonCode != null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCode"],
        message: "reasonCode is forbidden for approval",
      });
    }
    if (value.decision === "REJECTED" && value.reasonCode == null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCode"],
        message: "reasonCode is required for rejection",
      });
    }
  });
export type AdminManagedMultiplayerProfileReviewRequest = z.infer<
  typeof AdminManagedMultiplayerProfileReviewRequestSchema
>;

export const AdminManagedMultiplayerProfileReviewResponseSchema = z
  .object({
    request: AdminManagedMultiplayerProfileRequestSchema,
    profile: AdminManagedMultiplayerProfileSchema.nullable(),
  })
  .strict();
export type AdminManagedMultiplayerProfileReviewResponse = z.infer<
  typeof AdminManagedMultiplayerProfileReviewResponseSchema
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

export const MultiplayerCreateRoomRequestSchema = z
  .object({
    gameSlug: GameSlugSchema,
    visibility: z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]),
    joinPolicy: z.enum(["OPEN", "INVITE_ONLY"]),
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict();
export type MultiplayerCreateRoomRequest = z.infer<typeof MultiplayerCreateRoomRequestSchema>;

export const MultiplayerJoinRoomRequestSchema = z
  .object({
    publicCode: PublicRoomCodeSchema,
    inviteToken: InviteTokenSchema.nullable().optional().default(null),
  })
  .strict();
export type MultiplayerJoinRoomRequest = z.infer<typeof MultiplayerJoinRoomRequestSchema>;

export const MultiplayerLeaveRoomRequestSchema = z
  .object({
    expectedGeneration: z.number().int().positive(),
  })
  .strict();
export type MultiplayerLeaveRoomRequest = z.infer<typeof MultiplayerLeaveRoomRequestSchema>;

export const MultiplayerStartRoomRequestSchema = z
  .object({
    expectedGeneration: z.number().int().positive(),
  })
  .strict();
export type MultiplayerStartRoomRequest = z.infer<typeof MultiplayerStartRoomRequestSchema>;

export const MultiplayerSetReadyRequestSchema = z
  .object({
    expectedGeneration: z.number().int().positive(),
    ready: z.boolean(),
  })
  .strict();
export type MultiplayerSetReadyRequest = z.infer<typeof MultiplayerSetReadyRequestSchema>;

export const MultiplayerCreateInviteRequestSchema = z
  .object({
    expectedGeneration: z.number().int().positive(),
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict();
export type MultiplayerCreateInviteRequest = z.infer<typeof MultiplayerCreateInviteRequestSchema>;

export const MultiplayerRoomInstanceSchema = z
  .object({
    id: OpaqueIdSchema,
    publicCode: PublicRoomCodeSchema,
    gameId: z.number().int().positive(),
    gameVersionId: z.number().int().positive(),
    profileRevision: z.number().int().positive(),
    visibility: z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]),
    joinPolicy: z.enum(["OPEN", "INVITE_ONLY"]),
    status: z.enum([
      "CREATED",
      "LOBBY",
      "STARTING",
      "ACTIVE",
      "CLOSING",
      "CLOSED",
      "ABORTED",
      "EXPIRED",
    ]),
    generation: z.number().int().positive(),
    participantCount: z.number().int().nonnegative(),
    maxPlayers: z.number().int().min(2).max(8),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type MultiplayerRoomInstance = z.infer<typeof MultiplayerRoomInstanceSchema>;

export const MultiplayerRoomParticipantSchema = z
  .object({
    id: OpaqueIdSchema,
    role: z.enum(["HOST", "PLAYER"]),
    seatIndex: z.number().int().min(0).max(7),
    status: z.enum(["JOINED", "READY", "LEFT", "KICKED"]),
    connectionGeneration: z.number().int().nonnegative(),
  })
  .strict();
export type MultiplayerRoomParticipant = z.infer<typeof MultiplayerRoomParticipantSchema>;

export const MultiplayerRoomResponseSchema = z
  .object({
    replayed: z.boolean(),
    instance: MultiplayerRoomInstanceSchema,
    participant: MultiplayerRoomParticipantSchema,
  })
  .strict();
export type MultiplayerRoomResponse = z.infer<typeof MultiplayerRoomResponseSchema>;

export const MultiplayerRoomPlayerSchema = z
  .object({
    participantId: OpaqueIdSchema,
    role: z.enum(["HOST", "PLAYER"]),
    seatIndex: z.number().int().min(0).max(7),
    status: z.enum(["JOINED", "READY"]),
    nickname: z.string().min(1).max(20),
    avatarUrl: z.string().nullable(),
  })
  .strict();
export type MultiplayerRoomPlayer = z.infer<typeof MultiplayerRoomPlayerSchema>;

/** Authenticated parent-only roster. Global user ids and provider identities never enter the
 * sandbox bridge; only the same public nickname/avatar already used by OwOGG profile surfaces is
 * returned to a current participant. */
export const MultiplayerRoomRosterResponseSchema = z
  .object({
    instanceId: OpaqueIdSchema,
    generation: z.number().int().positive(),
    instance: MultiplayerRoomInstanceSchema,
    players: z.array(MultiplayerRoomPlayerSchema).max(8),
  })
  .strict();
export type MultiplayerRoomRosterResponse = z.infer<typeof MultiplayerRoomRosterResponseSchema>;

export const MultiplayerRematchRequestSchema = z
  .object({ expectedGeneration: z.number().int().positive() })
  .strict();
export type MultiplayerRematchRequest = z.infer<typeof MultiplayerRematchRequestSchema>;

const MultiplayerRematchResponseBase = {
  requestedBySelf: z.boolean(),
  requestedByOpponent: z.boolean(),
} as const;

export const MultiplayerRematchResponseSchema = z.discriminatedUnion("state", [
  z
    .object({
      ...MultiplayerRematchResponseBase,
      state: z.enum(["AVAILABLE", "WAITING", "OPPONENT_REQUESTED"]),
      room: z.null(),
    })
    .strict(),
  z
    .object({
      ...MultiplayerRematchResponseBase,
      state: z.literal("STARTED"),
      room: MultiplayerRoomResponseSchema,
    })
    .strict(),
]);
export type MultiplayerRematchResponse = z.infer<typeof MultiplayerRematchResponseSchema>;

export const MultiplayerCreateInviteResponseSchema = z
  .object({
    replayed: z.boolean(),
    inviteToken: InviteTokenSchema,
    expiresAt: z.string().datetime(),
    maxUses: z.literal(1),
  })
  .strict();
export type MultiplayerCreateInviteResponse = z.infer<typeof MultiplayerCreateInviteResponseSchema>;
