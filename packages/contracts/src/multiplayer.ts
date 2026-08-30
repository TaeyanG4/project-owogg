import { z } from "zod";

/** Exact text frames handled by the Durable Object WebSocket auto-response path. They contain no
 * identity or credential and keep an idle browser connection alive without waking a hibernated
 * game instance. */
export const MULTIPLAYER_HEARTBEAT_REQUEST = "owogg.multiplayer.heartbeat.v1";
export const MULTIPLAYER_HEARTBEAT_RESPONSE = "owogg.multiplayer.heartbeat-ack.v1";
/** Parent-only waiting-room signal channel. Authentication remains in the OwOGG session cookie;
 * the channel carries no session, ticket, global user id, or provider identity. Join deltas may
 * contain the same public nickname/avatar already exposed by the authenticated room roster. */
export const MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL = "owogg.multiplayer.lobby-signal.v1";

const OpaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
const GameSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const PublicRoomCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{12,64}$/);
const InviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);

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

export const MultiplayerLobbySignalChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("INVALIDATE") }).strict(),
  z
    .object({
      kind: z.literal("ROOM_CLOSED"),
      status: z.enum(["ABORTED", "CLOSED", "EXPIRED"]),
      changedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("PARTICIPANT_JOINED"),
      player: MultiplayerRoomPlayerSchema,
      changedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("PARTICIPANT_LEFT"),
      participantId: OpaqueIdSchema,
      changedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("PARTICIPANT_READY"),
      participantId: OpaqueIdSchema,
      status: z.enum(["JOINED", "READY"]),
      changedAt: z.string().datetime(),
    })
    .strict(),
]);
export type MultiplayerLobbySignalChange = z.infer<typeof MultiplayerLobbySignalChangeSchema>;

export const MultiplayerLobbySignalChangedMessageSchema = z
  .object({
    type: z.literal("LOBBY_SIGNAL_CHANGED"),
    v: z.literal(1),
    instanceId: OpaqueIdSchema,
    generation: z.number().int().positive(),
    change: MultiplayerLobbySignalChangeSchema,
  })
  .strict();
export type MultiplayerLobbySignalChangedMessage = z.infer<
  typeof MultiplayerLobbySignalChangedMessageSchema
>;

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
    gameVersionId: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    profileRevision: z.number().int().positive(),
    transportKind: z.literal("websocket"),
    runtimeKind: z.literal("relay"),
    reconnectPolicy: z.enum(["none", "resume"]),
    directMessages: z.boolean(),
    hostSnapshot: z.boolean(),
    minPlayers: z.number().int().min(2).max(8),
    maxPlayers: z.number().int().min(2).max(8),
    allowedVisibility: z.array(z.enum(["PUBLIC", "UNLISTED", "PRIVATE"])).min(1),
    allowedJoinPolicies: z.array(z.enum(["OPEN", "INVITE_ONLY"])).min(1),
    resultTrust: z.literal("UNVERIFIED"),
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

const MultiplayerRuntimeManifestRequestSchema = z
  .object({
    version: z.literal(1),
    transport: z.object({ kind: z.literal("websocket"), protocolVersion: z.literal(1) }).strict(),
    runtime: z.object({ kind: z.enum(["relay", "worker", "container"]) }).strict(),
    players: z
      .object({ min: z.number().int().min(2).max(8), max: z.number().int().min(2).max(8) })
      .strict()
      .refine((value) => value.min <= value.max, { message: "min cannot exceed max" }),
    features: z
      .object({
        reconnect: z.enum(["none", "resume"]),
        directMessages: z.boolean(),
        hostSnapshot: z.boolean(),
        joinInProgress: z.boolean(),
        spectators: z.boolean(),
      })
      .strict(),
  })
  .strict();

const AdminManagedMultiplayerProfileRequestSchema = z
  .object({
    id: z.number().int().positive(),
    gameId: z.number().int().positive(),
    gameVersionId: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    requestSchemaVersion: z.literal(1),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    request: MultiplayerRuntimeManifestRequestSchema,
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
    resolution: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("SUPPORTED_V1"),
          transportKind: z.literal("websocket"),
          runtimeKind: z.literal("relay"),
          protocolVersion: z.literal(1),
          resultTrust: z.literal("UNVERIFIED"),
        })
        .strict(),
      z
        .object({
          status: z.literal("RUNTIME_NOT_AVAILABLE"),
          runtimeKind: z.enum(["worker", "container"]),
          reason: z.literal("MULTIPLAYER_RUNTIME_NOT_AVAILABLE"),
        })
        .strict(),
      z
        .object({
          status: z.literal("CAPABILITY_NOT_AVAILABLE"),
          runtimeKind: z.literal("relay"),
          unsupportedCapabilities: z
            .array(z.enum(["joinInProgress", "spectators"]))
            .min(1)
            .max(2),
          reason: z.literal("MULTIPLAYER_CAPABILITY_NOT_AVAILABLE"),
        })
        .strict(),
    ]),
  })
  .strict();

export const AdminManagedMultiplayerProfileSchema = z
  .object({
    id: z.number().int().positive(),
    gameVersionId: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    profileRevision: z.number().int().positive(),
    enabled: z.boolean(),
    transportKind: z.literal("websocket"),
    runtimeKind: z.literal("relay"),
    protocolVersion: z.literal(1),
    reconnect: z.enum(["none", "resume"]),
    directMessages: z.boolean(),
    hostSnapshot: z.boolean(),
    minPlayers: z.number().int().min(2).max(8),
    maxPlayers: z.number().int().min(2).max(8),
    resultTrust: z.literal("UNVERIFIED"),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type AdminManagedMultiplayerProfile = z.infer<typeof AdminManagedMultiplayerProfileSchema>;

/** Per-game control-plane snapshot for the current live immutable version. This keeps review and
 * activation visible next to the game being operated without restoring a global review queue. */
export const AdminManagedMultiplayerExactVersionResponseSchema = z
  .object({
    gameSlug: GameSlugSchema,
    gameId: z.number().int().positive(),
    gameVersionId: z.number().int().positive().nullable(),
    request: AdminManagedMultiplayerProfileRequestSchema.nullable(),
    profile: AdminManagedMultiplayerProfileSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.gameVersionId === null) {
      if (value.request !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["request"],
          message: "request requires a live game version",
        });
      }
      if (value.profile !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["profile"],
          message: "profile requires a live game version",
        });
      }
      return;
    }
    if (
      value.request !== null &&
      (value.request.gameId !== value.gameId || value.request.gameVersionId !== value.gameVersionId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["request"],
        message: "request must match the exact live game version",
      });
    }
    if (value.profile !== null && value.profile.gameVersionId !== value.gameVersionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile"],
        message: "profile must match the exact live game version",
      });
    }
    if (
      value.request !== null &&
      value.profile !== null &&
      value.request.contentHash !== value.profile.contentHash
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile", "contentHash"],
        message: "profile content hash must match the reviewed request",
      });
    }
  });
export type AdminManagedMultiplayerExactVersionResponse = z.infer<
  typeof AdminManagedMultiplayerExactVersionResponseSchema
>;

export const AdminManagedMultiplayerProfileListResponseSchema = z
  .object({ profiles: z.array(AdminManagedMultiplayerProfileSchema).max(100) })
  .strict();
export type AdminManagedMultiplayerProfileListResponse = z.infer<
  typeof AdminManagedMultiplayerProfileListResponseSchema
>;

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

export const AdminManagedMultiplayerProfileActivationRequestSchema = z
  .object({
    enabled: z.boolean(),
    reasonCode: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{0,63}$/)
      .nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.enabled && value.reasonCode !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCode"],
        message: "reasonCode is forbidden when enabling",
      });
    }
    if (!value.enabled && value.reasonCode === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasonCode"],
        message: "reasonCode is required when disabling",
      });
    }
  });
export type AdminManagedMultiplayerProfileActivationRequest = z.infer<
  typeof AdminManagedMultiplayerProfileActivationRequestSchema
>;

export const AdminManagedMultiplayerProfileActivationResponseSchema = z
  .object({
    request: AdminManagedMultiplayerProfileRequestSchema,
    profile: AdminManagedMultiplayerProfileSchema,
  })
  .strict();
export type AdminManagedMultiplayerProfileActivationResponse = z.infer<
  typeof AdminManagedMultiplayerProfileActivationResponseSchema
>;

export const MultiplayerJoinTicketRequestSchema = z
  .object({
    expectedConnectionGeneration: z.number().int().nonnegative(),
  })
  .strict();
export type MultiplayerJoinTicketRequest = z.infer<typeof MultiplayerJoinTicketRequestSchema>;

export const MultiplayerBootstrapParticipantSchema = z
  .object({
    participantId: OpaqueIdSchema,
    seatIndex: z.number().int().min(0).max(7),
    role: z.enum(["HOST", "PLAYER"]),
  })
  .strict();

export const MultiplayerBootstrapRuntimeSchema = z
  .object({
    kind: z.literal("relay"),
    protocolVersion: z.literal(1),
    resultTrust: z.literal("UNVERIFIED"),
  })
  .strict();

export const MultiplayerBootstrapCapabilitiesSchema = z
  .object({
    reconnect: z.enum(["none", "resume"]),
    broadcast: z.literal(true),
    directMessages: z.boolean(),
    hostSnapshot: z.boolean(),
  })
  .strict();

export const MultiplayerBootstrapSchema = z
  .object({
    type: z.literal("MULTI_INIT"),
    v: z.literal(1),
    gameVersionId: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    profileRevision: z.number().int().positive(),
    generation: z.number().int().positive(),
    runtime: MultiplayerBootstrapRuntimeSchema,
    self: MultiplayerBootstrapParticipantSchema,
    roster: z.array(MultiplayerBootstrapParticipantSchema).min(2).max(8),
    capabilities: MultiplayerBootstrapCapabilitiesSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const participantIds = new Set(value.roster.map((participant) => participant.participantId));
    const seatIndexes = new Set(value.roster.map((participant) => participant.seatIndex));
    if (participantIds.size !== value.roster.length) {
      context.addIssue({
        code: "custom",
        path: ["roster"],
        message: "participant ids must be unique",
      });
    }
    if (seatIndexes.size !== value.roster.length) {
      context.addIssue({
        code: "custom",
        path: ["roster"],
        message: "seat indexes must be unique",
      });
    }
    if (value.roster.filter((participant) => participant.role === "HOST").length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["roster"],
        message: "roster must contain one host",
      });
    }
    if (
      value.roster.some((participant, index) => {
        if (index === 0) return false;
        const previousParticipant = value.roster[index - 1];
        return (
          previousParticipant !== undefined &&
          participant.seatIndex <= previousParticipant.seatIndex
        );
      })
    ) {
      context.addIssue({
        code: "custom",
        path: ["roster"],
        message: "roster must be seat ordered",
      });
    }
    if (
      !value.roster.some(
        (participant) =>
          participant.participantId === value.self.participantId &&
          participant.seatIndex === value.self.seatIndex &&
          participant.role === value.self.role,
      )
    ) {
      context.addIssue({ code: "custom", path: ["self"], message: "self must match roster" });
    }
  });
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
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
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

/** Room create/join admission includes the current public roster so the parent UI can render the
 * lobby immediately. Later membership and ready-state changes still travel over the hibernating
 * lobby WebSocket; this snapshot only closes the gap before that socket is connected. */
export const MultiplayerRoomAdmissionResponseSchema = MultiplayerRoomResponseSchema.extend({
  players: z.array(MultiplayerRoomPlayerSchema).max(8),
}).strict();
export type MultiplayerRoomAdmissionResponse = z.infer<
  typeof MultiplayerRoomAdmissionResponseSchema
>;

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

export const MultiplayerCreateInviteResponseSchema = z
  .object({
    replayed: z.boolean(),
    inviteToken: InviteTokenSchema,
    expiresAt: z.string().datetime(),
    maxUses: z.literal(1),
  })
  .strict();
export type MultiplayerCreateInviteResponse = z.infer<typeof MultiplayerCreateInviteResponseSchema>;
