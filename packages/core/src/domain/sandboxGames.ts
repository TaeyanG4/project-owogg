/**
 * External-developer sandbox game policy (pure domain constants + tiny pure predicates). See
 * docs/GAME_CREATION_GUIDE.md §3. No D1/Hono/R2 here.
 */

export const SANDBOX_GAME_VISIBILITIES = ["PRIVATE", "PUBLIC"] as const;
export type SandboxGameVisibility = (typeof SANDBOX_GAME_VISIBILITIES)[number];

/** Player-count shape declared by the creator in owogg.json's `game.mode` field. The generic
 * canonical `GENRE_MODE` catalog preserves this coarse `"single" | "multi"` source fact rather
 * than inventing the built-in taxonomy's richer `"local-multi" | "online-multi"` distinction. */
export const SANDBOX_GAME_MODES = ["single", "multi"] as const;
export type SandboxGameMode = (typeof SANDBOX_GAME_MODES)[number];

export function isValidSandboxGameMode(value: unknown): value is SandboxGameMode {
  return typeof value === "string" && (SANDBOX_GAME_MODES as readonly string[]).includes(value);
}

/** WITHDRAWN = the developer pulled their own submission before a decision was made — distinct
 * from REJECTED (an admin decision) even though both are terminal and both release the developer's
 * review slot (see SANDBOX_GAME_POLICY.MAX_CONCURRENT_REVIEW_SLOTS). */
export const SANDBOX_GAME_VERSION_STATUSES = [
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
] as const;
export type SandboxGameVersionStatus = (typeof SANDBOX_GAME_VERSION_STATUSES)[number];

/** Terminal review outcomes — once a version reaches one of these it never moves again, and it's
 * exactly these three (not PENDING_REVIEW) that release a game's review slot. */
export function isTerminalVersionStatus(status: SandboxGameVersionStatus): boolean {
  return status !== "PENDING_REVIEW";
}

/**
 * Publish state — a *separate axis* from review status above, in the same way visibility is.
 * Review answers "should this content be allowed?"; publish answers "are this version's individual
 * files actually sitting in object storage, complete, ready to be served from the CDN?".
 *
 * Deliberately only four states. An intermediate VALIDATING/VALIDATED pair would never be observed:
 * validation happens on the in-memory upload before anything is persisted, so a row only exists
 * once its bundle already passed validation. PUBLISHING exists because it genuinely can be
 * observed — it is the window during which some files are stored and others are not, and the one
 * state that must never be treated as servable (see docs/GAME_CREATION_GUIDE.md §3.2).
 */
export const SANDBOX_GAME_PUBLISH_STATUSES = ["UPLOADED", "PUBLISHING", "READY", "FAILED"] as const;
export type SandboxGamePublishStatus = (typeof SANDBOX_GAME_PUBLISH_STATUSES)[number];

/** Only a fully-published version may be served from its immutable per-version path, or be made
 * the live version. Partial publishes (`PUBLISHING`) and failures are never servable. */
export function isPublishedVersion(publishStatus: SandboxGamePublishStatus): boolean {
  return publishStatus === "READY";
}

export const SANDBOX_GAME_REVIEW_ACTIONS = [
  "VERSION_APPROVED",
  "VERSION_REJECTED",
  "VISIBILITY_CHANGED",
  "METADATA_CHANGED",
  "LIVE_VERSION_CHANGED",
  "SUBMISSION_WITHDRAWN",
] as const;
export type SandboxGameReviewAction = (typeof SANDBOX_GAME_REVIEW_ACTIONS)[number];

export const SANDBOX_GAME_POLICY = {
  MIN_TITLE_LENGTH: 1,
  MAX_TITLE_LENGTH: 60,
  MAX_SHORT_DESCRIPTION_LENGTH: 200,
  MAX_DESCRIPTION_LENGTH: 4000,
  MIN_SLUG_LENGTH: 3,
  MAX_SLUG_LENGTH: 64,
  /**
   * Beta limits (2026-08-17) — deliberately tighter than the pre-beta values (50MB/150MB/500
   * files) while B2 Caps/Alerts (docs/GAME_CREATION_GUIDE.md §3.8) are not yet confirmed live.
   * This is the ONLY place these numbers are defined — API validation, docs, and UI copy must all
   * read from here rather than repeating the literal, so a future limit change can't drift between
   * layers. See docs/WORK_PROGRESS.md's beta-blocker list.
   */
  /** Hard cap on a single uploaded bundle. This is the *compressed* archive as received, checked
   * before anything is decompressed — binary MiB, not decimal MB. */
  MAX_BUNDLE_BYTES: 20 * 1024 * 1024,
  /** Zip-bomb guard: cap on the sum of *declared* decompressed entry sizes, checked from the
   * archive's central directory before any entry is actually decompressed — see
   * BundleArchiveReader.readMetadata and GamePublicationService.prepare. A 20MiB archive can
   * legitimately expand well past 20MiB (WASM and Unity `.data` compress well), so this is
   * deliberately larger than MAX_BUNDLE_BYTES rather than equal to it. */
  MAX_EXTRACTED_BUNDLE_BYTES: 50 * 1024 * 1024,
  /** Cap on entry count: each entry becomes one stored object and one B2 transaction, so this is
   * a cost bound as much as an abuse bound. Checked from archive metadata before decompression. */
  MAX_BUNDLE_FILE_COUNT: 300,
  /** Cap on path segments per entry, guarding against deeply-nested-path abuse. */
  MAX_BUNDLE_PATH_DEPTH: 16,
  /** Beta submission quota (2026-08-17): the max number of games a single developer may have
   * simultaneously *awaiting their first review decision* — not a lifetime cap on games created,
   * and not a cap on total approved games (see `sandbox_games.review_slot` in migration 0024 and
   * SandboxGameUseCases.createGame/decideVersion/withdrawSubmission). Enforced as a real DB
   * invariant (a partial unique index), not just an application-level count, so concurrent
   * requests can't push a developer past it. */
  MAX_CONCURRENT_REVIEW_SLOTS: 2,
  /** Cap on a single logo file's decompressed size (2026-08-18) — generous for a catalog-card
   * icon (rendered at well under 100px in the grid) while still bounding the extra B2
   * write/storage cost a required-per-game asset adds. Counted separately from, and in addition
   * to, MAX_EXTRACTED_BUNDLE_BYTES — a logo this size is a rounding error against that cap, this
   * exists purely so one oversized image can't dominate an otherwise-tiny bundle's declared size. */
  MAX_LOGO_BYTES: 2 * 1024 * 1024,
} as const;

export function isValidSandboxGameSlug(slug: string): boolean {
  const trimmed = slug.trim();
  return (
    trimmed.length >= SANDBOX_GAME_POLICY.MIN_SLUG_LENGTH &&
    trimmed.length <= SANDBOX_GAME_POLICY.MAX_SLUG_LENGTH &&
    /^[a-z0-9-]+$/.test(trimmed)
  );
}

/**
 * A game may only be flipped PUBLIC once it has an approved bundle to actually serve — matches
 * the DB-level CHECK constraint on sandbox_games (migration 0024) so the use-case layer produces
 * a clear typed error instead of surfacing a raw constraint failure.
 */
export function canSetVisibilityPublic(hasLiveVersion: boolean): boolean {
  return hasLiveVersion;
}
