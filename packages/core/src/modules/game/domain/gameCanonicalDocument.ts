/**
 * Unified Game Platform, Stage U-1 — the provider-neutral "what a game is" document every game
 * (OwOGG official or user-published) converges on. U-1 introduced the schema, strict parser,
 * deterministic object key, and persistence port; C-1 consumes it through the provider-neutral
 * RuntimeGameRegistry for `/play/:slug`, and E-1 makes it the sole USER metadata authority.
 *
 * ## Runtime architecture (C-1)
 *
 *   Game Platform → RuntimeGameRegistry → D1 (identity/runtime) + B2 (canonical/bundle)
 *                                              → GameDefinition → /play/:slug → GameHost →
 *                                                IframeRuntime → Game Bridge
 *
 * SYSTEM and GAME_CREATOR are not meant to stay two permanently-separate deployment platforms — an
 * official game and a user-published game are meant to use the exact same D1+B2+iframe+Bridge
 * mechanics; the only real difference is {@link GamePublisher} (gamePublisher.ts) and whatever
 * review/permission policy applies to that publisher. This document is the "what the game is"
 * half of that eventual model — see gamePublisher.ts's own doc comment for the "who published it"
 * half, and the D1-vs-canonical boundary below for where the rest of a game's state lives.
 *
 * ## Canonical vs. D1 boundary — unchanged in spirit from Stage A, generalized
 *
 * Canonical (this document) — "what the game is":
 *   - **metadata**: title, shortDescription, description.
 *   - **catalog**: {@link GameCanonicalCatalog} — see that type's own doc comment for why this is
 *     a shape distinction, not a publisher distinction.
 *   - **policy**: score config, leaderboard participation, xpPerCompletion, requiresAuth — reuses
 *     `ScoreConfig` verbatim, the same shape `GameDefinition.policy` uses. `requiresAuth` is "must a player sign
 *     in to PLAY at all" — a distinct concern from score-*submission* authentication (see
 *     GameDefinition's own `GamePolicy` doc comment).
 *     `score: null` is a real, explicit "this game deliberately has no score" — never conflated
 *     with an upstream identity row whose score policy simply hasn't been configured yet (see
 *     domain/gameCreatorScorePolicy.ts's own doc comment on why that distinction is load-bearing).
 *   - **presentation**: reuses `GamePresentation` verbatim.
 *   - **difficulty**: reuses `DifficultyConfig` verbatim.
 *   - **supportsReplay**: whether the game can record/replay a session.
 *
 * D1-only, never duplicated here:
 *   - **identity**: the D1 row id, slug uniqueness enforcement.
 *   - **publisher ownership/authorization**: {@link GamePublisher} remains relational D1 state.
 *     Canonical carries only `publisher.official`, a public badge/presentation fact that must
 *     never be consulted for ownership or write permission.
 *   - **review/publish status, visibility, liveVersionId**: transactional axes that change
 *     independently of the game's own description.
 *   - **attempts/scores**: submission data, D1-transactional by nature.
 *   - **`status` (`GameStatus` — draft/beta/published/hidden)**: deliberately excluded from this
 *     document even though `SystemGameDefinition.status` exists today — it's an editorial/runtime
 *     lifecycle fact, the same category as review/visibility above, not a description of the game
 *     itself. A future D1 runtime migration is what carries it, not this canonical schema.
 *
 * Never store an environment-specific value (an API URL, a bucket name, ...) here — this document
 * is meant to be read identically regardless of which environment/host resolves it.
 */

import {
  OWOGG_PLAY_CONFIG_VERSION,
  type DifficultyConfig,
  type GameMode,
  type GamePresentation,
  type InputMethod,
  type OwoggGameCreatorManifest,
  type ScoreConfig,
} from "@owogg/game-sdk/contracts";
import type { SandboxGameMode } from "../../../domain/sandboxGames.js";
import { parseGameCreatorManifest } from "../../../domain/gameCreatorManifest.js";

/** OWOGG is pre-release, so the current canonical contract is intentionally rebased to v1.
 * There are no compatibility readers for earlier experimental canonical shapes. */
export const GAME_CANONICAL_SCHEMA_VERSION = 1 as const;

/** Public publisher presentation metadata. This is deliberately not an authorization fact:
 * ownership and write permission remain server-controlled relational state in D1. */
export interface GameCanonicalPublisher {
  readonly official: boolean;
}

/** Same shape as `GameDefinition.policy` — see this file's own top
 * doc comment for the field-by-field meaning. `parseGameCanonicalDocument` enforces, as
 * domain-invalid-state rejections (never silently coerced), the same invariants every existing
 * policy source already guarantees: `score.min < score.max` when scored (decimals allowed, no
 * integer restriction); `leaderboard: true` requires `score !== null` (nothing to rank otherwise);
 * `xpPerCompletion` is a non-negative integer capped at 100_000, matching the Game Creator admin
 * contract. `requiresAuth` is unaffected by any of this — it is still purely "must a
 * player sign in to PLAY at all", independent of score submission auth. */
export interface GameCanonicalPolicy {
  readonly score: ScoreConfig | null;
  readonly leaderboard: boolean;
  readonly xpPerCompletion: number;
  readonly requiresAuth: boolean;
}

export interface GameCanonicalPlayConfigVariant {
  readonly id: string;
  readonly label: string;
}

export interface GameCanonicalAllowedPlayConfig {
  readonly difficultyId: string;
  readonly variantId: string;
  readonly rewardFactor: number;
}

/** Server-approved competitive configuration. Unlike `creatorManifest.playConfig`, this
 * normalized projection is runtime authority after review, publication, and canonicalization. */
export interface GameCanonicalPlayConfig {
  readonly version: typeof OWOGG_PLAY_CONFIG_VERSION;
  readonly rulesetRevision: number;
  readonly verifierId: string;
  readonly defaultVariantId: string;
  readonly variants: readonly GameCanonicalPlayConfigVariant[];
  readonly allowedConfigs: readonly GameCanonicalAllowedPlayConfig[];
}

/**
 * A catalog metadata SHAPE, not a publisher distinction — `GENRE_MODE` does not mean "this is a
 * USER game" and `TAXONOMY` does not mean "this is an OWOGG game" (see this type's own name
 * deliberately avoiding "GAME_CREATOR"/"SYSTEM"). The two shapes exist because today's two metadata
 * sources genuinely collect different information — Game Creator submissions have never collected
 * categories/tags/inputMethods/thumbnail/minPlayers/maxPlayers (see
 * the USER submission model), while
 * legacy taxonomy-shaped games require them. Inventing values for the fields one shape doesn't
 * have (a fake thumbnail, guessed categories, ...) would be worse than admitting the gap exists —
 * that is exactly the "never invent a value nothing produced" rule this Stage's task description
 * states, applied at the type level. A future USER game is free to carry `TAXONOMY` once (and if)
 * user-published games ever collect that richer metadata; nothing here ties a shape to a
 * publisher permanently.
 */
export type GameCanonicalCatalog =
  | {
      readonly type: "GENRE_MODE";
      /** Free-text — see this type's own doc comment on why this isn't coerced into
       * `categories`. */
      readonly genre: string;
      /** `"single" | "multi"` — never translated into `TAXONOMY`'s richer
       * `"local-multi" | "online-multi"` distinction, which this shape's source has no way to
       * declare (see domain/gameDefinition.ts's own legacy `CreatorGameDefinition.mode` doc comment). */
      readonly mode: SandboxGameMode;
      readonly tags?: readonly string[] | undefined;
      readonly inputMethods?: readonly InputMethod[] | undefined;
    }
  | {
      readonly type: "TAXONOMY";
      readonly categories: readonly string[];
      readonly tags: readonly string[];
      readonly modes: readonly GameMode[];
      readonly inputMethods: readonly InputMethod[];
      readonly minPlayers: number;
      readonly maxPlayers: number;
      readonly thumbnail: string;
      readonly accent?: string | undefined;
      readonly estimatedRoundSeconds?: number | undefined;
    };

export interface GameCanonicalDocument {
  readonly schemaVersion: typeof GAME_CANONICAL_SCHEMA_VERSION;
  /** Global, immutable identity — never changes once a game ships (see this file's own top doc
   * comment). */
  readonly slug: string;
  readonly title: string;
  readonly shortDescription: string;
  readonly description: string;
  /** Controls the public "official" badge only. USER control-plane writes always force false. */
  readonly publisher: GameCanonicalPublisher;
  readonly policy: GameCanonicalPolicy;
  readonly presentation?: GamePresentation | undefined;
  readonly difficulty?: DifficultyConfig | undefined;
  readonly playConfig?: GameCanonicalPlayConfig | undefined;
  readonly supportsReplay: boolean;
  readonly catalog: GameCanonicalCatalog;
  /** The normalized public Game Creator v1 contract that produced this game/version. Publisher
   * and authorization facts are deliberately outside it and remain server-controlled. */
  readonly creatorManifest?: OwoggGameCreatorManifest | undefined;
  /** When this exact document was last written — provenance for debugging/audit, never a review
   * or publish timestamp (those stay in D1, on the identity row they actually describe). */
  readonly updatedAt: string;
}

/**
 * Deterministic B2 key for a game's canonical document, keyed by `slug` alone. Deliberately a
 * Separate prefix from `games/<gameId>/<versionId>/...` and `uploads/<gameId>/...`
 * (domain/sandboxGameBundle.ts). Canonical documents stay separate from both source archives and
 * published runtime bytes.
 */
export function gameCanonicalObjectKey(slug: string): string {
  return `game-definitions/${slug}/definition.json`;
}

export function serializeGameCanonicalDocument(document: GameCanonicalDocument): string {
  return JSON.stringify(document);
}

export const GAME_CANONICAL_DOCUMENT_REJECTIONS = [
  "MALFORMED_JSON",
  "UNSUPPORTED_SCHEMA_VERSION",
  "SLUG_MISMATCH",
  "INVALID_DOCUMENT",
] as const;
export type GameCanonicalDocumentRejection = (typeof GAME_CANONICAL_DOCUMENT_REJECTIONS)[number];

/** Thrown by {@link parseGameCanonicalDocument} — never silently swallowed into a default or
 * empty document. `detail` is a short, non-sensitive diagnostic (a field name, a value) — never
 * the raw stored bytes. */
export class GameCanonicalDocumentError extends Error {
  constructor(
    public readonly code: GameCanonicalDocumentRejection,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

function fail(code: GameCanonicalDocumentRejection, detail?: string): never {
  throw new GameCanonicalDocumentError(code, detail);
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("INVALID_DOCUMENT", `${context} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, field: string): string {
  const value = obj[field];
  if (typeof value !== "string") fail("INVALID_DOCUMENT", `${field} must be a string`);
  return value;
}

function requireBoolean(obj: Record<string, unknown>, field: string): boolean {
  const value = obj[field];
  if (typeof value !== "boolean") fail("INVALID_DOCUMENT", `${field} must be a boolean`);
  return value;
}

function requireNumber(obj: Record<string, unknown>, field: string): number {
  const value = obj[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("INVALID_DOCUMENT", `${field} must be a finite number`);
  }
  return value;
}

function requireInteger(obj: Record<string, unknown>, field: string): number {
  const value = requireNumber(obj, field);
  if (!Number.isInteger(value)) fail("INVALID_DOCUMENT", `${field} must be an integer`);
  return value;
}

function requireStringArray(obj: Record<string, unknown>, field: string): readonly string[] {
  const value = obj[field];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    fail("INVALID_DOCUMENT", `${field} must be an array of strings`);
  }
  return value as string[];
}

function requireEnumArray<T extends string>(
  obj: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  allowEmpty = false,
): readonly T[] {
  const value = obj[field];
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail("INVALID_DOCUMENT", `${field} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  for (const v of value) {
    if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
      fail("INVALID_DOCUMENT", `${field} entries must each be one of ${allowed.join(", ")}`);
    }
  }
  return value as T[];
}

function optionalBoolean(obj: Record<string, unknown>, field: string): boolean | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean")
    fail("INVALID_DOCUMENT", `${field} must be a boolean when present`);
  return value;
}

function optionalString(obj: Record<string, unknown>, field: string): string | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail("INVALID_DOCUMENT", `${field} must be a string when present`);
  return value;
}

function optionalPositiveNumber(obj: Record<string, unknown>, field: string): number | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail("INVALID_DOCUMENT", `${field} must be a positive number when present`);
  }
  return value;
}

/** Rejects unrecognised keys: a typo or stray field must fail loudly, never be silently dropped. */
function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      fail(
        "INVALID_DOCUMENT",
        `${context}: unknown field "${key}" (allowed: ${allowed.join(", ")})`,
      );
    }
  }
}

const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "slug",
  "title",
  "shortDescription",
  "description",
  "publisher",
  "policy",
  "presentation",
  "difficulty",
  "playConfig",
  "supportsReplay",
  "catalog",
  "creatorManifest",
  "updatedAt",
] as const;
const POLICY_KEYS = ["score", "leaderboard", "xpPerCompletion", "requiresAuth"] as const;
const PUBLISHER_KEYS = ["official"] as const;
const SCORE_KEYS = [
  "unit",
  "direction",
  "min",
  "max",
  "precision",
  "outOfRange",
  "displayPrefix",
  "displaySuffix",
] as const;
const SCORE_DIRECTIONS = ["asc", "desc"] as const;
// Same bound the Game Creator admin contract enforces, so this canonical schema fails closed on the
// same domain-invalid state.
const MAX_XP_PER_COMPLETION = 100_000;

function parseScoreConfig(value: unknown): ScoreConfig {
  const raw = asRecord(value, "policy.score");
  rejectUnknownKeys(raw, SCORE_KEYS, "policy.score");

  const direction = requireString(raw, "direction");
  if (!(SCORE_DIRECTIONS as readonly string[]).includes(direction)) {
    fail(
      "INVALID_DOCUMENT",
      `policy.score.direction must be one of ${SCORE_DIRECTIONS.join(", ")}`,
    );
  }
  // Finite decimal bounds, no integer restriction: sub-second timers must remain representable.
  const min = requireNumber(raw, "min");
  const max = requireNumber(raw, "max");
  // A min === max range can never produce a rankable outcome any more than min > max can.
  if (min >= max) {
    fail(
      "INVALID_DOCUMENT",
      `policy.score.min (${min}) must be less than policy.score.max (${max})`,
    );
  }
  const displayPrefix = optionalString(raw, "displayPrefix");
  const displaySuffix = optionalString(raw, "displaySuffix");
  const precision = raw.precision;
  if (
    precision !== undefined &&
    (typeof precision !== "number" ||
      !Number.isInteger(precision) ||
      precision < 0 ||
      precision > 6)
  ) {
    fail("INVALID_DOCUMENT", "policy.score.precision must be an integer between 0 and 6");
  }
  const outOfRange = raw.outOfRange;
  if (outOfRange !== undefined && outOfRange !== "clamp" && outOfRange !== "reject") {
    fail("INVALID_DOCUMENT", "policy.score.outOfRange must be clamp or reject");
  }

  return {
    unit: requireString(raw, "unit"),
    direction: direction as ScoreConfig["direction"],
    min,
    max,
    ...(typeof precision === "number" ? { precision } : {}),
    ...(outOfRange === "clamp" || outOfRange === "reject" ? { outOfRange } : {}),
    ...(displayPrefix !== undefined ? { displayPrefix } : {}),
    ...(displaySuffix !== undefined ? { displaySuffix } : {}),
  };
}

function parsePolicy(value: unknown): GameCanonicalPolicy {
  const raw = asRecord(value, "policy");
  rejectUnknownKeys(raw, POLICY_KEYS, "policy");
  if (!("score" in raw))
    fail("INVALID_DOCUMENT", "policy.score is required (use null if unscored)");
  const score = raw.score === null ? null : parseScoreConfig(raw.score);
  const leaderboard = requireBoolean(raw, "leaderboard");
  // A leaderboard cannot exist without a score policy. `score: null` stays
  // a legitimate, explicit "no score" state (see this file's own D1-vs-canonical boundary doc
  // comment) — it just can never be paired with `leaderboard: true`.
  if (leaderboard && score === null) {
    fail("INVALID_DOCUMENT", "policy.leaderboard is true but policy.score is null");
  }
  const xpPerCompletion = requireInteger(raw, "xpPerCompletion");
  if (xpPerCompletion < 0 || xpPerCompletion > MAX_XP_PER_COMPLETION) {
    fail(
      "INVALID_DOCUMENT",
      `policy.xpPerCompletion must be between 0 and ${MAX_XP_PER_COMPLETION}`,
    );
  }
  return {
    score,
    leaderboard,
    xpPerCompletion,
    requiresAuth: requireBoolean(raw, "requiresAuth"),
  };
}

// ── presentation ─────────────────────────────────────────────────────────────
//
// Strict presentation parsing: mode enum, positive finite dimensions, min<=max,
// preferred-doesn't-contradict-bounds, fixed preferred dimensions, fullscreen consistency,
// mobile enums, and unknown-key rejection at every level.

const VIEWPORT_MODES = ["responsive", "fixed"] as const;
const VIEWPORT_KEYS = [
  "mode",
  "preferredWidth",
  "preferredHeight",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
] as const;
const FULLSCREEN_KEYS = ["supported", "recommended"] as const;
const MOBILE_SUPPORT = ["supported", "experimental", "unsupported"] as const;
const MOBILE_ORIENTATIONS = ["any", "portrait", "landscape"] as const;
const MOBILE_KEYS = ["support", "orientation"] as const;
const PRESENTATION_KEYS = ["viewport", "fullscreen", "mobile", "defaultMode"] as const;

function parseViewport(value: unknown): GamePresentation["viewport"] {
  const raw = asRecord(value, "presentation.viewport");
  rejectUnknownKeys(raw, VIEWPORT_KEYS, "presentation.viewport");

  const mode = requireString(raw, "mode");
  if (!(VIEWPORT_MODES as readonly string[]).includes(mode)) {
    fail(
      "INVALID_DOCUMENT",
      `presentation.viewport.mode must be one of ${VIEWPORT_MODES.join(", ")}`,
    );
  }

  const preferredWidth = optionalPositiveNumber(raw, "preferredWidth");
  const preferredHeight = optionalPositiveNumber(raw, "preferredHeight");
  const minWidth = optionalPositiveNumber(raw, "minWidth");
  const minHeight = optionalPositiveNumber(raw, "minHeight");
  const maxWidth = optionalPositiveNumber(raw, "maxWidth");
  const maxHeight = optionalPositiveNumber(raw, "maxHeight");

  if (minWidth !== undefined && maxWidth !== undefined && minWidth > maxWidth) {
    fail("INVALID_DOCUMENT", "presentation.viewport.minWidth must be <= maxWidth");
  }
  if (minHeight !== undefined && maxHeight !== undefined && minHeight > maxHeight) {
    fail("INVALID_DOCUMENT", "presentation.viewport.minHeight must be <= maxHeight");
  }
  if (preferredWidth !== undefined && minWidth !== undefined && preferredWidth < minWidth) {
    fail("INVALID_DOCUMENT", "presentation.viewport.preferredWidth is below minWidth");
  }
  if (preferredWidth !== undefined && maxWidth !== undefined && preferredWidth > maxWidth) {
    fail("INVALID_DOCUMENT", "presentation.viewport.preferredWidth is above maxWidth");
  }
  if (preferredHeight !== undefined && minHeight !== undefined && preferredHeight < minHeight) {
    fail("INVALID_DOCUMENT", "presentation.viewport.preferredHeight is below minHeight");
  }
  if (preferredHeight !== undefined && maxHeight !== undefined && preferredHeight > maxHeight) {
    fail("INVALID_DOCUMENT", "presentation.viewport.preferredHeight is above maxHeight");
  }

  const bounds = {
    ...(minWidth !== undefined ? { minWidth } : {}),
    ...(minHeight !== undefined ? { minHeight } : {}),
    ...(maxWidth !== undefined ? { maxWidth } : {}),
    ...(maxHeight !== undefined ? { maxHeight } : {}),
  };

  if (mode === "fixed") {
    if (preferredWidth === undefined || preferredHeight === undefined) {
      fail(
        "INVALID_DOCUMENT",
        'presentation.viewport: mode "fixed" requires both preferredWidth and preferredHeight',
      );
    }
    return { mode: "fixed", preferredWidth, preferredHeight, ...bounds };
  }

  return {
    mode: "responsive",
    ...(preferredWidth !== undefined ? { preferredWidth } : {}),
    ...(preferredHeight !== undefined ? { preferredHeight } : {}),
    ...bounds,
  };
}

function parseFullscreen(value: unknown): GamePresentation["fullscreen"] {
  const raw = asRecord(value, "presentation.fullscreen");
  rejectUnknownKeys(raw, FULLSCREEN_KEYS, "presentation.fullscreen");

  const supported = requireBoolean(raw, "supported");
  const recommended = optionalBoolean(raw, "recommended");
  if (recommended === true && !supported) {
    fail(
      "INVALID_DOCUMENT",
      "presentation.fullscreen.recommended cannot be true when supported is false",
    );
  }

  return { supported, ...(recommended !== undefined ? { recommended } : {}) };
}

function parseMobile(value: unknown): GamePresentation["mobile"] {
  const raw = asRecord(value, "presentation.mobile");
  rejectUnknownKeys(raw, MOBILE_KEYS, "presentation.mobile");

  const support = requireString(raw, "support");
  if (!(MOBILE_SUPPORT as readonly string[]).includes(support)) {
    fail(
      "INVALID_DOCUMENT",
      `presentation.mobile.support must be one of ${MOBILE_SUPPORT.join(", ")}`,
    );
  }

  const orientation = raw.orientation;
  if (orientation !== undefined) {
    if (
      typeof orientation !== "string" ||
      !(MOBILE_ORIENTATIONS as readonly string[]).includes(orientation)
    ) {
      fail(
        "INVALID_DOCUMENT",
        `presentation.mobile.orientation must be one of ${MOBILE_ORIENTATIONS.join(", ")}`,
      );
    }
  }

  return {
    support: support as GamePresentation["mobile"]["support"],
    ...(typeof orientation === "string"
      ? { orientation: orientation as GamePresentation["mobile"]["orientation"] }
      : {}),
  };
}

function parsePresentation(value: unknown): GamePresentation {
  const raw = asRecord(value, "presentation");
  rejectUnknownKeys(raw, PRESENTATION_KEYS, "presentation");

  if (!("viewport" in raw)) fail("INVALID_DOCUMENT", "presentation.viewport is required");
  if (!("fullscreen" in raw)) fail("INVALID_DOCUMENT", "presentation.fullscreen is required");
  if (!("mobile" in raw)) fail("INVALID_DOCUMENT", "presentation.mobile is required");

  const defaultMode = raw.defaultMode;
  if (
    defaultMode !== undefined &&
    (typeof defaultMode !== "string" || !["default", "theater"].includes(defaultMode))
  ) {
    fail("INVALID_DOCUMENT", "presentation.defaultMode must be one of default, theater");
  }

  return {
    viewport: parseViewport(raw.viewport),
    fullscreen: parseFullscreen(raw.fullscreen),
    mobile: parseMobile(raw.mobile),
    ...(typeof defaultMode === "string"
      ? { defaultMode: defaultMode as GamePresentation["defaultMode"] }
      : {}),
  };
}

// ── difficulty ───────────────────────────────────────────────────────────────
//
// Non-empty levels, unique ids, a declared default, and unknown-key rejection.

const DIFFICULTY_KEYS = ["levels", "defaultLevelId"] as const;
const DIFFICULTY_LEVEL_KEYS = ["id", "label"] as const;

function parseDifficulty(value: unknown): DifficultyConfig {
  const raw = asRecord(value, "difficulty");
  rejectUnknownKeys(raw, DIFFICULTY_KEYS, "difficulty");

  const rawLevels = raw.levels;
  if (!Array.isArray(rawLevels) || rawLevels.length === 0) {
    fail("INVALID_DOCUMENT", "difficulty.levels must be a non-empty array");
  }

  const levels = rawLevels.map((entry, index) => {
    const level = asRecord(entry, `difficulty.levels[${index}]`);
    rejectUnknownKeys(level, DIFFICULTY_LEVEL_KEYS, `difficulty.levels[${index}]`);
    return {
      id: requireString(level, "id"),
      label: requireString(level, "label"),
    };
  });

  const ids = levels.map((level) => level.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate !== undefined) {
    fail("INVALID_DOCUMENT", `difficulty.levels has a duplicate id "${duplicate}"`);
  }

  const defaultLevelId = requireString(raw, "defaultLevelId");
  if (!ids.includes(defaultLevelId)) {
    fail(
      "INVALID_DOCUMENT",
      `difficulty.defaultLevelId "${defaultLevelId}" is not one of ${ids.join(", ")}`,
    );
  }

  return { levels, defaultLevelId };
}

// ── PlayConfig ──────────────────────────────────────────────────────────────

const PLAY_CONFIG_KEYS = [
  "version",
  "rulesetRevision",
  "verifierId",
  "defaultVariantId",
  "variants",
  "allowedConfigs",
] as const;
const PLAY_CONFIG_VARIANT_KEYS = ["id", "label"] as const;
const PLAY_CONFIG_ALLOWED_KEYS = ["difficultyId", "variantId", "rewardFactor"] as const;
const STABLE_VERIFIER_ID = /^[a-z0-9][a-z0-9._:/-]{0,95}$/;

function requireBoundedString(
  raw: Record<string, unknown>,
  field: string,
  context: string,
  maxLength: number,
  pattern?: RegExp,
): string {
  const value = requireString(raw, field);
  if (value.trim().length === 0 || value.length > maxLength || (pattern && !pattern.test(value))) {
    fail("INVALID_DOCUMENT", `${context}.${field} has an invalid format`);
  }
  return value;
}

/** Projects a strictly parsed manifest declaration into its server-owned canonical shape. */
export function projectManifestPlayConfigToCanonical(
  manifest: OwoggGameCreatorManifest,
): GameCanonicalPlayConfig | undefined {
  const declared = manifest.playConfig;
  if (declared === undefined) return undefined;
  const defaultVariantId =
    declared.variants.find((variant) => variant.default === true)?.id ?? declared.variants[0]?.id;
  if (defaultVariantId === undefined) {
    fail("INVALID_DOCUMENT", "creatorManifest.playConfig has no variant");
  }
  return {
    version: OWOGG_PLAY_CONFIG_VERSION,
    rulesetRevision: declared.rulesetRevision,
    verifierId: declared.verifierId,
    defaultVariantId,
    variants: declared.variants.map((variant) => ({ id: variant.id, label: variant.title })),
    allowedConfigs: declared.allowedConfigs.map((config) => ({ ...config })),
  };
}

function parsePlayConfig(
  value: unknown,
  difficulty: DifficultyConfig | undefined,
  policy: GameCanonicalPolicy,
): GameCanonicalPlayConfig {
  const raw = asRecord(value, "playConfig");
  rejectUnknownKeys(raw, PLAY_CONFIG_KEYS, "playConfig");
  if (raw.version !== OWOGG_PLAY_CONFIG_VERSION) {
    fail("INVALID_DOCUMENT", `playConfig.version must be ${OWOGG_PLAY_CONFIG_VERSION}`);
  }

  const rulesetRevision = requireNumber(raw, "rulesetRevision");
  if (!Number.isSafeInteger(rulesetRevision) || rulesetRevision <= 0) {
    fail("INVALID_DOCUMENT", "playConfig.rulesetRevision must be a positive safe integer");
  }
  const verifierId = requireBoundedString(raw, "verifierId", "playConfig", 96, STABLE_VERIFIER_ID);

  if (!Array.isArray(raw.variants) || raw.variants.length === 0) {
    fail("INVALID_DOCUMENT", "playConfig.variants must be a non-empty array");
  }
  const variants = raw.variants.map((entry, index) => {
    const context = `playConfig.variants[${index}]`;
    const variant = asRecord(entry, context);
    rejectUnknownKeys(variant, PLAY_CONFIG_VARIANT_KEYS, context);
    return {
      id: requireBoundedString(variant, "id", context, 100),
      label: requireBoundedString(variant, "label", context, 60),
    };
  });
  const variantIds = variants.map((variant) => variant.id);
  if (new Set(variantIds).size !== variantIds.length) {
    fail("INVALID_DOCUMENT", "playConfig.variants ids must be unique");
  }
  const defaultVariantId = requireBoundedString(raw, "defaultVariantId", "playConfig", 100);
  if (!variantIds.includes(defaultVariantId)) {
    fail("INVALID_DOCUMENT", "playConfig.defaultVariantId must reference a declared variant");
  }

  if (!Array.isArray(raw.allowedConfigs) || raw.allowedConfigs.length === 0) {
    fail("INVALID_DOCUMENT", "playConfig.allowedConfigs must be a non-empty array");
  }
  const difficultyIds = difficulty?.levels.map((level) => level.id) ?? ["normal"];
  const difficultyIdSet = new Set(difficultyIds);
  const variantIdSet = new Set(variantIds);
  const pairs = new Set<string>();
  const allowedConfigs = raw.allowedConfigs.map((entry, index) => {
    const context = `playConfig.allowedConfigs[${index}]`;
    const config = asRecord(entry, context);
    rejectUnknownKeys(config, PLAY_CONFIG_ALLOWED_KEYS, context);
    const difficultyId = requireBoundedString(config, "difficultyId", context, 100);
    const variantId = requireBoundedString(config, "variantId", context, 100);
    const rewardFactor = requireNumber(config, "rewardFactor");
    if (rewardFactor <= 0) {
      fail("INVALID_DOCUMENT", `${context}.rewardFactor must be greater than zero`);
    }
    if (!difficultyIdSet.has(difficultyId)) {
      fail("INVALID_DOCUMENT", `${context}.difficultyId is not declared`);
    }
    if (!variantIdSet.has(variantId)) {
      fail("INVALID_DOCUMENT", `${context}.variantId is not declared`);
    }
    const pair = `${difficultyId}\u0000${variantId}`;
    if (pairs.has(pair)) {
      fail("INVALID_DOCUMENT", "playConfig.allowedConfigs contains a duplicate pair");
    }
    pairs.add(pair);
    return { difficultyId, variantId, rewardFactor };
  });

  for (const difficultyId of difficultyIds) {
    if (!allowedConfigs.some((config) => config.difficultyId === difficultyId)) {
      fail("INVALID_DOCUMENT", `playConfig.allowedConfigs does not cover ${difficultyId}`);
    }
  }
  for (const variantId of variantIds) {
    if (!allowedConfigs.some((config) => config.variantId === variantId)) {
      fail("INVALID_DOCUMENT", `playConfig.allowedConfigs does not cover ${variantId}`);
    }
  }
  const defaultDifficultyId = difficulty?.defaultLevelId ?? "normal";
  if (!pairs.has(`${defaultDifficultyId}\u0000${defaultVariantId}`)) {
    fail("INVALID_DOCUMENT", "playConfig.allowedConfigs is missing the default pair");
  }
  if (policy.score === null || !policy.leaderboard) {
    fail("INVALID_DOCUMENT", "playConfig requires a scored leaderboard policy");
  }

  return {
    version: OWOGG_PLAY_CONFIG_VERSION,
    rulesetRevision,
    verifierId,
    defaultVariantId,
    variants,
    allowedConfigs,
  };
}

// ── catalog ──────────────────────────────────────────────────────────────────

const CATALOG_TYPES = ["GENRE_MODE", "TAXONOMY"] as const;
const GENRE_MODE_KEYS = ["type", "genre", "mode", "tags", "inputMethods"] as const;
const TAXONOMY_KEYS = [
  "type",
  "categories",
  "tags",
  "modes",
  "inputMethods",
  "minPlayers",
  "maxPlayers",
  "thumbnail",
  "accent",
  "estimatedRoundSeconds",
] as const;
const SANDBOX_GAME_MODE_VALUES = ["single", "multi"] as const;
const GAME_MODE_VALUES = ["single", "local-multi", "online-multi"] as const;
const INPUT_METHOD_VALUES = ["mouse", "keyboard", "touch", "gamepad"] as const;

function parseGenreModeCatalog(raw: Record<string, unknown>): GameCanonicalCatalog {
  rejectUnknownKeys(raw, GENRE_MODE_KEYS, "catalog");
  const mode = requireString(raw, "mode");
  if (!(SANDBOX_GAME_MODE_VALUES as readonly string[]).includes(mode)) {
    fail("INVALID_DOCUMENT", `catalog.mode must be one of ${SANDBOX_GAME_MODE_VALUES.join(", ")}`);
  }
  return {
    type: "GENRE_MODE",
    genre: requireString(raw, "genre"),
    mode: mode as SandboxGameMode,
    ...(raw.tags !== undefined ? { tags: requireStringArray(raw, "tags") } : {}),
    ...(raw.inputMethods !== undefined
      ? { inputMethods: requireEnumArray(raw, "inputMethods", INPUT_METHOD_VALUES, true) }
      : {}),
  };
}

function parseTaxonomyCatalog(raw: Record<string, unknown>): GameCanonicalCatalog {
  rejectUnknownKeys(raw, TAXONOMY_KEYS, "catalog");
  const minPlayers = requireInteger(raw, "minPlayers");
  const maxPlayers = requireInteger(raw, "maxPlayers");
  if (minPlayers < 1) fail("INVALID_DOCUMENT", "catalog.minPlayers must be at least 1");
  if (maxPlayers < minPlayers) {
    fail("INVALID_DOCUMENT", "catalog.maxPlayers must be >= catalog.minPlayers");
  }
  const accent = optionalString(raw, "accent");
  const estimatedRoundSeconds = optionalPositiveNumber(raw, "estimatedRoundSeconds");

  return {
    type: "TAXONOMY",
    categories: requireStringArray(raw, "categories"),
    tags: requireStringArray(raw, "tags"),
    modes: requireEnumArray(raw, "modes", GAME_MODE_VALUES),
    inputMethods: requireEnumArray(raw, "inputMethods", INPUT_METHOD_VALUES),
    minPlayers,
    maxPlayers,
    thumbnail: requireString(raw, "thumbnail"),
    ...(accent !== undefined ? { accent } : {}),
    ...(estimatedRoundSeconds !== undefined ? { estimatedRoundSeconds } : {}),
  };
}

function parseCatalog(value: unknown): GameCanonicalCatalog {
  const raw = asRecord(value, "catalog");
  const type = raw.type;
  if (typeof type !== "string" || !(CATALOG_TYPES as readonly string[]).includes(type)) {
    fail("INVALID_DOCUMENT", `catalog.type must be one of ${CATALOG_TYPES.join(", ")}`);
  }
  return type === "GENRE_MODE" ? parseGenreModeCatalog(raw) : parseTaxonomyCatalog(raw);
}

/**
 * Parses and validates a stored canonical document's JSON text against every fail-closed
 * condition this Stage requires: malformed JSON, an unsupported `schemaVersion`, a stored `slug`
 * that doesn't match what the caller actually requested, an unrecognised field at any level (top
 * level, `policy`, `policy.score`, `presentation` and its three sections, `difficulty` and its
 * levels, `catalog`), an invalid `catalog.type` discriminant, or any other shape that isn't a
 * valid document — including full deep validation of `presentation`/`difficulty`/`catalog`. None
 * of these ever produce a silent empty/default document — every failure throws
 * {@link GameCanonicalDocumentError}, which callers must propagate, never swallow.
 */
export function parseGameCanonicalDocument(
  jsonText: string,
  expectedSlug: string,
): GameCanonicalDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    fail("MALFORMED_JSON");
  }

  const obj = asRecord(parsed, "document");
  rejectUnknownKeys(obj, TOP_LEVEL_KEYS, "document");

  const schemaVersion = obj.schemaVersion;
  if (schemaVersion !== GAME_CANONICAL_SCHEMA_VERSION) {
    fail("UNSUPPORTED_SCHEMA_VERSION", `got ${JSON.stringify(schemaVersion)}`);
  }

  const rawPublisher = asRecord(obj.publisher, "publisher");
  rejectUnknownKeys(rawPublisher, PUBLISHER_KEYS, "publisher");
  const publisher: GameCanonicalPublisher = {
    official: requireBoolean(rawPublisher, "official"),
  };

  const slug = requireString(obj, "slug");
  if (slug !== expectedSlug) {
    fail("SLUG_MISMATCH", `stored "${slug}" != requested "${expectedSlug}"`);
  }

  if (!("policy" in obj)) fail("INVALID_DOCUMENT", "policy is required");
  const policy = parsePolicy(obj.policy);

  if (!("catalog" in obj)) fail("INVALID_DOCUMENT", "catalog is required");
  const catalog = parseCatalog(obj.catalog);

  const presentation =
    obj.presentation !== undefined ? parsePresentation(obj.presentation) : undefined;
  const difficulty = obj.difficulty !== undefined ? parseDifficulty(obj.difficulty) : undefined;
  const playConfig =
    obj.playConfig !== undefined ? parsePlayConfig(obj.playConfig, difficulty, policy) : undefined;
  let creatorManifest: OwoggGameCreatorManifest | undefined;
  if (obj.creatorManifest !== undefined) {
    try {
      creatorManifest = parseGameCreatorManifest(obj.creatorManifest);
    } catch (error) {
      fail(
        "INVALID_DOCUMENT",
        error instanceof Error ? `creatorManifest: ${error.message}` : "creatorManifest is invalid",
      );
    }
    if (creatorManifest.game.slug !== slug) {
      fail("INVALID_DOCUMENT", "creatorManifest.game.slug must match document.slug");
    }
  }
  const manifestPlayConfig =
    creatorManifest !== undefined
      ? projectManifestPlayConfigToCanonical(creatorManifest)
      : undefined;
  if (JSON.stringify(playConfig) !== JSON.stringify(manifestPlayConfig)) {
    fail(
      "INVALID_DOCUMENT",
      "playConfig must exactly match the normalized creatorManifest.playConfig declaration",
    );
  }

  return {
    schemaVersion: GAME_CANONICAL_SCHEMA_VERSION,
    slug,
    title: requireString(obj, "title"),
    shortDescription: requireString(obj, "shortDescription"),
    description: requireString(obj, "description"),
    publisher,
    policy,
    ...(presentation !== undefined ? { presentation } : {}),
    ...(difficulty !== undefined ? { difficulty } : {}),
    ...(playConfig !== undefined ? { playConfig } : {}),
    supportsReplay: requireBoolean(obj, "supportsReplay"),
    catalog,
    ...(creatorManifest !== undefined ? { creatorManifest } : {}),
    updatedAt: requireString(obj, "updatedAt"),
  };
}
