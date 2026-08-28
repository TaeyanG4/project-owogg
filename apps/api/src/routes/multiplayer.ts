import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import {
  MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL,
  MultiplayerCreateInviteRequestSchema,
  MultiplayerCreateInviteResponseSchema,
  MultiplayerCreateRoomRequestSchema,
  MultiplayerGameAvailabilityResponseSchema,
  MultiplayerJoinTicketRequestSchema,
  MultiplayerJoinTicketResponseSchema,
  MultiplayerJoinRoomRequestSchema,
  MultiplayerLeaveRoomRequestSchema,
  MultiplayerRematchRequestSchema,
  MultiplayerRematchResponseSchema,
  MultiplayerRoomResponseSchema,
  MultiplayerRoomRosterResponseSchema,
  MultiplayerRuntimeStatusResponseSchema,
  MultiplayerSetReadyRequestSchema,
  MultiplayerStartRoomRequestSchema,
  type MultiplayerLobbySignalChange,
} from "@owogg/contracts";
import {
  MULTIPLAYER_ERROR_HTTP_STATUS,
  MULTIPLAYER_WEBSOCKET_PROTOCOL,
  isSupportedMultiplayerRuntimeProfile,
  parseMultiplayerWebSocketProtocols,
  verifyMultiplayerJoinTicket,
  type MultiplayerErrorCode,
  type MultiplayerRematchResult,
} from "@owogg/core";
import { createContainer } from "../container.js";
import { readB2Config } from "./devGames.js";
import {
  isMultiplayerFeatureEnabled,
  isTrustedMultiplayerSocketRequest,
  readMultiplayerRuntimeConfig,
} from "../multiplayer/config.js";
import {
  MULTIPLAYER_INTERNAL_CLAIMS_HEADER,
  MULTIPLAYER_INTERNAL_CONNECT_PATH,
  MULTIPLAYER_INTERNAL_LEAVE_PATH,
  MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_CLAIMS_HEADER,
  MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_CONNECT_PATH,
  MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_NOTIFY_PATH,
  MULTIPLAYER_INTERNAL_PROTOCOL_HEADER,
  MULTIPLAYER_INTERNAL_REMATCH_NOTIFY_PATH,
  encodeVerifiedMultiplayerLobbySignalClaims,
  encodeVerifiedMultiplayerClaims,
} from "../multiplayer/internalProtocol.js";
import type { ApiEnv } from "./auth.js";

const PUBLIC_MESSAGES: Readonly<Record<MultiplayerErrorCode, string>> = {
  INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
  UNAUTHENTICATED: "로그인이 필요합니다.",
  FORBIDDEN: "요청 권한이 없습니다.",
  MULTIPLAYER_UNAVAILABLE: "멀티플레이 기능을 사용할 수 없습니다.",
  PROFILE_DISABLED: "현재 멀티플레이 입장이 중지되었습니다.",
  VERSION_MISMATCH: "게임 버전이 더 이상 유효하지 않습니다.",
  IDEMPOTENCY_CONFLICT: "같은 요청 식별자가 다른 방 생성 요청에 이미 사용되었습니다.",
  INSTANCE_NOT_FOUND: "게임 방을 찾을 수 없습니다.",
  INSTANCE_NOT_JOINABLE: "현재 입장할 수 없는 게임 방입니다.",
  INSTANCE_FULL: "게임 방이 가득 찼습니다.",
  INVITE_INVALID: "초대가 유효하지 않습니다.",
  INVITE_EXHAUSTED: "초대 사용 횟수가 만료되었습니다.",
  ALREADY_JOINED: "이미 참가 중입니다.",
  PLAYERS_NOT_READY: "모든 참가자가 준비되고 최소 인원이 모여야 시작할 수 있습니다.",
  MATCH_NOT_ACTIVE: "진행 중인 매치가 아닙니다.",
  NOT_PARTICIPANT: "이 게임 방의 참가자가 아닙니다.",
  NOT_YOUR_TURN: "현재 행동할 차례가 아닙니다.",
  ACTION_INVALID: "허용되지 않은 행동입니다.",
  ACTION_CONFLICT: "동시에 처리된 행동과 충돌했습니다.",
  ACTION_ID_REUSED: "이미 다른 행동에 사용된 식별자입니다.",
  STALE_GENERATION: "연결 상태가 변경되었습니다. 다시 동기화해주세요.",
  TICKET_INVALID: "연결 티켓이 유효하지 않습니다.",
  TICKET_EXPIRED: "연결 티켓이 만료되었습니다.",
  TICKET_REPLAYED: "이미 사용된 연결 티켓입니다.",
  RATE_LIMITED: "요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.",
  INTERNAL_RETRYABLE: "일시적인 오류가 발생했습니다. 다시 시도해주세요.",
};
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
function failure(c: Context<ApiEnv>, code: MultiplayerErrorCode) {
  return c.json(
    { error: { code, message: PUBLIC_MESSAGES[code] } },
    MULTIPLAYER_ERROR_HTTP_STATUS[code],
  );
}

function runtimeReady(env: ApiEnv["Bindings"]): boolean {
  return Boolean(
    readMultiplayerRuntimeConfig(env) &&
    env.MULTIPLAYER_INSTANCES &&
    env.MULTIPLAYER_LOBBY_SIGNALS &&
    env.MULTIPLAYER_RATE_LIMITER &&
    env.MULTIPLAYER_RECOVERY_RATE_LIMITER,
  );
}

async function takeRateLimit(
  env: ApiEnv["Bindings"],
  key: string,
  capacity: "ACTION" | "RECOVERY" = "ACTION",
): Promise<"ALLOWED" | "DENIED" | "UNAVAILABLE"> {
  const limiter =
    capacity === "RECOVERY" ? env.MULTIPLAYER_RECOVERY_RATE_LIMITER : env.MULTIPLAYER_RATE_LIMITER;
  if (!limiter) return "UNAVAILABLE";
  try {
    return (await limiter.limit({ key })).success ? "ALLOWED" : "DENIED";
  } catch {
    // Multiplayer is not yet a site-critical availability path. A missing/broken mandatory abuse
    // control therefore fails closed instead of silently exposing an unbounded WebSocket edge.
    return "UNAVAILABLE";
  }
}

function requestRateKey(
  c: Context<ApiEnv>,
  operation:
    | "create"
    | "join"
    | "ready"
    | "start"
    | "leave"
    | "invite"
    | "roster"
    | "ticket"
    | "socket"
    | "lobby-signal",
): string {
  // Keep callers behind the same home/campus/mobile NAT independent while never exposing the
  // full bearer credential to Cloudflare rate-limit logs. This mirrors the platform-wide write
  // limiter: authenticated traffic gets a coarse session prefix, unauthenticated traffic falls
  // back to the edge-provided address.
  const session = getCookie(c, "owogg_session");
  const identity = session
    ? `s:${session.slice(0, 16)}`
    : `ip:${c.req.header("CF-Connecting-IP") ?? "unknown"}`;
  return `multiplayer:${operation}:${identity}`;
}

function publicRoom(instance: {
  readonly id: string;
  readonly publicCode: string;
  readonly gameId: number;
  readonly gameVersionId: number;
  readonly profileRevision: number;
  readonly visibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
  readonly joinPolicy: "OPEN" | "INVITE_ONLY";
  readonly status:
    "CREATED" | "LOBBY" | "STARTING" | "ACTIVE" | "CLOSING" | "CLOSED" | "ABORTED" | "EXPIRED";
  readonly generation: number;
  readonly participantCount: number;
  readonly maxPlayers: number;
  readonly expiresAt: string;
}) {
  return {
    id: instance.id,
    publicCode: instance.publicCode,
    gameId: instance.gameId,
    gameVersionId: instance.gameVersionId,
    profileRevision: instance.profileRevision,
    visibility: instance.visibility,
    joinPolicy: instance.joinPolicy,
    status: instance.status,
    generation: instance.generation,
    participantCount: instance.participantCount,
    maxPlayers: instance.maxPlayers,
    expiresAt: instance.expiresAt,
  };
}

function publicParticipant(participant: {
  readonly id: string;
  readonly role: "HOST" | "PLAYER";
  readonly seatIndex: number;
  readonly status: "JOINED" | "READY" | "LEFT" | "KICKED";
  readonly connectionGeneration: number;
}) {
  return {
    id: participant.id,
    role: participant.role,
    seatIndex: participant.seatIndex,
    status: participant.status,
    connectionGeneration: participant.connectionGeneration,
  };
}

function publicRematch(result: Extract<MultiplayerRematchResult, { readonly ok: true }>) {
  return MultiplayerRematchResponseSchema.parse({
    state: result.state,
    requestedBySelf: result.requestedBySelf,
    requestedByOpponent: result.requestedByOpponent,
    room:
      result.state === "STARTED"
        ? {
            replayed: false,
            instance: publicRoom(result.instance),
            participant: publicParticipant(result.participant),
          }
        : null,
  });
}

function notifyRematchChange(c: Context<ApiEnv>, instanceId: string, generation: number): void {
  const namespace = c.env.MULTIPLAYER_INSTANCES;
  if (!namespace) return;
  const notification = namespace
    .get(namespace.idFromName(instanceId))
    .fetch(
      new Request(`https://multiplayer.internal${MULTIPLAYER_INTERNAL_REMATCH_NOTIFY_PATH}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [MULTIPLAYER_INTERNAL_PROTOCOL_HEADER]: MULTIPLAYER_WEBSOCKET_PROTOCOL,
        },
        body: JSON.stringify({ generation }),
      }),
    )
    .then(() => undefined)
    .catch(() => undefined);
  try {
    c.executionCtx.waitUntil(notification);
  } catch {
    // Hono's direct unit-test request helper has no ExecutionContext. The already-started promise
    // remains harmless; production Workers always attach it to waitUntil.
  }
}

async function notifyLobbySignal(
  c: Context<ApiEnv>,
  instanceId: string,
  generation: number,
  change: MultiplayerLobbySignalChange = { kind: "INVALIDATE" },
  delivery: {
    readonly revokeParticipantId?: string;
    readonly closeRoom?: boolean;
  } = {},
): Promise<void> {
  const namespace = c.env.MULTIPLAYER_LOBBY_SIGNALS;
  if (!namespace) return;
  try {
    const response = await namespace.get(namespace.idFromName(instanceId)).fetch(
      new Request(`https://multiplayer.internal${MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_NOTIFY_PATH}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [MULTIPLAYER_INTERNAL_PROTOCOL_HEADER]: MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL,
        },
        body: JSON.stringify({
          instanceId,
          generation,
          change,
          revokeParticipantId: delivery.revokeParticipantId ?? null,
          closeRoom: delivery.closeRoom ?? false,
        }),
      }),
    );
    if (!response.ok) throw new Error(`lobby signal rejected (${response.status})`);
  } catch (error: unknown) {
    // The authoritative D1 mutation already committed, so notification failure must not roll it
    // back. Awaiting the single DO call here is intentional: a detached promise can be canceled
    // as soon as the HTTP response completes, silently losing the only invalidation signal.
    console.warn("[multiplayer:lobby-signal-failed]", {
      instanceId,
      generation,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

type InternalLeaveResult =
  | { readonly ok: true; readonly replayed: boolean }
  | { readonly ok: false; readonly code: MultiplayerErrorCode };

function isMultiplayerErrorCode(value: unknown): value is MultiplayerErrorCode {
  return typeof value === "string" && Object.hasOwn(PUBLIC_MESSAGES, value);
}

async function leaveThroughDurableObject(
  c: Context<ApiEnv>,
  instanceId: string,
  userId: number,
  generation: number,
): Promise<InternalLeaveResult> {
  const namespace = c.env.MULTIPLAYER_INSTANCES;
  if (!namespace) return { ok: false, code: "MULTIPLAYER_UNAVAILABLE" };
  try {
    const response = await namespace.get(namespace.idFromName(instanceId)).fetch(
      new Request(`https://multiplayer.internal${MULTIPLAYER_INTERNAL_LEAVE_PATH}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [MULTIPLAYER_INTERNAL_PROTOCOL_HEADER]: MULTIPLAYER_WEBSOCKET_PROTOCOL,
        },
        body: JSON.stringify({ instanceId, userId, generation }),
      }),
    );
    const payload = (await response.json()) as unknown;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return { ok: false, code: "INTERNAL_RETRYABLE" };
    }
    const source = payload as Record<string, unknown>;
    if (source.ok === true && typeof source.replayed === "boolean") {
      return { ok: true, replayed: source.replayed };
    }
    return source.ok === false && isMultiplayerErrorCode(source.code)
      ? { ok: false, code: source.code }
      : { ok: false, code: "INTERNAL_RETRYABLE" };
  } catch {
    return { ok: false, code: "INTERNAL_RETRYABLE" };
  }
}

export const multiplayerRouter = new Hono<ApiEnv>();

multiplayerRouter.get("/status", (c) => {
  const enabled = isMultiplayerFeatureEnabled(c.env.MULTIPLAYER_ENABLED);
  return c.json(
    MultiplayerRuntimeStatusResponseSchema.parse({
      status: !enabled ? "DISABLED" : runtimeReady(c.env) ? "READY" : "NOT_READY",
      protocolVersion: 1,
    }),
    200,
  );
});

multiplayerRouter.get("/games/:gameSlug", async (c) => {
  const unavailable = () => {
    c.header("Cache-Control", "no-store");
    return c.json(
      MultiplayerGameAvailabilityResponseSchema.parse({
        status: "UNAVAILABLE",
        protocolVersion: 1,
      }),
      200,
    );
  };
  if (!isMultiplayerFeatureEnabled(c.env.MULTIPLAYER_ENABLED) || !runtimeReady(c.env)) {
    return unavailable();
  }
  const gameSlug = c.req.param("gameSlug");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(gameSlug) || gameSlug.length > 64) {
    return unavailable();
  }
  const b2Config = readB2Config(c.env);
  if (!b2Config) return unavailable();

  try {
    const container = createContainer(c.env.DB, b2Config);
    const runtime = await container.runtimeGameRegistry.findBySlug(gameSlug);
    if (!runtime) return unavailable();
    const profileRecord = await container.multiplayerProfileRepo.findEnabledForExactVersion(
      runtime.identity.id,
      runtime.liveVersion.id,
    );
    if (!profileRecord || !isSupportedMultiplayerRuntimeProfile(profileRecord.profile)) {
      return unavailable();
    }
    const profile = profileRecord.profile;
    c.header("Cache-Control", "no-store");
    return c.json(
      MultiplayerGameAvailabilityResponseSchema.parse({
        status: "AVAILABLE",
        protocolVersion: 1,
        gameSlug,
        profile: {
          profileRevision: profile.profileRevision,
          resolvedClass: profile.resolvedClass,
          simulationModel: profile.simulationModel,
          rulesetKey: profile.rulesetKey,
          rulesetRevision: profile.rulesetRevision,
          reconnectPolicy: profile.reconnectPolicy,
          minPlayers: profile.minPlayers,
          maxPlayers: profile.maxPlayers,
          allowedVisibility: profile.allowedVisibility,
          allowedJoinPolicies: profile.allowedJoinPolicies,
        },
      }),
      200,
    );
  } catch {
    return unavailable();
  }
});

multiplayerRouter.post("/instances", async (c) => {
  if (!isMultiplayerFeatureEnabled(c.env.MULTIPLAYER_ENABLED)) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }
  if (!runtimeReady(c.env)) return failure(c, "MULTIPLAYER_UNAVAILABLE");
  const rateLimit = await takeRateLimit(c.env, requestRateKey(c, "create"));
  if (rateLimit === "DENIED") return failure(c, "RATE_LIMITED");
  if (rateLimit === "UNAVAILABLE") return failure(c, "MULTIPLAYER_UNAVAILABLE");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return failure(c, "INVALID_REQUEST");
  }
  const parsed = MultiplayerCreateRoomRequestSchema.safeParse(body);
  if (!parsed.success) return failure(c, "INVALID_REQUEST");

  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) return failure(c, "UNAUTHENTICATED");
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const authenticated = await container.sessionRepo.findSession(sessionId);
  if (!authenticated) return failure(c, "UNAUTHENTICATED");

  const result = await container.multiplayerRoomUseCases.createRoom({
    userId: authenticated.user.id,
    ...parsed.data,
  });
  if (!result.ok) return failure(c, result.code);
  c.header("Cache-Control", "no-store");
  return c.json(
    MultiplayerRoomResponseSchema.parse({
      replayed: result.replayed,
      instance: publicRoom(result.instance),
      participant: publicParticipant(result.participant),
    }),
    result.replayed ? 200 : 201,
  );
});

multiplayerRouter.post("/instances/join", async (c) => {
  if (!isMultiplayerFeatureEnabled(c.env.MULTIPLAYER_ENABLED)) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }
  if (!runtimeReady(c.env)) return failure(c, "MULTIPLAYER_UNAVAILABLE");
  const rateLimit = await takeRateLimit(c.env, requestRateKey(c, "join"));
  if (rateLimit === "DENIED") return failure(c, "RATE_LIMITED");
  if (rateLimit === "UNAVAILABLE") return failure(c, "MULTIPLAYER_UNAVAILABLE");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return failure(c, "INVALID_REQUEST");
  }
  const parsed = MultiplayerJoinRoomRequestSchema.safeParse(body);
  if (!parsed.success) return failure(c, "INVALID_REQUEST");

  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) return failure(c, "UNAUTHENTICATED");
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const authenticated = await container.sessionRepo.findSession(sessionId);
  if (!authenticated) return failure(c, "UNAUTHENTICATED");
  const result = await container.multiplayerRoomUseCases.joinRoom({
    userId: authenticated.user.id,
    publicCode: parsed.data.publicCode,
    inviteToken: parsed.data.inviteToken,
  });
  if (!result.ok) return failure(c, result.code);
  if (!result.replayed) {
    await notifyLobbySignal(c, result.instance.id, result.instance.generation);
  }
  c.header("Cache-Control", "no-store");
  return c.json(
    MultiplayerRoomResponseSchema.parse({
      replayed: result.replayed,
      instance: publicRoom(result.instance),
      participant: publicParticipant(result.participant),
    }),
    200,
  );
});

multiplayerRouter.get("/instances/:instanceId/roster", async (c) => {
  if (!isMultiplayerFeatureEnabled(c.env.MULTIPLAYER_ENABLED) || !runtimeReady(c.env)) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }
  const rateLimit = await takeRateLimit(c.env, requestRateKey(c, "roster"), "RECOVERY");
  if (rateLimit === "DENIED") return failure(c, "RATE_LIMITED");
  if (rateLimit === "UNAVAILABLE") return failure(c, "MULTIPLAYER_UNAVAILABLE");

  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) return failure(c, "UNAUTHENTICATED");
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const authenticated = await container.sessionRepo.findSession(sessionId);
  if (!authenticated) return failure(c, "UNAUTHENTICATED");

  const instanceId = c.req.param("instanceId");
  const [instance, viewer] = await Promise.all([
    container.multiplayerInstanceRepo.findById(instanceId),
    container.multiplayerInstanceRepo.findParticipant(instanceId, authenticated.user.id),
  ]);
  if (!instance) return failure(c, "INSTANCE_NOT_FOUND");
  if (!viewer || (viewer.status !== "JOINED" && viewer.status !== "READY")) {
    return failure(c, "NOT_PARTICIPANT");
  }

  const participants = (
    await container.multiplayerInstanceRepo.listParticipants(instanceId)
  ).filter((participant) => participant.status === "JOINED" || participant.status === "READY");
  const users = await Promise.all(
    participants.map((participant) => container.userRepo.findById(participant.userId)),
  );
  c.header("Cache-Control", "no-store");
  return c.json(
    MultiplayerRoomRosterResponseSchema.parse({
      instanceId,
      generation: instance.generation,
      instance: publicRoom(instance),
      players: participants.flatMap((participant, index) => {
        const user = users[index];
        return user
          ? [
              {
                participantId: participant.id,
                role: participant.role,
                seatIndex: participant.seatIndex,
                status: participant.status,
                nickname: user.nickname,
                avatarUrl: user.avatar_url,
              },
            ]
          : [];
      }),
    }),
    200,
  );
});

multiplayerRouter.post("/instances/:instanceId/ready", async (c) => {
  if (!isMultiplayerFeatureEnabled(c.env.MULTIPLAYER_ENABLED) || !runtimeReady(c.env)) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }
  const rateLimit = await takeRateLimit(c.env, requestRateKey(c, "ready"));
  if (rateLimit === "DENIED") return failure(c, "RATE_LIMITED");
  if (rateLimit === "UNAVAILABLE") return failure(c, "MULTIPLAYER_UNAVAILABLE");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return failure(c, "INVALID_REQUEST");
  }
  const parsed = MultiplayerSetReadyRequestSchema.safeParse(body);
  if (!parsed.success) return failure(c, "INVALID_REQUEST");

  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) return failure(c, "UNAUTHENTICATED");
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const authenticated = await container.sessionRepo.findSession(sessionId);
  if (!authenticated) return failure(c, "UNAUTHENTICATED");

  const result = await container.multiplayerRoomUseCases.setParticipantReady({
    userId: authenticated.user.id,
    instanceId: c.req.param("instanceId"),
    expectedGeneration: parsed.data.expectedGeneration,
    ready: parsed.data.ready,
  });
  if (!result.ok) return failure(c, result.code);
  if (result.state === "WAITING" && result.changed) {
    await notifyLobbySignal(c, result.instance.id, result.instance.generation, {
      kind: "PARTICIPANT_READY",
      participantId: result.participant.id,
      status: result.participant.status === "READY" ? "READY" : "JOINED",
      changedAt: result.participant.updatedAt,
    });
  }
  c.header("Cache-Control", "no-store");
  return c.json(
    MultiplayerRoomResponseSchema.parse({
      replayed: false,
      instance: publicRoom(result.instance),
      participant: publicParticipant(result.participant),
    }),
    200,
  );
});

multiplayerRouter.post("/instances/:instanceId/start", async (c) => {
  if (!isMultiplayerFeatureEnabled(c.env.MULTIPLAYER_ENABLED) || !runtimeReady(c.env)) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }
  const rateLimit = await takeRateLimit(c.env, requestRateKey(c, "start"));
  if (rateLimit === "DENIED") return failure(c, "RATE_LIMITED");
  if (rateLimit === "UNAVAILABLE") return failure(c, "MULTIPLAYER_UNAVAILABLE");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return failure(c, "INVALID_REQUEST");
  }
  const parsed = MultiplayerStartRoomRequestSchema.safeParse(body);
  if (!parsed.success) return failure(c, "INVALID_REQUEST");

  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) return failure(c, "UNAUTHENTICATED");
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const authenticated = await container.sessionRepo.findSession(sessionId);
  if (!authenticated) return failure(c, "UNAUTHENTICATED");

  const result = await container.multiplayerRoomUseCases.startRoom({
    userId: authenticated.user.id,
    instanceId: c.req.param("instanceId"),
    expectedGeneration: parsed.data.expectedGeneration,
  });
  if (!result.ok) return failure(c, result.code);
  await notifyLobbySignal(
    c,
    result.instance.id,
    result.instance.generation,
    { kind: "INVALIDATE" },
    {
      closeRoom: true,
    },
  );
  c.header("Cache-Control", "no-store");
  return c.json(
    MultiplayerRoomResponseSchema.parse({
      replayed: false,
      instance: publicRoom(result.instance),
      participant: publicParticipant(result.participant),
    }),
    200,
  );
});

multiplayerRouter.get("/instances/:instanceId/rematch", async (c) => {
  if (!isMultiplayerFeatureEnabled(c.env.MULTIPLAYER_ENABLED) || !runtimeReady(c.env)) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }
  const parsed = MultiplayerRematchRequestSchema.safeParse({
    expectedGeneration: Number(c.req.query("generation")),
  });
  if (!parsed.success) return failure(c, "INVALID_REQUEST");

  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) return failure(c, "UNAUTHENTICATED");
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const authenticated = await container.sessionRepo.findSession(sessionId);
  if (!authenticated) return failure(c, "UNAUTHENTICATED");
  const rateLimit = await takeRateLimit(c.env, `multiplayer:rematch:user:${authenticated.user.id}`);
  if (rateLimit === "DENIED") return failure(c, "RATE_LIMITED");
  if (rateLimit === "UNAVAILABLE") return failure(c, "MULTIPLAYER_UNAVAILABLE");

  const result = await container.multiplayerRoomUseCases.getRematchStatus({
    userId: authenticated.user.id,
    instanceId: c.req.param("instanceId"),
    expectedGeneration: parsed.data.expectedGeneration,
  });
  if (!result.ok) return failure(c, result.code);
  c.header("Cache-Control", "no-store");
  return c.json(publicRematch(result), 200);
});

multiplayerRouter.post("/instances/:instanceId/rematch", async (c) => {
  if (!isMultiplayerFeatureEnabled(c.env.MULTIPLAYER_ENABLED) || !runtimeReady(c.env)) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return failure(c, "INVALID_REQUEST");
  }
  const parsed = MultiplayerRematchRequestSchema.safeParse(body);
  if (!parsed.success) return failure(c, "INVALID_REQUEST");

  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) return failure(c, "UNAUTHENTICATED");
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const authenticated = await container.sessionRepo.findSession(sessionId);
  if (!authenticated) return failure(c, "UNAUTHENTICATED");
  const rateLimit = await takeRateLimit(c.env, `multiplayer:rematch:user:${authenticated.user.id}`);
  if (rateLimit === "DENIED") return failure(c, "RATE_LIMITED");
  if (rateLimit === "UNAVAILABLE") return failure(c, "MULTIPLAYER_UNAVAILABLE");

  const result = await container.multiplayerRoomUseCases.requestRematch({
    userId: authenticated.user.id,
    instanceId: c.req.param("instanceId"),
    expectedGeneration: parsed.data.expectedGeneration,
  });
  if (!result.ok) return failure(c, result.code);
  notifyRematchChange(c, c.req.param("instanceId"), parsed.data.expectedGeneration);
  c.header("Cache-Control", "no-store");
  return c.json(publicRematch(result), 200);
});

multiplayerRouter.post("/instances/:instanceId/leave", async (c) => {
  if (!isMultiplayerFeatureEnabled(c.env.MULTIPLAYER_ENABLED)) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }
  if (!runtimeReady(c.env)) return failure(c, "MULTIPLAYER_UNAVAILABLE");
  const rateLimit = await takeRateLimit(c.env, requestRateKey(c, "leave"));
  if (rateLimit === "DENIED") return failure(c, "RATE_LIMITED");
  if (rateLimit === "UNAVAILABLE") return failure(c, "MULTIPLAYER_UNAVAILABLE");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return failure(c, "INVALID_REQUEST");
  }
  const parsed = MultiplayerLeaveRoomRequestSchema.safeParse(body);
  if (!parsed.success) return failure(c, "INVALID_REQUEST");

  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) return failure(c, "UNAUTHENTICATED");
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const authenticated = await container.sessionRepo.findSession(sessionId);
  if (!authenticated) return failure(c, "UNAUTHENTICATED");
  const instanceId = c.req.param("instanceId");
  const currentInstance = await container.multiplayerInstanceRepo.findById(instanceId);
  if (!currentInstance) return failure(c, "INSTANCE_NOT_FOUND");
  let result: InternalLeaveResult;
  if (currentInstance.status === "CREATED" || currentInstance.status === "LOBBY") {
    const direct = await container.multiplayerRoomUseCases.leaveRoom({
      userId: authenticated.user.id,
      instanceId,
      expectedGeneration: parsed.data.expectedGeneration,
      expectedInstanceStatus: currentInstance.status,
    });
    if (direct.ok) {
      result = { ok: true, replayed: direct.replayed };
    } else if (direct.code === "STALE_GENERATION") {
      const latest = await container.multiplayerInstanceRepo.findById(instanceId);
      if (
        latest &&
        latest.generation === parsed.data.expectedGeneration &&
        (latest.status === "STARTING" || latest.status === "ACTIVE" || latest.status === "CLOSING")
      ) {
        // The room crossed the gameplay authority boundary after the first read. Delegate the
        // leave instead of mutating participant state from a stale waiting-room observation.
        result = await leaveThroughDurableObject(
          c,
          instanceId,
          authenticated.user.id,
          parsed.data.expectedGeneration,
        );
      } else {
        result = { ok: false, code: direct.code };
      }
    } else {
      result = { ok: false, code: direct.code };
    }
  } else {
    // Active matches still enter the authority object so a deliberate leave becomes an immediate,
    // server-authenticated forfeit. A waiting room never creates or wakes a Durable Object.
    result = await leaveThroughDurableObject(
      c,
      instanceId,
      authenticated.user.id,
      parsed.data.expectedGeneration,
    );
  }
  if (!result.ok) return failure(c, result.code);
  const [instance, participant] = await Promise.all([
    container.multiplayerInstanceRepo.findById(instanceId),
    container.multiplayerInstanceRepo.findParticipant(instanceId, authenticated.user.id),
  ]);
  if (!instance) return failure(c, "INSTANCE_NOT_FOUND");
  if (!participant) return failure(c, "NOT_PARTICIPANT");
  if (!result.replayed) {
    await notifyLobbySignal(
      c,
      instanceId,
      instance.generation,
      { kind: "INVALIDATE" },
      {
        revokeParticipantId: participant.id,
        closeRoom: ["ABORTED", "CLOSED", "EXPIRED"].includes(instance.status),
      },
    );
  }
  c.header("Cache-Control", "no-store");
  return c.json(
    MultiplayerRoomResponseSchema.parse({
      replayed: result.replayed,
      instance: publicRoom(instance),
      participant: publicParticipant(participant),
    }),
    200,
  );
});

multiplayerRouter.post("/instances/:instanceId/invites", async (c) => {
  if (!isMultiplayerFeatureEnabled(c.env.MULTIPLAYER_ENABLED)) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }
  const config = readMultiplayerRuntimeConfig(c.env);
  if (!config || !runtimeReady(c.env)) return failure(c, "MULTIPLAYER_UNAVAILABLE");
  const rateLimit = await takeRateLimit(c.env, requestRateKey(c, "invite"));
  if (rateLimit === "DENIED") return failure(c, "RATE_LIMITED");
  if (rateLimit === "UNAVAILABLE") return failure(c, "MULTIPLAYER_UNAVAILABLE");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return failure(c, "INVALID_REQUEST");
  }
  const parsed = MultiplayerCreateInviteRequestSchema.safeParse(body);
  if (!parsed.success) return failure(c, "INVALID_REQUEST");

  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) return failure(c, "UNAUTHENTICATED");
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const authenticated = await container.sessionRepo.findSession(sessionId);
  if (!authenticated) return failure(c, "UNAUTHENTICATED");
  const result = await container.multiplayerRoomUseCases.createInvite({
    userId: authenticated.user.id,
    instanceId: c.req.param("instanceId"),
    expectedGeneration: parsed.data.expectedGeneration,
    idempotencyKey: parsed.data.idempotencyKey,
    keyring: config.keyring,
  });
  if (!result.ok) return failure(c, result.code);
  c.header("Cache-Control", "no-store");
  return c.json(
    MultiplayerCreateInviteResponseSchema.parse({
      replayed: result.replayed,
      inviteToken: result.inviteToken,
      expiresAt: result.expiresAt,
      maxUses: result.maxUses,
    }),
    result.replayed ? 200 : 201,
  );
});

multiplayerRouter.get("/instances/:instanceId/lobby-signal", async (c) => {
  if (!isMultiplayerFeatureEnabled(c.env.MULTIPLAYER_ENABLED)) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }
  const config = readMultiplayerRuntimeConfig(c.env);
  const namespace = c.env.MULTIPLAYER_LOBBY_SIGNALS;
  if (!config || !namespace || !runtimeReady(c.env)) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return failure(c, "INVALID_REQUEST");
  }
  if (!isTrustedMultiplayerSocketRequest(c.req.raw, config)) {
    return failure(c, "FORBIDDEN");
  }
  if (c.req.header("Sec-WebSocket-Protocol")?.trim() !== MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL) {
    return failure(c, "INVALID_REQUEST");
  }

  const rateLimit = await takeRateLimit(c.env, requestRateKey(c, "lobby-signal"), "RECOVERY");
  if (rateLimit === "DENIED") return failure(c, "RATE_LIMITED");
  if (rateLimit === "UNAVAILABLE") return failure(c, "MULTIPLAYER_UNAVAILABLE");

  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) return failure(c, "UNAUTHENTICATED");
  const instanceId = c.req.param("instanceId");
  if (!INSTANCE_ID_PATTERN.test(instanceId)) return failure(c, "INVALID_REQUEST");

  const container = createContainer(c.env.DB, readB2Config(c.env));
  const authenticated = await container.sessionRepo.findSession(sessionId);
  if (!authenticated) return failure(c, "UNAUTHENTICATED");
  const [instance, participant] = await Promise.all([
    container.multiplayerInstanceRepo.findById(instanceId),
    container.multiplayerInstanceRepo.findParticipant(instanceId, authenticated.user.id),
  ]);
  if (!instance) return failure(c, "INSTANCE_NOT_FOUND");
  if (instance.status !== "LOBBY") return failure(c, "INSTANCE_NOT_JOINABLE");
  const expiresAt = Date.parse(instance.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return failure(c, "INSTANCE_NOT_JOINABLE");
  }
  if (!participant || (participant.status !== "JOINED" && participant.status !== "READY")) {
    return failure(c, "NOT_PARTICIPANT");
  }

  const internalRequest = new Request(
    `https://multiplayer.internal${MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_CONNECT_PATH}`,
    {
      method: "GET",
      headers: {
        Upgrade: "websocket",
        [MULTIPLAYER_INTERNAL_PROTOCOL_HEADER]: MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL,
        [MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_CLAIMS_HEADER]:
          encodeVerifiedMultiplayerLobbySignalClaims({
            instanceId,
            participantId: participant.id,
            generation: instance.generation,
          }),
      },
    },
  );
  try {
    const response = await namespace.get(namespace.idFromName(instanceId)).fetch(internalRequest);
    if (response.status !== 101 || !response.webSocket) return response;
    return new Response(null, {
      status: 101,
      webSocket: response.webSocket,
      headers: { "Sec-WebSocket-Protocol": MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL },
    });
  } catch {
    return failure(c, "INTERNAL_RETRYABLE");
  }
});

multiplayerRouter.post("/instances/:instanceId/ticket", async (c) => {
  if (!isMultiplayerFeatureEnabled(c.env.MULTIPLAYER_ENABLED)) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }
  const config = readMultiplayerRuntimeConfig(c.env);
  if (!config || !c.env.MULTIPLAYER_INSTANCES || !runtimeReady(c.env)) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }

  const rateLimit = await takeRateLimit(c.env, requestRateKey(c, "ticket"), "RECOVERY");
  if (rateLimit === "DENIED") return failure(c, "RATE_LIMITED");
  if (rateLimit === "UNAVAILABLE") return failure(c, "MULTIPLAYER_UNAVAILABLE");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return failure(c, "INVALID_REQUEST");
  }
  const parsed = MultiplayerJoinTicketRequestSchema.safeParse(body);
  if (!parsed.success) return failure(c, "INVALID_REQUEST");

  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) return failure(c, "UNAUTHENTICATED");
  const container = createContainer(c.env.DB, readB2Config(c.env));
  const authenticated = await container.sessionRepo.findSession(sessionId);
  if (!authenticated) return failure(c, "UNAUTHENTICATED");

  const result = await container.multiplayerAdmissionUseCases.issueJoinTicket({
    userId: authenticated.user.id,
    instanceId: c.req.param("instanceId"),
    expectedConnectionGeneration: parsed.data.expectedConnectionGeneration,
    keyring: config.keyring,
  });
  if (!result.ok) return failure(c, result.code);

  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  return c.json(
    MultiplayerJoinTicketResponseSchema.parse({
      socketPath: `/api/multiplayer/instances/${encodeURIComponent(c.req.param("instanceId"))}/socket`,
      protocols: result.protocols,
      expiresAt: result.expiresAt,
      connectionGeneration: result.connectionGeneration,
      bootstrap: result.bootstrap,
    }),
    200,
  );
});

multiplayerRouter.get("/instances/:instanceId/socket", async (c) => {
  if (!isMultiplayerFeatureEnabled(c.env.MULTIPLAYER_ENABLED)) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }
  const config = readMultiplayerRuntimeConfig(c.env);
  const namespace = c.env.MULTIPLAYER_INSTANCES;
  if (!config || !namespace || !runtimeReady(c.env)) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return failure(c, "INVALID_REQUEST");
  }
  if (!isTrustedMultiplayerSocketRequest(c.req.raw, config)) {
    return failure(c, "FORBIDDEN");
  }

  const rateLimit = await takeRateLimit(c.env, requestRateKey(c, "socket"), "RECOVERY");
  if (rateLimit === "DENIED") return failure(c, "RATE_LIMITED");
  if (rateLimit === "UNAVAILABLE") return failure(c, "MULTIPLAYER_UNAVAILABLE");

  const transport = parseMultiplayerWebSocketProtocols(c.req.header("Sec-WebSocket-Protocol"));
  if (!transport.ok) return failure(c, "TICKET_INVALID");
  const instanceId = c.req.param("instanceId");
  const verified = await verifyMultiplayerJoinTicket(transport.ticket, config.keyring, {
    instanceId,
  });
  if (!verified.ok) {
    return failure(c, verified.error === "EXPIRED" ? "TICKET_EXPIRED" : "TICKET_INVALID");
  }

  // The raw ticket carrier is deliberately not forwarded. The self-bound DO receives only the
  // canonical verified claims and the application protocol.
  const internalRequest = new Request(
    `https://multiplayer.internal${MULTIPLAYER_INTERNAL_CONNECT_PATH}`,
    {
      method: "GET",
      headers: {
        Upgrade: "websocket",
        [MULTIPLAYER_INTERNAL_PROTOCOL_HEADER]: MULTIPLAYER_WEBSOCKET_PROTOCOL,
        [MULTIPLAYER_INTERNAL_CLAIMS_HEADER]: encodeVerifiedMultiplayerClaims(verified.claims),
      },
    },
  );
  try {
    const id = namespace.idFromName(instanceId);
    const response = await namespace.get(id).fetch(internalRequest);
    if (response.status !== 101 || !response.webSocket) return response;
    // Only the browser-facing edge negotiates the standard subprotocol. The signed ticket
    // carrier is never echoed and the internal trust header never crosses back to the browser.
    return new Response(null, {
      status: 101,
      webSocket: response.webSocket,
      headers: { "Sec-WebSocket-Protocol": MULTIPLAYER_WEBSOCKET_PROTOCOL },
    });
  } catch {
    return failure(c, "INTERNAL_RETRYABLE");
  }
});
