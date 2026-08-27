import assert from "node:assert/strict";
import test from "node:test";
import { MULTIPLAYER_HEARTBEAT_REQUEST, MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL } from "@owogg/contracts";
import {
  multiplayerLobbySignalSocketUrl,
  openMultiplayerLobbySignal,
  type MultiplayerLobbySignalSocketLike,
} from "../features/game/runtime/multiplayerLobbySignal";

type SocketEvent = { readonly data?: unknown };
type SocketEventType = "open" | "message" | "close" | "error";

class FakeSocket implements MultiplayerLobbySignalSocketLike {
  protocol = MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL;
  readyState = 0;
  readonly sent: string[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  private readonly listeners = new Map<SocketEventType, Set<(event: SocketEvent) => void>>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    const closed: { code?: number; reason?: string } = {};
    if (code !== undefined) closed.code = code;
    if (reason !== undefined) closed.reason = reason;
    this.closes.push(closed);
  }

  addEventListener(type: SocketEventType, listener: (event: SocketEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: SocketEventType, listener: (event: SocketEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: SocketEventType, data?: unknown): void {
    if (type === "open") this.readyState = 1;
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

test("lobby signal URLs contain neither credentials nor gameplay tickets", () => {
  assert.equal(
    multiplayerLobbySignalSocketUrl("https://api-stg.owogg.com", "instance_signal_0001"),
    "wss://api-stg.owogg.com/api/multiplayer/instances/instance_signal_0001/lobby-signal",
  );
  assert.throws(
    () =>
      multiplayerLobbySignalSocketUrl("https://user:secret@example.com", "instance_signal_0001"),
    /invalid multiplayer lobby signal address/,
  );
  assert.throws(
    () => multiplayerLobbySignalSocketUrl("https://api-stg.owogg.com/path", "instance_signal_0001"),
    /invalid multiplayer lobby signal address/,
  );
});

test("the lobby signal validates admission, applies only matching changes, and uses auto-response heartbeats", () => {
  const socket = new FakeSocket();
  const connected: string[] = [];
  const changes: unknown[] = [];
  const disconnected: string[] = [];
  let heartbeatCallback: (() => void) | undefined;
  let heartbeatDelay = 0;
  let heartbeatClears = 0;
  let requestedUrl = "";
  let requestedProtocol = "";
  const handle = openMultiplayerLobbySignal(
    {
      instanceId: "instance_signal_0001",
      generation: 3,
      onConnected: () => connected.push("connected"),
      onChanged: (change) => changes.push(change),
      onDisconnected: () => disconnected.push("disconnected"),
    },
    {
      apiUrl: "https://api-stg.owogg.com",
      createSocket(url, protocol) {
        requestedUrl = url;
        requestedProtocol = protocol;
        return socket;
      },
      setHeartbeat(callback, delay) {
        heartbeatCallback = callback;
        heartbeatDelay = delay;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clearHeartbeat() {
        heartbeatClears += 1;
      },
    },
  );

  assert.match(requestedUrl, /^wss:\/\/api-stg\.owogg\.com\//);
  assert.equal(requestedProtocol, MULTIPLAYER_LOBBY_SIGNAL_PROTOCOL);
  socket.emit("open");
  assert.deepEqual(connected, []);
  socket.emit(
    "message",
    JSON.stringify({
      type: "LOBBY_SIGNAL_CONNECTED",
      v: 1,
      instanceId: "instance_signal_0001",
      generation: 3,
    }),
  );
  assert.deepEqual(connected, ["connected"]);
  assert.equal(heartbeatDelay, 300_000);

  socket.emit(
    "message",
    JSON.stringify({
      type: "LOBBY_SIGNAL_CHANGED",
      v: 1,
      instanceId: "different_instance_0001",
      generation: 3,
      change: { kind: "INVALIDATE" },
    }),
  );
  socket.emit(
    "message",
    JSON.stringify({
      type: "LOBBY_SIGNAL_CHANGED",
      v: 1,
      instanceId: "instance_signal_0001",
      generation: 3,
      change: {
        kind: "PARTICIPANT_READY",
        participantId: "participant_signal_0001",
        status: "READY",
        changedAt: "2026-08-28T12:00:00.000Z",
      },
    }),
  );
  assert.deepEqual(changes, [
    {
      kind: "PARTICIPANT_READY",
      participantId: "participant_signal_0001",
      status: "READY",
      changedAt: "2026-08-28T12:00:00.000Z",
    },
  ]);

  assert.ok(heartbeatCallback);
  heartbeatCallback();
  assert.deepEqual(socket.sent, [MULTIPLAYER_HEARTBEAT_REQUEST]);
  handle.close();
  assert.equal(heartbeatClears, 1);
  assert.deepEqual(disconnected, []);
  assert.deepEqual(socket.closes, [{ code: 1000, reason: "lobby signal closed" }]);
});

test("a failed lobby signal reports disconnection only once", () => {
  const socket = new FakeSocket();
  let disconnected = 0;
  openMultiplayerLobbySignal(
    {
      instanceId: "instance_signal_0002",
      generation: 1,
      onConnected() {},
      onChanged() {},
      onDisconnected() {
        disconnected += 1;
      },
    },
    {
      apiUrl: "http://localhost:8787",
      createSocket: () => socket,
    },
  );
  socket.emit("error");
  socket.emit("close");
  assert.equal(disconnected, 1);
});
