/**
 * The Host <-> Game postMessage/MessageChannel protocol — a small explicit message union, no generic RPC
 * framework (YAGNI; see the Game Platform migration plan's explicit "don't build more than this"
 * note on Game Bridge). Both `client.ts` (runs inside the game's iframe) and the host-side
 * controller (apps/web/app/features/game/runtime/) import these same validators, so there is
 * exactly one place that defines what a well-formed message looks like — hand-written rather than
 * built on a schema library: this must
 * stay importable into an arbitrary third-party game bundle with zero added dependencies, and the
 * validation is small enough that hand-writing it costs less than a library would.
 *
 * Every parse function returns `null` for anything that doesn't fit — untrusted input (postMessage
 * fires for literally any script that can reach the page, and a compromised or buggy game bundle
 * is explicitly the threat model here) is rejected silently, never thrown. See client.ts and the
 * host controller for why "ignore, don't throw" is the correct response.
 */

/** Runtime topology is deliberately separate from PlayConfig's competitive difficulty/variant. */
export type GamePlayMode = "single" | "local-multi" | "online-multi";

/** Bootstrap message, Host -> Game. The only host-originated window message in this protocol — see
 * the host controller's doc comment for why sending it is the one place `postMessage(..., "*")`
 * (rather than a MessagePort) is used at all.
 *
 * `difficultyId` supports the simple host-selected path. `playConfig` supports the verifier-backed
 * game-selected path. They are mutually exclusive, and neither ever contains an auth token,
 * attempt identity, verifier identity, or API address. */
export interface HostInitMessage {
  readonly type: "HOST_INIT";
  readonly difficultyId?: string;
  readonly playConfig?: PublicPlayConfigDescriptor;
  /** Approved topology choices for an in-game launcher. It grants no online authority by itself. */
  readonly playModes?: readonly GamePlayMode[];
}

/** Same order-of-magnitude cap as GAME_ERROR's `message` — bounds an arbitrary-length string a
 * compromised/buggy host could otherwise send, even though the host is OwOGG's own code today. */
const MAX_DIFFICULTY_ID_LENGTH = 100;
const MAX_PLAY_CONFIG_ID_LENGTH = 100;
const MAX_PLAY_CONFIG_LABEL_LENGTH = 60;
const MAX_CHALLENGE_SEED_LENGTH = 128;

export type JsonSafeValue =
  | null
  | string
  | number
  | boolean
  | readonly JsonSafeValue[]
  | { readonly [key: string]: JsonSafeValue };

export interface PlayConfigSelection {
  readonly difficultyId: string;
  readonly variantId: string;
}

export interface PublicPlayConfigDescriptor {
  readonly defaultDifficultyId: string;
  readonly defaultVariantId: string;
  readonly difficulties: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly variants: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly allowedConfigs: readonly {
    readonly difficultyId: string;
    readonly variantId: string;
    readonly rewardFactor: number;
  }[];
}

export interface AuthorizedStartContext {
  readonly ranked: boolean;
  readonly playConfig: PlayConfigSelection;
  readonly rulesetRevision: number;
  readonly challengeSeed: string;
  readonly rewardFactor: number;
}

export type HostStartErrorCode =
  | "ALREADY_REQUESTED"
  | "INVALID_PLAY_CONFIG"
  | "AUTH_REQUIRED"
  | "SESSION_UNAVAILABLE"
  | "GAME_UNAVAILABLE";

export interface HostStartMessage {
  readonly type: "HOST_START";
  readonly context: AuthorizedStartContext;
}

export interface HostStartErrorMessage {
  readonly type: "HOST_START_ERROR";
  readonly code: HostStartErrorCode;
}

export type HostPlayModeErrorCode = "ALREADY_SELECTED" | "INVALID_PLAY_MODE" | "MODE_UNAVAILABLE";

export interface HostPlayModeSelectedMessage {
  readonly type: "HOST_PLAY_MODE_SELECTED";
  readonly playMode: GamePlayMode;
}

export interface HostPlayModeErrorMessage {
  readonly type: "HOST_PLAY_MODE_ERROR";
  readonly code: HostPlayModeErrorCode;
}

export type HostToGameMessage =
  HostStartMessage | HostStartErrorMessage | HostPlayModeSelectedMessage | HostPlayModeErrorMessage;

export interface GameReadyMessage {
  readonly type: "GAME_READY";
}

export interface GameStartedMessage {
  readonly type: "GAME_STARTED";
}

export interface GameCompleteMessage {
  readonly type: "GAME_COMPLETE";
  readonly outcome?: "neutral" | "success" | "failure" | "win" | "loss" | "draw";
  readonly score?: number;
  readonly progression?: { readonly value: number };
  readonly metrics?: Record<string, number>;
  readonly metadata?: Record<string, unknown>;
  readonly evidence?: JsonSafeValue;
}

export interface GameRequestStartMessage {
  readonly type: "GAME_REQUEST_START";
  readonly playConfig: PlayConfigSelection;
}

export interface GameSelectPlayModeMessage {
  readonly type: "GAME_SELECT_PLAY_MODE";
  readonly playMode: GamePlayMode;
}

export interface GameEventMessage {
  readonly type: "GAME_EVENT";
  readonly name: string;
  readonly data?: unknown;
}

export interface GameCancelMessage {
  readonly type: "GAME_CANCEL";
}

/** Requests a fresh host-owned attempt. The game owns the visible restart control, while the
 * host remains responsible for rotating attempt/session identity and remounting the iframe. */
export interface GameRestartMessage {
  readonly type: "GAME_RESTART";
}

export interface GameErrorMessage {
  readonly type: "GAME_ERROR";
  readonly message?: string;
}

export type GameToHostMessage =
  | GameReadyMessage
  | GameStartedMessage
  | GameRequestStartMessage
  | GameSelectPlayModeMessage
  | GameEventMessage
  | GameCompleteMessage
  | GameRestartMessage
  | GameCancelMessage
  | GameErrorMessage;

export type GameBridgeMessage = HostInitMessage | HostToGameMessage | GameToHostMessage;

/** A message larger than this is rejected before its fields are even inspected — bounds how much
 * an iframe (untrusted code) can make the host process per message, independent of any one
 * field's own validation. 16KiB is generous for `GAME_COMPLETE`'s `metadata` (a handful of
 * numbers/short strings — see game-slug.tsx-era result screens for what these actually carry)
 * while still being a real bound, not a formality. */
export const GAME_BRIDGE_MAX_PAYLOAD_BYTES = 16 * 1024;

const textEncoder = new TextEncoder();

/** Cheap size check ahead of full validation — a `JSON.stringify` a caller was going to need
 * anyway (to actually send the message), not extra work added just to measure it. Measured in
 * actual UTF-8 bytes (`TextEncoder`, not `.length`): `.length` counts UTF-16 code units, which
 * undercounts anything outside ASCII — 한글 is 3 bytes but 1 code unit, so a `.length`-based
 * check could pass a payload that's meaningfully over the real wire size once it's Korean text
 * or emoji, which is exactly the kind of content a game's own metadata is likely to carry. */
export function isWithinBridgePayloadLimit(data: unknown): boolean {
  try {
    const json = JSON.stringify(data);
    if (typeof json !== "string") return false; // e.g. a bare function/symbol/undefined at the root
    return textEncoder.encode(json).length <= GAME_BRIDGE_MAX_PAYLOAD_BYTES;
  } catch {
    // Circular structures, BigInt, etc. — can't be sent over postMessage as JSON-shaped data
    // anyway, so treat "can't even stringify it" as "too big to accept".
    return false;
  }
}

/** A "plain object" for this protocol's purposes means specifically an object literal (or
 * `Object.create(null)`) — not an array, and not an instance of anything else. `typeof x ===
 * "object"` alone is not enough: `Date`, `Map`, `Set`, `RegExp`, `ArrayBuffer`, and typed arrays
 * are all `typeof "object"` too, and `JSON.stringify` silently reshapes every one of them (a
 * `Date` becomes a string, a `Map`/`ArrayBuffer` becomes `{}`) rather than rejecting them —
 * exactly the "quietly means something different than what was sent" failure this protocol
 * needs to avoid for untrusted iframe input. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
}

const JSON_SAFE_MAX_DEPTH = 16;

/**
 * Recursively confirms `value` is built only from values `JSON.stringify` represents faithfully
 * — the same values `JSON.parse(JSON.stringify(value))` would round-trip unchanged. Used on
 * `GAME_COMPLETE`'s `metadata`, the one field in this protocol shaped by the game rather than by
 * this file: a `Map`, `Date`, `ArrayBuffer`, or similar nested anywhere inside it must reject the
 * whole message, not get silently reshaped into whatever `JSON.stringify` happens to turn it
 * into. `maxDepth` bounds the recursion against a pathologically deep-but-small structure — a
 * cheap independent guard that doesn't depend on the byte-size check to catch it first.
 */
export function isJsonSafeValue(value: unknown, maxDepth = JSON_SAFE_MAX_DEPTH): boolean {
  if (value === null) return true;
  const type = typeof value;
  if (type === "string" || type === "boolean") return true;
  if (type === "number") return Number.isFinite(value as number);
  if (Array.isArray(value)) {
    if (maxDepth <= 0) return false;
    return value.every((item) => isJsonSafeValue(item, maxDepth - 1));
  }
  if (isPlainObject(value)) {
    if (maxDepth <= 0) return false;
    return Object.values(value).every((item) => isJsonSafeValue(item, maxDepth - 1));
  }
  // undefined, function, symbol, bigint, Date, Map, Set, RegExp, ArrayBuffer, typed arrays, class
  // instances, etc. — anything JSON.stringify would drop or silently reshape.
  return false;
}

function isBoundedId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PLAY_CONFIG_ID_LENGTH &&
    value.trim() === value
  );
}

function isBoundedLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PLAY_CONFIG_LABEL_LENGTH &&
    value.trim().length > 0
  );
}

export function isGamePlayMode(value: unknown): value is GamePlayMode {
  return value === "single" || value === "local-multi" || value === "online-multi";
}

export function isGamePlayModeList(value: unknown): value is readonly GamePlayMode[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 3) return false;
  if (!value.every(isGamePlayMode)) return false;
  return new Set(value).size === value.length;
}

export function isPlayConfigSelection(value: unknown): value is PlayConfigSelection {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.every((key) => key === "difficultyId" || key === "variantId") &&
    isBoundedId(value.difficultyId) &&
    isBoundedId(value.variantId)
  );
}

export function isPublicPlayConfigDescriptor(value: unknown): value is PublicPlayConfigDescriptor {
  if (!isPlainObject(value)) return false;
  if (
    !Object.keys(value).every((key) =>
      [
        "defaultDifficultyId",
        "defaultVariantId",
        "difficulties",
        "variants",
        "allowedConfigs",
      ].includes(key),
    ) ||
    Object.keys(value).length !== 5 ||
    !isBoundedId(value.defaultDifficultyId) ||
    !isBoundedId(value.defaultVariantId) ||
    !Array.isArray(value.difficulties) ||
    value.difficulties.length === 0 ||
    !Array.isArray(value.variants) ||
    value.variants.length === 0 ||
    !Array.isArray(value.allowedConfigs) ||
    value.allowedConfigs.length === 0
  ) {
    return false;
  }

  const difficulties = value.difficulties;
  const variants = value.variants;
  const allowedConfigs = value.allowedConfigs;
  if (
    difficulties.some(
      (entry) =>
        !isPlainObject(entry) ||
        Object.keys(entry).length !== 2 ||
        !Object.keys(entry).every((key) => key === "id" || key === "label") ||
        !isBoundedId(entry.id) ||
        !isBoundedLabel(entry.label),
    ) ||
    variants.some(
      (entry) =>
        !isPlainObject(entry) ||
        Object.keys(entry).length !== 2 ||
        !Object.keys(entry).every((key) => key === "id" || key === "label") ||
        !isBoundedId(entry.id) ||
        !isBoundedLabel(entry.label),
    ) ||
    allowedConfigs.some(
      (entry) =>
        !isPlainObject(entry) ||
        Object.keys(entry).length !== 3 ||
        !Object.keys(entry).every((key) =>
          ["difficultyId", "variantId", "rewardFactor"].includes(key),
        ) ||
        !isBoundedId(entry.difficultyId) ||
        !isBoundedId(entry.variantId) ||
        typeof entry.rewardFactor !== "number" ||
        !Number.isFinite(entry.rewardFactor) ||
        entry.rewardFactor <= 0,
    )
  ) {
    return false;
  }

  const difficultyIds = difficulties.map((entry) => entry.id as string);
  const variantIds = variants.map((entry) => entry.id as string);
  const pairs = allowedConfigs.map(
    (entry) => `${String(entry.difficultyId)}\u0000${String(entry.variantId)}`,
  );
  return (
    new Set(difficultyIds).size === difficultyIds.length &&
    new Set(variantIds).size === variantIds.length &&
    new Set(pairs).size === pairs.length &&
    difficultyIds.includes(value.defaultDifficultyId) &&
    variantIds.includes(value.defaultVariantId) &&
    allowedConfigs.every(
      (entry) =>
        difficultyIds.includes(entry.difficultyId as string) &&
        variantIds.includes(entry.variantId as string),
    ) &&
    pairs.includes(`${value.defaultDifficultyId}\u0000${value.defaultVariantId}`)
  );
}

/** Validates the one host-originated window message. Called by the game-side client when it receives the
 * bootstrap postMessage — see client.ts. Exact shape: any key besides
 * `type`/`difficultyId`/`playConfig`/`playModes` makes
 * this `false`, the same "no smuggled data" posture `parseGameToHostMessage` takes on every
 * game -> host message. `difficultyId` itself is optional (see HostInitMessage's own doc comment)
 * but must be a real, bounded, non-empty string when present — an empty string is never a
 * meaningful difficulty id, so it's rejected the same as a wrong type. */
export function isHostInitMessage(data: unknown): data is HostInitMessage {
  if (!isPlainObject(data) || data.type !== "HOST_INIT") return false;

  const keys = Object.keys(data);
  if (
    !keys.every(
      (k) => k === "type" || k === "difficultyId" || k === "playConfig" || k === "playModes",
    )
  ) {
    return false;
  }

  if ("difficultyId" in data && data.difficultyId !== undefined) {
    if (typeof data.difficultyId !== "string") return false;
    if (data.difficultyId.length === 0 || data.difficultyId.length > MAX_DIFFICULTY_ID_LENGTH) {
      return false;
    }
  }

  if ("playConfig" in data && data.playConfig !== undefined) {
    if (!isPublicPlayConfigDescriptor(data.playConfig)) return false;
    if (data.difficultyId !== undefined) return false;
  }

  if ("playModes" in data && data.playModes !== undefined) {
    if (!isGamePlayModeList(data.playModes)) return false;
  }

  return true;
}

function parseAuthorizedStartContext(value: unknown): AuthorizedStartContext | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 5 ||
    !keys.every((key) =>
      ["ranked", "playConfig", "rulesetRevision", "challengeSeed", "rewardFactor"].includes(key),
    ) ||
    typeof value.ranked !== "boolean" ||
    !isPlayConfigSelection(value.playConfig) ||
    typeof value.rulesetRevision !== "number" ||
    !Number.isSafeInteger(value.rulesetRevision) ||
    value.rulesetRevision <= 0 ||
    typeof value.challengeSeed !== "string" ||
    value.challengeSeed.length < 16 ||
    value.challengeSeed.length > MAX_CHALLENGE_SEED_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(value.challengeSeed) ||
    typeof value.rewardFactor !== "number" ||
    !Number.isFinite(value.rewardFactor) ||
    value.rewardFactor <= 0
  ) {
    return null;
  }
  return {
    ranked: value.ranked,
    playConfig: { ...value.playConfig },
    rulesetRevision: value.rulesetRevision,
    challengeSeed: value.challengeSeed,
    rewardFactor: value.rewardFactor,
  };
}

const HOST_START_ERROR_CODES = [
  "ALREADY_REQUESTED",
  "INVALID_PLAY_CONFIG",
  "AUTH_REQUIRED",
  "SESSION_UNAVAILABLE",
  "GAME_UNAVAILABLE",
] as const satisfies readonly HostStartErrorCode[];

const HOST_PLAY_MODE_ERROR_CODES = [
  "ALREADY_SELECTED",
  "INVALID_PLAY_MODE",
  "MODE_UNAVAILABLE",
] as const satisfies readonly HostPlayModeErrorCode[];

export function parseHostToGameMessage(data: unknown): HostToGameMessage | null {
  if (!isWithinBridgePayloadLimit(data)) return null;
  if (!isPlainObject(data) || typeof data.type !== "string") return null;
  const keys = Object.keys(data);
  if (data.type === "HOST_START") {
    if (keys.length !== 2 || !keys.every((key) => key === "type" || key === "context")) {
      return null;
    }
    const context = parseAuthorizedStartContext(data.context);
    return context ? { type: "HOST_START", context } : null;
  }
  if (data.type === "HOST_START_ERROR") {
    if (
      keys.length !== 2 ||
      !keys.every((key) => key === "type" || key === "code") ||
      typeof data.code !== "string" ||
      !(HOST_START_ERROR_CODES as readonly string[]).includes(data.code)
    ) {
      return null;
    }
    return { type: "HOST_START_ERROR", code: data.code as HostStartErrorCode };
  }
  if (data.type === "HOST_PLAY_MODE_SELECTED") {
    if (
      keys.length !== 2 ||
      !keys.every((key) => key === "type" || key === "playMode") ||
      !isGamePlayMode(data.playMode)
    ) {
      return null;
    }
    return { type: "HOST_PLAY_MODE_SELECTED", playMode: data.playMode };
  }
  if (data.type === "HOST_PLAY_MODE_ERROR") {
    if (
      keys.length !== 2 ||
      !keys.every((key) => key === "type" || key === "code") ||
      typeof data.code !== "string" ||
      !(HOST_PLAY_MODE_ERROR_CODES as readonly string[]).includes(data.code)
    ) {
      return null;
    }
    return { type: "HOST_PLAY_MODE_ERROR", code: data.code as HostPlayModeErrorCode };
  }
  return null;
}

/** Validates any message the game may send. Called by the host-side bridge controller for every
 * message received on the MessagePort — see apps/web/app/features/game/runtime/gameBridgeHost.ts.
 * Returns `null` for anything that isn't exactly one of the known shapes, INCLUDING a
 * structurally-plausible object with an extra/wrong-typed field — a lenient parser here is exactly
 * how an untrusted game could smuggle unexpected data into host state. */
export function parseGameToHostMessage(data: unknown): GameToHostMessage | null {
  if (!isWithinBridgePayloadLimit(data)) return null;
  if (!isPlainObject(data) || typeof data.type !== "string") return null;

  const keys = Object.keys(data);

  switch (data.type) {
    case "GAME_READY":
    case "GAME_STARTED":
    case "GAME_RESTART":
    case "GAME_CANCEL":
      return keys.length === 1 ? ({ type: data.type } as GameToHostMessage) : null;

    case "GAME_REQUEST_START":
      if (
        keys.length !== 2 ||
        !keys.every((key) => key === "type" || key === "playConfig") ||
        !isPlayConfigSelection(data.playConfig)
      ) {
        return null;
      }
      return { type: "GAME_REQUEST_START", playConfig: { ...data.playConfig } };

    case "GAME_SELECT_PLAY_MODE":
      if (
        keys.length !== 2 ||
        !keys.every((key) => key === "type" || key === "playMode") ||
        !isGamePlayMode(data.playMode)
      ) {
        return null;
      }
      return { type: "GAME_SELECT_PLAY_MODE", playMode: data.playMode };

    case "GAME_COMPLETE": {
      if (
        !keys.every((k) =>
          ["type", "outcome", "score", "progression", "metrics", "metadata", "evidence"].includes(
            k,
          ),
        )
      )
        return null;
      if ("outcome" in data && data.outcome !== undefined) {
        if (
          typeof data.outcome !== "string" ||
          !["neutral", "success", "failure", "win", "loss", "draw"].includes(data.outcome)
        )
          return null;
      }
      if ("score" in data && data.score !== undefined) {
        if (typeof data.score !== "number" || !Number.isFinite(data.score)) return null;
      }
      if ("progression" in data && data.progression !== undefined) {
        if (
          !isPlainObject(data.progression) ||
          Object.keys(data.progression).some((key) => key !== "value") ||
          typeof data.progression.value !== "number" ||
          !Number.isFinite(data.progression.value)
        )
          return null;
      }
      if ("metrics" in data && data.metrics !== undefined) {
        if (
          !isPlainObject(data.metrics) ||
          Object.values(data.metrics).some(
            (value) => typeof value !== "number" || !Number.isFinite(value),
          )
        )
          return null;
      }
      if ("metadata" in data && data.metadata !== undefined) {
        if (!isPlainObject(data.metadata) || !isJsonSafeValue(data.metadata)) return null;
      }
      if ("evidence" in data && data.evidence !== undefined && !isJsonSafeValue(data.evidence)) {
        return null;
      }
      return {
        type: "GAME_COMPLETE",
        ...(data.outcome !== undefined
          ? {
              outcome: data.outcome as Exclude<GameCompleteMessage["outcome"], undefined>,
            }
          : {}),
        ...(data.score !== undefined ? { score: data.score as number } : {}),
        ...(data.progression !== undefined
          ? { progression: data.progression as { value: number } }
          : {}),
        ...(data.metrics !== undefined ? { metrics: data.metrics as Record<string, number> } : {}),
        ...(data.metadata !== undefined
          ? { metadata: data.metadata as Record<string, unknown> }
          : {}),
        ...(data.evidence !== undefined ? { evidence: data.evidence as JsonSafeValue } : {}),
      };
    }

    case "GAME_EVENT": {
      if (!keys.every((key) => key === "type" || key === "name" || key === "data")) return null;
      if (typeof data.name !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(data.name))
        return null;
      if ("data" in data && data.data !== undefined && !isJsonSafeValue(data.data)) return null;
      return {
        type: "GAME_EVENT",
        name: data.name,
        ...(data.data !== undefined ? { data: data.data } : {}),
      };
    }

    case "GAME_ERROR": {
      if (!keys.every((k) => k === "type" || k === "message")) return null;
      if ("message" in data && data.message !== undefined) {
        if (typeof data.message !== "string" || data.message.length > 500) return null;
      }
      return {
        type: "GAME_ERROR",
        ...(data.message !== undefined ? { message: data.message as string } : {}),
      };
    }

    default:
      return null;
  }
}
