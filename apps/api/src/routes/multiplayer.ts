import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import {
  MultiplayerJoinTicketRequestSchema,
  MultiplayerJoinTicketResponseSchema,
  MultiplayerRuntimeStatusResponseSchema,
} from "@owogg/contracts";
import {
  MULTIPLAYER_ERROR_HTTP_STATUS,
  MULTIPLAYER_WEBSOCKET_PROTOCOL,
  parseMultiplayerWebSocketProtocols,
  verifyMultiplayerJoinTicket,
  type MultiplayerErrorCode,
} from "@owogg/core";
import { createContainer } from "../container.js";
import {
  isMultiplayerFeatureEnabled,
  isTrustedMultiplayerSocketRequest,
  readMultiplayerRuntimeConfig,
} from "../multiplayer/config.js";
import {
  MULTIPLAYER_INTERNAL_CLAIMS_HEADER,
  MULTIPLAYER_INTERNAL_CONNECT_PATH,
  MULTIPLAYER_INTERNAL_PROTOCOL_HEADER,
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
  INSTANCE_NOT_FOUND: "게임 방을 찾을 수 없습니다.",
  INSTANCE_NOT_JOINABLE: "현재 입장할 수 없는 게임 방입니다.",
  INSTANCE_FULL: "게임 방이 가득 찼습니다.",
  INVITE_INVALID: "초대가 유효하지 않습니다.",
  INVITE_EXHAUSTED: "초대 사용 횟수가 만료되었습니다.",
  ALREADY_JOINED: "이미 참가 중입니다.",
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

function failure(c: Context<ApiEnv>, code: MultiplayerErrorCode) {
  return c.json(
    { error: { code, message: PUBLIC_MESSAGES[code] } },
    MULTIPLAYER_ERROR_HTTP_STATUS[code],
  );
}

function runtimeReady(env: ApiEnv["Bindings"]): boolean {
  return Boolean(
    readMultiplayerRuntimeConfig(env) && env.MULTIPLAYER_INSTANCES && env.MULTIPLAYER_RATE_LIMITER,
  );
}

async function takeRateLimit(
  env: ApiEnv["Bindings"],
  key: string,
): Promise<"ALLOWED" | "DENIED" | "UNAVAILABLE"> {
  const limiter = env.MULTIPLAYER_RATE_LIMITER;
  if (!limiter) return "UNAVAILABLE";
  try {
    return (await limiter.limit({ key })).success ? "ALLOWED" : "DENIED";
  } catch {
    // Multiplayer is not yet a site-critical availability path. A missing/broken mandatory abuse
    // control therefore fails closed instead of silently exposing an unbounded WebSocket edge.
    return "UNAVAILABLE";
  }
}

function requestRateKey(c: Context<ApiEnv>, operation: "ticket" | "socket"): string {
  return `multiplayer:${operation}:ip:${c.req.header("CF-Connecting-IP") ?? "unknown"}`;
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

multiplayerRouter.post("/instances/:instanceId/ticket", async (c) => {
  if (!isMultiplayerFeatureEnabled(c.env.MULTIPLAYER_ENABLED)) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }
  const config = readMultiplayerRuntimeConfig(c.env);
  if (!config || !c.env.MULTIPLAYER_INSTANCES || !c.env.MULTIPLAYER_RATE_LIMITER) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }

  const rateLimit = await takeRateLimit(c.env, requestRateKey(c, "ticket"));
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
  const container = createContainer(c.env.DB);
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
  if (!config || !namespace || !c.env.MULTIPLAYER_RATE_LIMITER) {
    return failure(c, "MULTIPLAYER_UNAVAILABLE");
  }
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return failure(c, "INVALID_REQUEST");
  }
  if (!isTrustedMultiplayerSocketRequest(c.req.raw, config)) {
    return failure(c, "FORBIDDEN");
  }

  const rateLimit = await takeRateLimit(c.env, requestRateKey(c, "socket"));
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
