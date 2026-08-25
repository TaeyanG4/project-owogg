/**
 * Dependency-free browser adapter injected into every served game entry document. Legacy
 * single/local calls and managed-online calls use separate queues and mutually-exclusive bridge
 * handshakes. Neither path exposes a token, global user id, session id, or API/WebSocket address.
 */
export const OWOGG_BROWSER_API_SOURCE = String.raw`(function () {
  "use strict";
  if (window.OWOGG) return;

  var MAX_QUEUE = 32;
  var LEGACY_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
  var OPAQUE_ID = /^[A-Za-z0-9_-]{8,128}$/;
  var ACTION_ID = /^[A-Za-z0-9_-]{16,128}$/;
  var RULESET_KEY = /^[a-z0-9][a-z0-9._:/-]{0,95}$/;
  var EVENT_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
  var ACTION_REJECTIONS = ["MATCH_NOT_ACTIVE", "NOT_PARTICIPANT", "NOT_YOUR_TURN", "ACTION_INVALID", "ACTION_CONFLICT", "ACTION_ID_REUSED", "STALE_GENERATION", "RATE_LIMITED"];
  var DISCONNECT_CODES = ["NETWORK_LOST", "SERVER_UNAVAILABLE", "REPLACED_BY_NEW_CONNECTION", "AUTH_EXPIRED", "SLOW_CONSUMER", "LEFT"];
  var ABORT_CODES = ["INSUFFICIENT_PLAYERS", "PARTICIPANT_LEFT", "RULE_VIOLATION", "INFRA_FAILURE", "ADMIN_KILLED", "VERSION_UNAVAILABLE"];

  var activeMode = null;
  var legacyPort = null;
  var multiplayerPort = null;
  var legacyQueue = [];
  var multiplayerQueue = [];
  var completed = false;
  var bootstrap = null;
  var readyRequested = false;
  var left = false;
  var clientSeq = 0;
  var lastServerSeq = -1;
  var listeners = [];

  function isPlainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    try {
      var prototype = Object.getPrototypeOf(value);
      return prototype === null || Object.getPrototypeOf(prototype) === null;
    } catch (_) {
      return false;
    }
  }

  function hasOnlyKeys(value, allowed) {
    try {
      return Object.keys(value).every(function (key) { return allowed.indexOf(key) !== -1; });
    } catch (_) {
      return false;
    }
  }

  function isPositiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
  }

  function isNonNegativeInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  }

  function isAllowed(value, allowed) {
    return typeof value === "string" && allowed.indexOf(value) !== -1;
  }

  function isJsonSafe(value, depth, seen) {
    if (value === null) return true;
    var type = typeof value;
    if (type === "string" || type === "boolean") return true;
    if (type === "number") return Number.isFinite(value);
    if (depth <= 0 || (!Array.isArray(value) && !isPlainObject(value))) return false;
    if (seen.indexOf(value) !== -1) return false;
    seen.push(value);
    try {
      var values = Array.isArray(value)
        ? value
        : Object.keys(value).map(function (key) { return value[key]; });
      for (var index = 0; index < values.length; index += 1) {
        if (!isJsonSafe(values[index], depth - 1, seen)) return false;
      }
      return true;
    } catch (_) {
      return false;
    } finally {
      seen.pop();
    }
  }

  function utf8ByteLength(value) {
    var length = 0;
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code < 128) length += 1;
      else if (code < 2048) length += 2;
      else if (code >= 55296 && code <= 56319 && index + 1 < value.length && value.charCodeAt(index + 1) >= 56320 && value.charCodeAt(index + 1) <= 57343) {
        length += 4;
        index += 1;
      } else length += 3;
    }
    return length;
  }

  function isWithinLimit(value, limit) {
    try {
      var json = JSON.stringify(value);
      return typeof json === "string" && utf8ByteLength(json) <= limit;
    } catch (_) {
      return false;
    }
  }

  function post(port, message) {
    try {
      port.postMessage(message);
      return true;
    } catch (_) {
      return false;
    }
  }

  function queueLegacy(message) {
    if (legacyQueue.length < MAX_QUEUE) {
      legacyQueue.push(message);
      return;
    }
    if (message.type === "GAME_COMPLETE") {
      legacyQueue.shift();
      legacyQueue.push(message);
    }
  }

  function sendLegacy(message) {
    if (completed && message.type !== "GAME_COMPLETE") return;
    if (activeMode === "multiplayer") return;
    if (legacyPort) post(legacyPort, message);
    else queueLegacy(message);
  }

  function createActionId() {
    try {
      var cryptoApi = window.crypto;
      if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
      if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") return null;
      var bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      var hex = "";
      for (var index = 0; index < bytes.length; index += 1) hex += bytes[index].toString(16).padStart(2, "0");
      return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
    } catch (_) {
      return null;
    }
  }

  function buildMultiplayerMessage(intent, generation, sequence) {
    if (intent.type === "ready") return { type: "MULTI_READY", v: 1, generation: generation };
    if (intent.type === "leave") return { type: "MULTI_LEAVE", v: 1, generation: generation };
    if (intent.type === "action") return {
      type: "MULTI_ACTION",
      v: 1,
      generation: generation,
      clientSeq: sequence,
      clientActionId: intent.clientActionId,
      expectedRevision: intent.expectedRevision,
      payload: intent.payload
    };
    return { type: "MULTI_INPUT", v: 1, generation: generation, clientSeq: sequence, payload: intent.payload };
  }

  function validMultiplayerIntent(intent) {
    var message = buildMultiplayerMessage(intent, 9007199254740991, 9007199254740991);
    if (intent.type === "action") {
      if (!ACTION_ID.test(intent.clientActionId) || !isNonNegativeInteger(intent.expectedRevision) || !isJsonSafe(intent.payload, 16, [])) return false;
    } else if (intent.type === "input" && !isJsonSafe(intent.payload, 16, [])) {
      return false;
    }
    return isWithinLimit(message, 4096);
  }

  function sendMultiplayerIntent(intent) {
    if (!multiplayerPort || !bootstrap) return false;
    var needsSequence = intent.type === "action" || intent.type === "input";
    var nextSequence = needsSequence ? clientSeq + 1 : 0;
    if (needsSequence && !Number.isSafeInteger(nextSequence)) return false;
    var message = buildMultiplayerMessage(intent, bootstrap.generation, nextSequence);
    if (!isWithinLimit(message, 4096) || !post(multiplayerPort, message)) return false;
    if (needsSequence) clientSeq = nextSequence;
    return true;
  }

  function submitMultiplayer(intent) {
    if (left || activeMode === "legacy" || !validMultiplayerIntent(intent)) return false;
    if (multiplayerPort) return sendMultiplayerIntent(intent);
    if (multiplayerQueue.length >= MAX_QUEUE) return false;
    multiplayerQueue.push(intent);
    return true;
  }

  function parseBootstrap(value) {
    if (!isPlainObject(value) || value.type !== "MULTI_INIT" || value.v !== 1) return null;
    if (!hasOnlyKeys(value, ["type", "v", "participantId", "gameVersionId", "profileRevision", "rulesetKey", "rulesetRevision", "generation"])) return null;
    if (typeof value.participantId !== "string" || !OPAQUE_ID.test(value.participantId)) return null;
    if (!isPositiveInteger(value.gameVersionId) || !isPositiveInteger(value.profileRevision) || !isPositiveInteger(value.rulesetRevision) || !isPositiveInteger(value.generation)) return null;
    if (typeof value.rulesetKey !== "string" || !RULESET_KEY.test(value.rulesetKey)) return null;
    return Object.freeze({
      type: "MULTI_INIT",
      v: 1,
      participantId: value.participantId,
      gameVersionId: value.gameVersionId,
      profileRevision: value.profileRevision,
      rulesetKey: value.rulesetKey,
      rulesetRevision: value.rulesetRevision,
      generation: value.generation
    });
  }

  function commonServerEnvelope(value) {
    return value.v === 1 && isPositiveInteger(value.generation) && isNonNegativeInteger(value.serverSeq);
  }

  function parseHostMessage(value) {
    if (!isWithinLimit(value, 16384) || !isPlainObject(value) || typeof value.type !== "string" || value.v !== 1 || !isPositiveInteger(value.generation)) return null;
    switch (value.type) {
      case "MULTI_CONNECTED":
        return hasOnlyKeys(value, ["type", "v", "generation", "connectionGeneration"]) && isPositiveInteger(value.connectionGeneration) ? value : null;
      case "MULTI_PLAYER_JOINED":
      case "MULTI_PLAYER_LEFT":
        return hasOnlyKeys(value, ["type", "v", "generation", "serverSeq", "participantId"]) && commonServerEnvelope(value) && typeof value.participantId === "string" && OPAQUE_ID.test(value.participantId) ? value : null;
      case "MULTI_SYNC":
      case "MULTI_STATE":
        return hasOnlyKeys(value, ["type", "v", "generation", "serverSeq", "revision", "payload"]) && commonServerEnvelope(value) && isNonNegativeInteger(value.revision) && isJsonSafe(value.payload, 16, []) ? value : null;
      case "MULTI_EVENT":
        return hasOnlyKeys(value, ["type", "v", "generation", "serverSeq", "name", "payload"]) && commonServerEnvelope(value) && typeof value.name === "string" && EVENT_NAME.test(value.name) && (!("payload" in value) || value.payload === undefined || isJsonSafe(value.payload, 16, [])) ? value : null;
      case "MULTI_TERMINAL_PENDING":
        return hasOnlyKeys(value, ["type", "v", "generation", "serverSeq"]) && commonServerEnvelope(value) ? value : null;
      case "MULTI_TERMINAL_COMMITTED":
        return hasOnlyKeys(value, ["type", "v", "generation", "serverSeq", "result"]) && commonServerEnvelope(value) && isJsonSafe(value.result, 16, []) ? value : null;
      case "MULTI_ACTION_REJECTED":
        return hasOnlyKeys(value, ["type", "v", "generation", "serverSeq", "clientActionId", "code", "currentRevision"]) && commonServerEnvelope(value) && typeof value.clientActionId === "string" && ACTION_ID.test(value.clientActionId) && isAllowed(value.code, ACTION_REJECTIONS) && isNonNegativeInteger(value.currentRevision) ? value : null;
      case "MULTI_DISCONNECTED":
        return hasOnlyKeys(value, ["type", "v", "generation", "code"]) && isAllowed(value.code, DISCONNECT_CODES) ? value : null;
      case "MULTI_ABORTED":
        return hasOnlyKeys(value, ["type", "v", "generation", "code"]) && isAllowed(value.code, ABORT_CODES) ? value : null;
      default:
        return null;
    }
  }

  function receiveMultiplayer(event) {
    var message = parseHostMessage(event && event.data);
    if (!message || !bootstrap || message.generation !== bootstrap.generation) return;
    if ("serverSeq" in message) {
      if (message.serverSeq <= lastServerSeq) return;
      lastServerSeq = message.serverSeq;
    }
    listeners.slice().forEach(function (listener) {
      try { listener(message); } catch (_) {}
    });
  }

  var multiplayerApi = {
    ready: function () {
      if (readyRequested) return false;
      var accepted = submitMultiplayer({ type: "ready" });
      if (accepted) readyRequested = true;
      return accepted;
    },
    action: function (request) {
      try {
        if (left || !isPlainObject(request) || !hasOnlyKeys(request, ["expectedRevision", "payload", "clientActionId"])) return null;
        if (!isNonNegativeInteger(request.expectedRevision) || !isJsonSafe(request.payload, 16, [])) return null;
        var actionId = request.clientActionId === undefined ? createActionId() : request.clientActionId;
        if (typeof actionId !== "string" || !ACTION_ID.test(actionId)) return null;
        return submitMultiplayer({ type: "action", expectedRevision: request.expectedRevision, payload: request.payload, clientActionId: actionId }) ? actionId : null;
      } catch (_) {
        return null;
      }
    },
    input: function (payload) {
      return submitMultiplayer({ type: "input", payload: payload });
    },
    leave: function () {
      if (submitMultiplayer({ type: "leave" })) left = true;
    },
    subscribe: function (listener) {
      if (typeof listener !== "function") return function () {};
      listeners.push(listener);
      var subscribed = true;
      return function () {
        if (!subscribed) return;
        subscribed = false;
        var index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      };
    }
  };
  Object.defineProperty(multiplayerApi, "bootstrap", { enumerable: true, get: function () { return bootstrap; } });
  Object.freeze(multiplayerApi);

  var api = {
    start: function () { sendLegacy({ type: "GAME_STARTED" }); },
    event: function (name, data) {
      if (typeof name !== "string" || !LEGACY_NAME.test(name)) return;
      var message = { type: "GAME_EVENT", name: name };
      if (data !== undefined) message.data = data;
      sendLegacy(message);
    },
    complete: function (result) {
      if (completed) return;
      result = result || {};
      var message = { type: "GAME_COMPLETE" };
      if (result.outcome !== undefined) message.outcome = result.outcome;
      if (result.score !== undefined) message.score = result.score;
      if (result.progression !== undefined) message.progression = result.progression;
      if (result.metrics !== undefined) message.metrics = result.metrics;
      completed = true;
      sendLegacy(message);
    },
    cancel: function () { sendLegacy({ type: "GAME_CANCEL" }); },
    multiplayer: multiplayerApi
  };
  Object.defineProperty(window, "OWOGG", { value: Object.freeze(api), configurable: false });

  function validLegacyBootstrap(value) {
    if (!isPlainObject(value) || value.type !== "HOST_INIT" || !hasOnlyKeys(value, ["type", "difficultyId"])) return false;
    return value.difficultyId === undefined || (typeof value.difficultyId === "string" && value.difficultyId.length > 0 && value.difficultyId.length <= 100);
  }

  function init(event) {
    if (event.source !== window.parent || !event.data) return;
    var nextPort = event.ports && event.ports[0];
    if (!nextPort || typeof nextPort.postMessage !== "function") return;

    if (validLegacyBootstrap(event.data)) {
      window.removeEventListener("message", init);
      activeMode = "legacy";
      legacyPort = nextPort;
      post(legacyPort, { type: "GAME_READY" });
      legacyQueue.splice(0).forEach(function (message) { post(legacyPort, message); });
      return;
    }

    var nextBootstrap = parseBootstrap(event.data);
    if (!nextBootstrap) return;
    window.removeEventListener("message", init);
    activeMode = "multiplayer";
    bootstrap = nextBootstrap;
    multiplayerPort = nextPort;
    multiplayerPort.onmessage = receiveMultiplayer;
    if (typeof multiplayerPort.start === "function") multiplayerPort.start();
    multiplayerQueue.splice(0).forEach(sendMultiplayerIntent);
  }

  window.addEventListener("message", init);
})();`;
