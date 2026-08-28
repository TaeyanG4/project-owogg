import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { test } from "vitest";
import {
  MULTIPLAYER_HEARTBEAT_REQUEST,
  MULTIPLAYER_HEARTBEAT_RESPONSE,
  MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL,
} from "@owogg/contracts";
import {
  MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_CLAIMS_HEADER,
  MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_CONNECT_PATH,
  MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_NOTIFY_PATH,
  MULTIPLAYER_INTERNAL_PROTOCOL_HEADER,
  encodeVerifiedMultiplayerLobbySignalClaims,
  type VerifiedMultiplayerLobbySignalClaims,
} from "../src/multiplayer/internalProtocol.js";

function connectRequest(claims: VerifiedMultiplayerLobbySignalClaims): Request {
  return new Request(
    `https://multiplayer.internal${MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_CONNECT_PATH}`,
    {
      headers: {
        Upgrade: "websocket",
        [MULTIPLAYER_INTERNAL_PROTOCOL_HEADER]: MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL,
        [MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_CLAIMS_HEADER]:
          encodeVerifiedMultiplayerLobbySignalClaims(claims),
      },
    },
  );
}

function notifyRequest(
  claims: VerifiedMultiplayerLobbySignalClaims,
  change: unknown,
  delivery: { readonly revokeParticipantId?: string; readonly closeRoom?: boolean } = {},
): Request {
  return new Request(
    `https://multiplayer.internal${MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_NOTIFY_PATH}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [MULTIPLAYER_INTERNAL_PROTOCOL_HEADER]: MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL,
      },
      body: JSON.stringify({
        instanceId: claims.instanceId,
        generation: claims.generation,
        change,
        revokeParticipantId: delivery.revokeParticipantId ?? null,
        closeRoom: delivery.closeRoom ?? false,
      }),
    },
  );
}

async function nextRawMessage(socket: WebSocket, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 2_000);
    socket.addEventListener(
      "message",
      (event) => {
        clearTimeout(timeout);
        if (typeof event.data !== "string") {
          reject(new Error(`${label} was not text`));
          return;
        }
        resolve(event.data);
      },
      { once: true },
    );
  });
}

async function nextClose(socket: WebSocket, label: string): Promise<CloseEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 2_000);
    socket.addEventListener(
      "close",
      (event) => {
        clearTimeout(timeout);
        resolve(event);
      },
      { once: true },
    );
  });
}

async function connect(claims: VerifiedMultiplayerLobbySignalClaims) {
  const stub = env.MULTIPLAYER_LOBBY_SIGNALS.get(
    env.MULTIPLAYER_LOBBY_SIGNALS.idFromName(claims.instanceId),
  );
  const response = await stub.fetch(connectRequest(claims));
  const socket = response.webSocket;
  if (!socket) throw new Error(`expected lobby signal upgrade, received ${response.status}`);
  const compatibilityAdmission = nextRawMessage(socket, "compatibility admission");
  socket.accept();
  return { compatibilityAdmission, response, socket, stub };
}

test("lobby signals hibernate without persisted state and fan out minimal changes", async ({
  expect,
}) => {
  const claims: VerifiedMultiplayerLobbySignalClaims = {
    instanceId: "instance_signal_workers_0001",
    participantId: "participant_signal_workers_0001",
    generation: 2,
  };
  const { compatibilityAdmission, response, socket, stub } = await connect(claims);
  expect(response.status).toBe(101);
  expect(JSON.parse(await compatibilityAdmission)).toEqual({
    type: "LOBBY_SIGNAL_CONNECTED",
    v: 1,
    instanceId: claims.instanceId,
    generation: claims.generation,
  });

  const heartbeat = nextRawMessage(socket, "auto-response heartbeat");
  socket.send(MULTIPLAYER_HEARTBEAT_REQUEST);
  await expect(heartbeat).resolves.toBe(MULTIPLAYER_HEARTBEAT_RESPONSE);

  await evictDurableObject(stub);

  const changedAt = "2026-08-28T12:00:00.000Z";
  const changed = nextRawMessage(socket, "ready signal");
  const notified = await stub.fetch(
    notifyRequest(claims, {
      kind: "PARTICIPANT_READY",
      participantId: claims.participantId,
      status: "READY",
      changedAt,
    }),
  );
  expect(notified.status).toBe(204);
  expect(JSON.parse(await changed)).toEqual({
    type: "LOBBY_SIGNAL_CHANGED",
    v: 1,
    instanceId: claims.instanceId,
    generation: claims.generation,
    change: {
      kind: "PARTICIPANT_READY",
      participantId: claims.participantId,
      status: "READY",
      changedAt,
    },
  });

  const joinedChange = {
    kind: "PARTICIPANT_JOINED",
    player: {
      participantId: "participant_signal_workers_0005",
      role: "PLAYER",
      seatIndex: 1,
      status: "READY",
      nickname: "Player",
      avatarUrl: null,
    },
    changedAt: "2026-08-28T12:00:01.000Z",
  } as const;
  const joined = nextRawMessage(socket, "participant joined signal");
  expect((await stub.fetch(notifyRequest(claims, joinedChange))).status).toBe(204);
  expect(JSON.parse(await joined)).toMatchObject({ change: joinedChange });

  const leftChange = {
    kind: "PARTICIPANT_LEFT",
    participantId: joinedChange.player.participantId,
    changedAt: "2026-08-28T12:00:02.000Z",
  } as const;
  const left = nextRawMessage(socket, "participant left signal");
  expect((await stub.fetch(notifyRequest(claims, leftChange))).status).toBe(204);
  expect(JSON.parse(await left)).toMatchObject({ change: leftChange });

  await expect(
    runInDurableObject(stub, async (_object, state) => ({
      storedKeys: [...(await state.storage.list()).keys()],
      alarm: await state.storage.getAlarm(),
      sockets: state.getWebSockets().length,
    })),
  ).resolves.toEqual({ storedKeys: [], alarm: null, sockets: 1 });
  socket.close(1000, "done");
});

test("lobby signal admission rejects malformed claims and caps duplicate participant sockets", async ({
  expect,
}) => {
  const instanceId = "instance_signal_workers_0002";
  const stub = env.MULTIPLAYER_LOBBY_SIGNALS.get(
    env.MULTIPLAYER_LOBBY_SIGNALS.idFromName(instanceId),
  );
  const invalid = await stub.fetch(
    new Request(`https://multiplayer.internal${MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_CONNECT_PATH}`, {
      headers: {
        Upgrade: "websocket",
        [MULTIPLAYER_INTERNAL_PROTOCOL_HEADER]: MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL,
        [MULTIPLAYER_INTERNAL_LOBBY_SIGNAL_CLAIMS_HEADER]: "not-canonical",
      },
    }),
  );
  expect(invalid.status).toBe(401);

  const claims: VerifiedMultiplayerLobbySignalClaims = {
    instanceId,
    participantId: "participant_signal_workers_0002",
    generation: 1,
  };
  const first = await connect(claims);
  const second = await connect(claims);
  await Promise.all([first.compatibilityAdmission, second.compatibilityAdmission]);
  const third = await stub.fetch(connectRequest(claims));
  expect(third.status).toBe(429);
  first.socket.close(1000, "done");
  second.socket.close(1000, "done");
});

test("membership revocation closes only that participant and room closure drains all sockets", async ({
  expect,
}) => {
  const firstClaims: VerifiedMultiplayerLobbySignalClaims = {
    instanceId: "instance_signal_workers_0003",
    participantId: "participant_signal_workers_0003",
    generation: 1,
  };
  const secondClaims: VerifiedMultiplayerLobbySignalClaims = {
    ...firstClaims,
    participantId: "participant_signal_workers_0004",
  };
  const first = await connect(firstClaims);
  const second = await connect(secondClaims);
  await Promise.all([first.compatibilityAdmission, second.compatibilityAdmission]);

  const firstChange = nextRawMessage(first.socket, "first invalidation");
  const secondChange = nextRawMessage(second.socket, "second invalidation");
  const firstClosed = nextClose(first.socket, "revoked participant close");
  const revoked = await first.stub.fetch(
    notifyRequest(
      firstClaims,
      { kind: "INVALIDATE" },
      {
        revokeParticipantId: firstClaims.participantId,
      },
    ),
  );
  expect(revoked.status).toBe(204);
  await Promise.all([firstChange, secondChange]);
  await expect(firstClosed).resolves.toMatchObject({ code: 4004 });
  expect(second.socket.readyState).toBe(WebSocket.OPEN);

  const finalChange = nextRawMessage(second.socket, "room closure invalidation");
  const secondClosed = nextClose(second.socket, "room close");
  const closed = await second.stub.fetch(
    notifyRequest(secondClaims, { kind: "INVALIDATE" }, { closeRoom: true }),
  );
  expect(closed.status).toBe(204);
  await finalChange;
  await expect(secondClosed).resolves.toMatchObject({ code: 4003 });
});
