/**
 * Dependency-free browser adapter injected into every served game entry document. Generic
 * single/local calls and managed-online calls use separate queues and mutually-exclusive bridge
 * handshakes. Neither path exposes a token, global user id, session id, or API/WebSocket address.
 */
export const OWOGG_BROWSER_API_SOURCE = String.raw`(function () {
  "use strict";
  if (window.OWOGG) return;

  var MAX_QUEUE = 32;
  var GENERIC_EVENT_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
  var OPAQUE_ID = /^[A-Za-z0-9_-]{8,128}$/;
  var SHA256 = /^[a-f0-9]{64}$/;
  var DISCONNECT_CODES = ["NETWORK_LOST", "SERVER_UNAVAILABLE", "REPLACED_BY_NEW_CONNECTION", "AUTH_EXPIRED", "SLOW_CONSUMER", "LEFT"];
  var RELAY_REJECTIONS = ["MATCH_NOT_ACTIVE", "DIRECT_MESSAGES_DISABLED", "TARGET_UNAVAILABLE", "SNAPSHOT_DISABLED", "HOST_REQUIRED"];
  var RELAY_CLOSE_CODES = ["HOST_LEFT", "PARTICIPANT_LEFT", "ROOM_EXPIRED", "ADMIN_KILLED", "SERVER_UNAVAILABLE"];

  var activeMode = null;
  var genericPort = null;
  var multiplayerPort = null;
  var genericQueue = [];
  var multiplayerQueue = [];
  var completed = false;
  var startRequested = false;
  var startAuthorized = false;
  var pendingStart = null;
  var publicPlayConfig = null;
  var playModeRequested = false;
  var selectedPlayMode = null;
  var pendingPlayMode = null;
  var publicPlayModes = Object.freeze([]);
  var bridgeReadyResolve = null;
  var bridgeReady = new Promise(function (resolve) { bridgeReadyResolve = resolve; });
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

  function queueGeneric(message) {
    if (genericQueue.length < MAX_QUEUE) {
      genericQueue.push(message);
      return true;
    }
    if (message.type === "GAME_COMPLETE") {
      genericQueue.shift();
      genericQueue.push(message);
      return true;
    }
    return false;
  }

  function sendGeneric(message) {
    if (completed && message.type !== "GAME_COMPLETE") return false;
    if (activeMode === "multiplayer") return false;
    if (genericPort) return post(genericPort, message);
    return queueGeneric(message);
  }

  function validPlayConfigSelection(value) {
    return isPlainObject(value) &&
      hasOnlyKeys(value, ["difficultyId", "variantId"]) &&
      Object.keys(value).length === 2 &&
      typeof value.difficultyId === "string" && value.difficultyId.length > 0 && value.difficultyId.length <= 100 && value.difficultyId.trim() === value.difficultyId &&
      typeof value.variantId === "string" && value.variantId.length > 0 && value.variantId.length <= 100 && value.variantId.trim() === value.variantId;
  }

  function validPlayMode(value) {
    return value === "single" || value === "local-multi" || value === "online-multi";
  }

  function validPlayModes(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 3) return false;
    for (var index = 0; index < value.length; index += 1) {
      if (!validPlayMode(value[index]) || value.indexOf(value[index]) !== index) return false;
    }
    return true;
  }

  function validPublicPlayConfig(value) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ["defaultDifficultyId", "defaultVariantId", "difficulties", "variants", "allowedConfigs"]) || Object.keys(value).length !== 5) return false;
    if (typeof value.defaultDifficultyId !== "string" || typeof value.defaultVariantId !== "string" || !Array.isArray(value.difficulties) || !Array.isArray(value.variants) || !Array.isArray(value.allowedConfigs)) return false;
    if (value.difficulties.length === 0 || value.variants.length === 0 || value.allowedConfigs.length === 0) return false;
    var difficultyIds = [];
    var variantIds = [];
    var pairs = [];
    for (var difficultyIndex = 0; difficultyIndex < value.difficulties.length; difficultyIndex += 1) {
      var difficulty = value.difficulties[difficultyIndex];
      if (!isPlainObject(difficulty) || !hasOnlyKeys(difficulty, ["id", "label"]) || Object.keys(difficulty).length !== 2 || typeof difficulty.id !== "string" || difficulty.id.length === 0 || difficulty.id.length > 100 || difficulty.id.trim() !== difficulty.id || typeof difficulty.label !== "string" || difficulty.label.trim().length === 0 || difficulty.label.length > 60) return false;
      if (difficultyIds.indexOf(difficulty.id) !== -1) return false;
      difficultyIds.push(difficulty.id);
    }
    for (var variantIndex = 0; variantIndex < value.variants.length; variantIndex += 1) {
      var variant = value.variants[variantIndex];
      if (!isPlainObject(variant) || !hasOnlyKeys(variant, ["id", "label"]) || Object.keys(variant).length !== 2 || typeof variant.id !== "string" || variant.id.length === 0 || variant.id.length > 100 || variant.id.trim() !== variant.id || typeof variant.label !== "string" || variant.label.trim().length === 0 || variant.label.length > 60) return false;
      if (variantIds.indexOf(variant.id) !== -1) return false;
      variantIds.push(variant.id);
    }
    for (var configIndex = 0; configIndex < value.allowedConfigs.length; configIndex += 1) {
      var config = value.allowedConfigs[configIndex];
      if (!isPlainObject(config) || !hasOnlyKeys(config, ["difficultyId", "variantId", "rewardFactor"]) || Object.keys(config).length !== 3 || !validPlayConfigSelection({ difficultyId: config.difficultyId, variantId: config.variantId }) || typeof config.rewardFactor !== "number" || !Number.isFinite(config.rewardFactor) || config.rewardFactor <= 0) return false;
      if (difficultyIds.indexOf(config.difficultyId) === -1 || variantIds.indexOf(config.variantId) === -1) return false;
      var pair = config.difficultyId + "\u0000" + config.variantId;
      if (pairs.indexOf(pair) !== -1) return false;
      pairs.push(pair);
    }
    return difficultyIds.indexOf(value.defaultDifficultyId) !== -1 && variantIds.indexOf(value.defaultVariantId) !== -1 && pairs.indexOf(value.defaultDifficultyId + "\u0000" + value.defaultVariantId) !== -1;
  }

  function freezePublicPlayConfig(value) {
    if (!validPublicPlayConfig(value)) return null;
    return Object.freeze({
      defaultDifficultyId: value.defaultDifficultyId,
      defaultVariantId: value.defaultVariantId,
      difficulties: Object.freeze(value.difficulties.map(function (entry) { return Object.freeze({ id: entry.id, label: entry.label }); })),
      variants: Object.freeze(value.variants.map(function (entry) { return Object.freeze({ id: entry.id, label: entry.label }); })),
      allowedConfigs: Object.freeze(value.allowedConfigs.map(function (entry) { return Object.freeze({ difficultyId: entry.difficultyId, variantId: entry.variantId, rewardFactor: entry.rewardFactor }); }))
    });
  }

  function isAllowedPlayConfig(config) {
    return publicPlayConfig !== null && publicPlayConfig.allowedConfigs.some(function (allowed) {
      return allowed.difficultyId === config.difficultyId && allowed.variantId === config.variantId;
    });
  }

  function genericPlayModeIsAuthorized() {
    if (publicPlayModes.length === 0) return true;
    if (publicPlayModes.length === 1) return publicPlayModes[0] !== "online-multi";
    return selectedPlayMode === "single" || selectedPlayMode === "local-multi";
  }

  function startError(code) {
    var error = new Error(code);
    error.name = "GameStartRequestError";
    error.code = code;
    return error;
  }

  function playModeError(code) {
    var error = new Error(code);
    error.name = "GamePlayModeSelectionError";
    error.code = code;
    return error;
  }

  function parseStartContext(value) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ["ranked", "playConfig", "rulesetRevision", "challengeSeed", "rewardFactor"]) || Object.keys(value).length !== 5) return null;
    if (typeof value.ranked !== "boolean" || !validPlayConfigSelection(value.playConfig) || !isPositiveInteger(value.rulesetRevision) || typeof value.challengeSeed !== "string" || value.challengeSeed.length < 16 || value.challengeSeed.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value.challengeSeed) || typeof value.rewardFactor !== "number" || !Number.isFinite(value.rewardFactor) || value.rewardFactor <= 0) return null;
    return Object.freeze({
      ranked: value.ranked,
      playConfig: Object.freeze({ difficultyId: value.playConfig.difficultyId, variantId: value.playConfig.variantId }),
      rulesetRevision: value.rulesetRevision,
      challengeSeed: value.challengeSeed,
      rewardFactor: value.rewardFactor
    });
  }

  function receiveGeneric(event) {
    var value = event && event.data;
    if ((!pendingStart && !pendingPlayMode) || !isWithinLimit(value, 16384) || !isPlainObject(value) || typeof value.type !== "string") return;
    if (value.type === "HOST_PLAY_MODE_ERROR") {
      var modeCodes = ["ALREADY_SELECTED", "INVALID_PLAY_MODE", "MODE_UNAVAILABLE"];
      if (!pendingPlayMode || !hasOnlyKeys(value, ["type", "code"]) || Object.keys(value).length !== 2 || modeCodes.indexOf(value.code) === -1) return;
      var rejectedMode = pendingPlayMode;
      pendingPlayMode = null;
      rejectedMode.reject(playModeError(value.code));
      return;
    }
    if (value.type === "HOST_PLAY_MODE_SELECTED") {
      if (!pendingPlayMode || !hasOnlyKeys(value, ["type", "playMode"]) || Object.keys(value).length !== 2 || !validPlayMode(value.playMode)) return;
      var resolvedMode = pendingPlayMode;
      pendingPlayMode = null;
      if (value.playMode !== resolvedMode.playMode) {
        resolvedMode.reject(playModeError("MODE_UNAVAILABLE"));
        return;
      }
      selectedPlayMode = value.playMode;
      resolvedMode.resolve(value.playMode);
      return;
    }
    if (!pendingStart) return;
    if (value.type === "HOST_START_ERROR") {
      var codes = ["ALREADY_REQUESTED", "INVALID_PLAY_CONFIG", "AUTH_REQUIRED", "SESSION_UNAVAILABLE", "GAME_UNAVAILABLE"];
      if (!hasOnlyKeys(value, ["type", "code"]) || Object.keys(value).length !== 2 || codes.indexOf(value.code) === -1) return;
      var rejected = pendingStart;
      pendingStart = null;
      rejected.reject(startError(value.code));
      return;
    }
    if (value.type !== "HOST_START" || !hasOnlyKeys(value, ["type", "context"]) || Object.keys(value).length !== 2) return;
    var context = parseStartContext(value.context);
    if (!context) return;
    var resolved = pendingStart;
    pendingStart = null;
    if (context.playConfig.difficultyId !== resolved.config.difficultyId || context.playConfig.variantId !== resolved.config.variantId) {
      resolved.reject(startError("GAME_UNAVAILABLE"));
      return;
    }
    startAuthorized = true;
    resolved.resolve(context);
  }

  function buildMultiplayerMessage(intent, generation, sequence) {
    if (intent.type === "ready") return { type: "MULTI_READY", v: 1, generation: generation };
    if (intent.type === "leave") return { type: "MULTI_LEAVE", v: 1, generation: generation };
    if (intent.type === "relay-send" && intent.delivery === "broadcast") return { type: "RELAY_SEND", v: 1, generation: generation, clientSeq: sequence, delivery: "broadcast", payload: intent.payload };
    if (intent.type === "relay-send" && intent.delivery === "direct") return { type: "RELAY_SEND", v: 1, generation: generation, clientSeq: sequence, delivery: "direct", targetParticipantId: intent.targetParticipantId, payload: intent.payload };
    if (intent.type === "relay-snapshot") return { type: "RELAY_SNAPSHOT_SET", v: 1, generation: generation, clientSeq: sequence, payload: intent.payload };
    return null;
  }

  function validMultiplayerIntent(intent) {
    if (!isPlainObject(intent) || typeof intent.type !== "string") return false;
    var message = buildMultiplayerMessage(intent, 9007199254740991, 9007199254740991);
    if (!message) return false;
    if (intent.type === "relay-send") {
      if ((intent.delivery !== "broadcast" && intent.delivery !== "direct") || !isJsonSafe(intent.payload, 16, []) || !isWithinLimit(intent.payload, 4096)) return false;
      if (intent.delivery === "direct" && (typeof intent.targetParticipantId !== "string" || !OPAQUE_ID.test(intent.targetParticipantId))) return false;
    } else if (intent.type === "relay-snapshot") {
      if (!isJsonSafe(intent.payload, 16, []) || !isWithinLimit(intent.payload, 16384)) return false;
    } else if (intent.type !== "ready" && intent.type !== "leave") {
      return false;
    }
    return isWithinLimit(message, intent.type === "relay-snapshot" || intent.type === "relay-send" ? 20480 : 4096);
  }

  function multiplayerIntentAllowed(intent) {
    if (intent.type === "ready" || intent.type === "leave") return true;
    if (!bootstrap) return false;
    if (intent.type === "relay-send" && intent.delivery === "broadcast") return true;
    if (intent.type === "relay-send" && intent.delivery === "direct") return bootstrap.capabilities.directMessages;
    return intent.type === "relay-snapshot" && bootstrap.capabilities.hostSnapshot && bootstrap.self.role === "HOST";
  }

  function sendMultiplayerIntent(intent) {
    if (!multiplayerPort || !bootstrap || !multiplayerIntentAllowed(intent)) return false;
    var needsSequence = intent.type === "relay-send" || intent.type === "relay-snapshot";
    var nextSequence = needsSequence ? clientSeq + 1 : 0;
    if (needsSequence && !Number.isSafeInteger(nextSequence)) return false;
    var message = buildMultiplayerMessage(intent, bootstrap.generation, nextSequence);
    if (!message || !isWithinLimit(message, intent.type === "relay-snapshot" || intent.type === "relay-send" ? 20480 : 4096) || !post(multiplayerPort, message)) return false;
    if (needsSequence) clientSeq = nextSequence;
    return true;
  }

  function submitMultiplayer(intent) {
    if (left || activeMode === "generic" || !validMultiplayerIntent(intent)) return false;
    if (multiplayerPort) return sendMultiplayerIntent(intent);
    if (multiplayerQueue.length >= MAX_QUEUE) return false;
    multiplayerQueue.push(intent);
    return true;
  }

  function parseBootstrapParticipant(value) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ["participantId", "seatIndex", "role"]) || Object.keys(value).length !== 3) return null;
    if (typeof value.participantId !== "string" || !OPAQUE_ID.test(value.participantId) || !isNonNegativeInteger(value.seatIndex) || value.seatIndex > 7 || (value.role !== "HOST" && value.role !== "PLAYER")) return null;
    return Object.freeze({ participantId: value.participantId, seatIndex: value.seatIndex, role: value.role });
  }

  function parseBootstrap(value) {
    if (!isPlainObject(value) || value.type !== "MULTI_INIT" || value.v !== 1) return null;
    if (!hasOnlyKeys(value, ["type", "v", "gameVersionId", "contentHash", "profileRevision", "generation", "runtime", "self", "roster", "capabilities"]) || Object.keys(value).length !== 10) return null;
    if (!isPositiveInteger(value.gameVersionId) || typeof value.contentHash !== "string" || !SHA256.test(value.contentHash) || !isPositiveInteger(value.profileRevision) || !isPositiveInteger(value.generation)) return null;
    if (!isPlainObject(value.runtime) || !hasOnlyKeys(value.runtime, ["kind", "protocolVersion", "resultTrust"]) || Object.keys(value.runtime).length !== 3 || value.runtime.kind !== "relay" || value.runtime.protocolVersion !== 1 || value.runtime.resultTrust !== "UNVERIFIED") return null;
    if (!isPlainObject(value.capabilities) || !hasOnlyKeys(value.capabilities, ["reconnect", "broadcast", "directMessages", "hostSnapshot"]) || Object.keys(value.capabilities).length !== 4 || (value.capabilities.reconnect !== "none" && value.capabilities.reconnect !== "resume") || value.capabilities.broadcast !== true || typeof value.capabilities.directMessages !== "boolean" || typeof value.capabilities.hostSnapshot !== "boolean") return null;
    var self = parseBootstrapParticipant(value.self);
    if (!self || !Array.isArray(value.roster) || value.roster.length < 2 || value.roster.length > 8) return null;
    var roster = [];
    var participantIds = [];
    var seatIndexes = [];
    var hostCount = 0;
    var selfFound = false;
    for (var rosterIndex = 0; rosterIndex < value.roster.length; rosterIndex += 1) {
      var participant = parseBootstrapParticipant(value.roster[rosterIndex]);
      if (!participant || participantIds.indexOf(participant.participantId) !== -1 || seatIndexes.indexOf(participant.seatIndex) !== -1 || (rosterIndex > 0 && participant.seatIndex <= roster[rosterIndex - 1].seatIndex)) return null;
      participantIds.push(participant.participantId);
      seatIndexes.push(participant.seatIndex);
      if (participant.role === "HOST") hostCount += 1;
      if (participant.participantId === self.participantId && participant.seatIndex === self.seatIndex && participant.role === self.role) selfFound = true;
      roster.push(participant);
    }
    if (hostCount !== 1 || !selfFound) return null;
    return Object.freeze({
      type: "MULTI_INIT",
      v: 1,
      gameVersionId: value.gameVersionId,
      contentHash: value.contentHash,
      profileRevision: value.profileRevision,
      generation: value.generation,
      runtime: Object.freeze({ kind: "relay", protocolVersion: 1, resultTrust: "UNVERIFIED" }),
      self: self,
      roster: Object.freeze(roster),
      capabilities: Object.freeze({ reconnect: value.capabilities.reconnect, broadcast: true, directMessages: value.capabilities.directMessages, hostSnapshot: value.capabilities.hostSnapshot })
    });
  }

  function commonServerEnvelope(value) {
    return value.v === 1 && isPositiveInteger(value.generation) && isNonNegativeInteger(value.serverSeq);
  }

  function parseRelaySender(value) {
    return parseBootstrapParticipant(value);
  }

  function parseRelaySnapshot(value) {
    if (!isPlainObject(value) || !hasOnlyKeys(value, ["revision", "hash", "payload"]) || Object.keys(value).length !== 3 || !isPositiveInteger(value.revision) || typeof value.hash !== "string" || !SHA256.test(value.hash) || !isJsonSafe(value.payload, 16, []) || !isWithinLimit(value.payload, 16384)) return null;
    return value;
  }

  function parseHostMessage(value) {
    if (!isWithinLimit(value, 20480) || !isPlainObject(value) || typeof value.type !== "string" || value.v !== 1 || !isPositiveInteger(value.generation)) return null;
    switch (value.type) {
      case "MULTI_CONNECTED":
        return hasOnlyKeys(value, ["type", "v", "generation", "connectionGeneration"]) && isPositiveInteger(value.connectionGeneration) ? value : null;
      case "MULTI_DISCONNECTED":
        return hasOnlyKeys(value, ["type", "v", "generation", "code"]) && isAllowed(value.code, DISCONNECT_CODES) ? value : null;
      case "RELAY_MESSAGE":
        if (!commonServerEnvelope(value) || (value.delivery !== "broadcast" && value.delivery !== "direct") || !parseRelaySender(value.sender) || !isJsonSafe(value.payload, 16, []) || !isWithinLimit(value.payload, 4096)) return null;
        if (value.delivery === "broadcast") return hasOnlyKeys(value, ["type", "v", "generation", "serverSeq", "sender", "delivery", "payload"]) && Object.keys(value).length === 7 ? value : null;
        return hasOnlyKeys(value, ["type", "v", "generation", "serverSeq", "sender", "delivery", "targetParticipantId", "payload"]) && Object.keys(value).length === 8 && typeof value.targetParticipantId === "string" && OPAQUE_ID.test(value.targetParticipantId) ? value : null;
      case "RELAY_SYNC":
        if (!hasOnlyKeys(value, ["type", "v", "generation", "serverSeq", "snapshot"]) || Object.keys(value).length !== 5 || !commonServerEnvelope(value)) return null;
        return value.snapshot === null || parseRelaySnapshot(value.snapshot) ? value : null;
      case "RELAY_REJECTED":
        return hasOnlyKeys(value, ["type", "v", "generation", "clientSeq", "code"]) && Object.keys(value).length === 5 && isPositiveInteger(value.clientSeq) && isAllowed(value.code, RELAY_REJECTIONS) ? value : null;
      case "RELAY_CLOSED":
        return hasOnlyKeys(value, ["type", "v", "generation", "code"]) && Object.keys(value).length === 4 && isAllowed(value.code, RELAY_CLOSE_CODES) ? value : null;
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
    send: function (request) {
      try {
        if (!isPlainObject(request)) return false;
        if (request.delivery === "broadcast" && hasOnlyKeys(request, ["delivery", "payload"]) && Object.keys(request).length === 2) return submitMultiplayer({ type: "relay-send", delivery: "broadcast", payload: request.payload });
        if (request.delivery === "direct" && hasOnlyKeys(request, ["delivery", "targetParticipantId", "payload"]) && Object.keys(request).length === 3) return submitMultiplayer({ type: "relay-send", delivery: "direct", targetParticipantId: request.targetParticipantId, payload: request.payload });
        return false;
      } catch (_) {
        return false;
      }
    },
    broadcast: function (payload) {
      return submitMultiplayer({ type: "relay-send", delivery: "broadcast", payload: payload });
    },
    direct: function (targetParticipantId, payload) {
      return submitMultiplayer({ type: "relay-send", delivery: "direct", targetParticipantId: targetParticipantId, payload: payload });
    },
    snapshot: function (payload) {
      return submitMultiplayer({ type: "relay-snapshot", payload: payload });
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
    whenReady: function () { return bridgeReady; },
    selectPlayMode: function (playMode) {
      if (completed || activeMode === "multiplayer") return Promise.reject(playModeError("MODE_UNAVAILABLE"));
      if (playModeRequested) return Promise.reject(playModeError("ALREADY_SELECTED"));
      if (!validPlayMode(playMode)) return Promise.reject(playModeError("INVALID_PLAY_MODE"));
      if (activeMode === "generic" && publicPlayModes.indexOf(playMode) === -1) return Promise.reject(playModeError("INVALID_PLAY_MODE"));
      playModeRequested = true;
      return new Promise(function (resolve, reject) {
        pendingPlayMode = { playMode: playMode, resolve: resolve, reject: reject };
        if (!sendGeneric({ type: "GAME_SELECT_PLAY_MODE", playMode: playMode })) {
          pendingPlayMode = null;
          reject(playModeError("MODE_UNAVAILABLE"));
        }
      });
    },
    requestStart: function (config) {
      if (completed) return Promise.reject(startError("GAME_UNAVAILABLE"));
      if (activeMode === "multiplayer") return Promise.reject(startError("GAME_UNAVAILABLE"));
      if (startRequested) return Promise.reject(startError("ALREADY_REQUESTED"));
      if (!genericPlayModeIsAuthorized()) return Promise.reject(startError("GAME_UNAVAILABLE"));
      if (!validPlayConfigSelection(config)) return Promise.reject(startError("INVALID_PLAY_CONFIG"));
      if (activeMode === "generic" && publicPlayConfig === null) return Promise.reject(startError("INVALID_PLAY_CONFIG"));
      if (publicPlayConfig !== null && !isAllowedPlayConfig(config)) return Promise.reject(startError("INVALID_PLAY_CONFIG"));
      startRequested = true;
      return new Promise(function (resolve, reject) {
        pendingStart = { config: { difficultyId: config.difficultyId, variantId: config.variantId }, resolve: resolve, reject: reject };
        if (!sendGeneric({ type: "GAME_REQUEST_START", playConfig: { difficultyId: config.difficultyId, variantId: config.variantId } })) {
          pendingStart = null;
          reject(startError("GAME_UNAVAILABLE"));
        }
      });
    },
    start: function () {
      if (!genericPlayModeIsAuthorized()) return;
      if (publicPlayConfig !== null && !startAuthorized) return;
      sendGeneric({ type: "GAME_STARTED" });
    },
    event: function (name, data) {
      if (!genericPlayModeIsAuthorized()) return;
      if (typeof name !== "string" || !GENERIC_EVENT_NAME.test(name)) return;
      var message = { type: "GAME_EVENT", name: name };
      if (data !== undefined) message.data = data;
      sendGeneric(message);
    },
    complete: function (result) {
      if (completed) return;
      if (!genericPlayModeIsAuthorized()) return;
      result = result || {};
      if (publicPlayConfig !== null && (!startAuthorized || result.evidence === undefined || result.outcome !== undefined || result.score !== undefined || result.progression !== undefined || result.metrics !== undefined)) return;
      var message = { type: "GAME_COMPLETE" };
      if (result.outcome !== undefined) message.outcome = result.outcome;
      if (result.score !== undefined) message.score = result.score;
      if (result.progression !== undefined) message.progression = result.progression;
      if (result.metrics !== undefined) message.metrics = result.metrics;
      if (result.evidence !== undefined) message.evidence = result.evidence;
      if (!isJsonSafe(message, 16, []) || !isWithinLimit(message, 16384)) return;
      completed = true;
      sendGeneric(message);
    },
    restart: function () { sendGeneric({ type: "GAME_RESTART" }); },
    cancel: function () { sendGeneric({ type: "GAME_CANCEL" }); },
    multiplayer: multiplayerApi
  };
  Object.defineProperty(api, "playConfig", { enumerable: true, get: function () { return publicPlayConfig; } });
  Object.defineProperty(api, "playModes", { enumerable: true, get: function () { return publicPlayModes; } });
  Object.defineProperty(window, "OWOGG", { value: Object.freeze(api), configurable: false });

  function validGenericBootstrap(value) {
    if (!isPlainObject(value) || value.type !== "HOST_INIT" || !hasOnlyKeys(value, ["type", "difficultyId", "playConfig", "playModes"])) return false;
    if (value.difficultyId !== undefined && (typeof value.difficultyId !== "string" || value.difficultyId.length === 0 || value.difficultyId.length > 100)) return false;
    if (value.playConfig !== undefined && (!validPublicPlayConfig(value.playConfig) || value.difficultyId !== undefined)) return false;
    if (value.playModes !== undefined && !validPlayModes(value.playModes)) return false;
    return true;
  }

  function init(event) {
    if (event.source !== window.parent || !event.data) return;
    var nextPort = event.ports && event.ports[0];
    if (!nextPort || typeof nextPort.postMessage !== "function") return;

    if (validGenericBootstrap(event.data)) {
      window.removeEventListener("message", init);
      activeMode = "generic";
      genericPort = nextPort;
      publicPlayConfig = freezePublicPlayConfig(event.data.playConfig);
      publicPlayModes = Object.freeze(event.data.playModes ? event.data.playModes.slice() : []);
      if (publicPlayModes.length === 1) selectedPlayMode = publicPlayModes[0];
      genericPort.onmessage = receiveGeneric;
      if (typeof genericPort.start === "function") genericPort.start();
      post(genericPort, { type: "GAME_READY" });
      if (bridgeReadyResolve) {
        bridgeReadyResolve();
        bridgeReadyResolve = null;
      }
      var queuedGeneric = genericQueue.splice(0);
      if (pendingPlayMode && publicPlayModes.indexOf(pendingPlayMode.playMode) === -1) {
        var invalidMode = pendingPlayMode;
        pendingPlayMode = null;
        invalidMode.reject(playModeError("INVALID_PLAY_MODE"));
        queuedGeneric = queuedGeneric.filter(function (message) { return message.type !== "GAME_SELECT_PLAY_MODE"; });
      }
      if (pendingStart && !isAllowedPlayConfig(pendingStart.config)) {
        var invalidStart = pendingStart;
        pendingStart = null;
        invalidStart.reject(startError("INVALID_PLAY_CONFIG"));
        queuedGeneric = queuedGeneric.filter(function (message) { return message.type !== "GAME_REQUEST_START"; });
      }
      queuedGeneric.forEach(function (message) {
        var accepted = post(genericPort, message);
        if (!accepted && message.type === "GAME_SELECT_PLAY_MODE" && pendingPlayMode) {
          var failedMode = pendingPlayMode;
          pendingPlayMode = null;
          failedMode.reject(playModeError("MODE_UNAVAILABLE"));
        }
        if (!accepted && message.type === "GAME_REQUEST_START" && pendingStart) {
          var failedStart = pendingStart;
          pendingStart = null;
          failedStart.reject(startError("GAME_UNAVAILABLE"));
        }
      });
      return;
    }

    var nextBootstrap = parseBootstrap(event.data);
    if (!nextBootstrap) return;
    window.removeEventListener("message", init);
    activeMode = "multiplayer";
    if (pendingPlayMode) {
      var abandonedMode = pendingPlayMode;
      pendingPlayMode = null;
      abandonedMode.reject(playModeError("MODE_UNAVAILABLE"));
    }
    if (pendingStart) {
      var abandonedStart = pendingStart;
      pendingStart = null;
      abandonedStart.reject(startError("GAME_UNAVAILABLE"));
    }
    bootstrap = nextBootstrap;
    multiplayerPort = nextPort;
    multiplayerPort.onmessage = receiveMultiplayer;
    if (typeof multiplayerPort.start === "function") multiplayerPort.start();
    if (bridgeReadyResolve) {
      bridgeReadyResolve();
      bridgeReadyResolve = null;
    }
    multiplayerQueue.splice(0).forEach(sendMultiplayerIntent);
  }

  window.addEventListener("message", init);
})();`;
