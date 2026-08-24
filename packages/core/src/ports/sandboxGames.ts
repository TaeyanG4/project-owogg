import type {
  SandboxGameVisibility,
  SandboxGameVersionStatus,
  SandboxGamePublishStatus,
  SandboxGameMode,
} from "../domain/sandboxGames.js";

export interface SandboxGameRecord {
  id: number;
  slug: string;
  developerUserId: number;
  title: string;
  shortDescription: string | null;
  description: string | null;
  genre: string;
  /** "single" | "multi" (2026-08-18) — required on every game created via
   * createGameFromBundle, the only registration path since the manual form was removed. */
  mode: SandboxGameMode;
  /** Internal storage key of the game's logo image (see domain/sandboxGameBundle.ts's
   * sandboxGameLogoObjectKey), or null for a game registered before logos were required. Never
   * exposed to a client as-is — mirrors objectKey/manifestKey on SandboxGameVersionRecord below;
   * the contract layer (packages/contracts/src/sandboxGames.ts) transforms this into a plain
   * `hasLogo: boolean`, and a client that needs to actually display it hits the public
   * GET /api/games/sandbox/:slug/logo route instead of ever seeing where the bytes live. */
  logoKey: string | null;
  xpPerCompletion: number;
  scoreUnit: string | null;
  scoreDirection: "asc" | "desc" | null;
  scoreMin: number | null;
  scoreMax: number | null;
  scoreDisplayPrefix: string | null;
  scoreDisplaySuffix: string | null;
  visibility: SandboxGameVisibility;
  /** Non-null once at least one uploaded version has been approved — see migration 0024's
   * comment on why this isn't a declared FK. */
  liveVersionId: number | null;
  /** Beta concurrent-submission quota slot (1 or 2), non-null while this game is still awaiting
   * its first review decision; null once decided (APPROVED/REJECTED) or withdrawn, and never
   * reclaimed afterward. See SANDBOX_GAME_POLICY.MAX_CONCURRENT_REVIEW_SLOTS. */
  reviewSlot: 1 | 2 | null;
  /** Soft delete (migration 0026) — mirrors scores.deleted_at. Non-null means an ADMIN/OPERATOR
   * removed this game; the row and its versions are kept for audit, but it is excluded from every
   * public/queue listing and can never be served (deleteGame also forces visibility back to
   * PRIVATE, which the existing isVersionServable gate already enforces). */
  deletedAt: string | null;
  deletedByAdminId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SandboxGameVersionRecord {
  id: number;
  gameId: number;
  /** Provider-neutral storage key of the *source archive* (opaque to callers — built by
   * `sourceArchiveObjectKey`). Never rename this to something provider-specific again — see
   * docs/GAME_CREATION_GUIDE.md §3.2's R2→B2 migration note. The individual files served to
   * players are separate published objects, addressed by gameId+versionId, not derived from this. */
  objectKey: string;
  contentHash: string;
  bundleBytes: number;
  status: SandboxGameVersionStatus;
  reviewedByAdminId: number | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  uploadedAt: string;
  /** Publish axis — independent of `status` above. See SANDBOX_GAME_PUBLISH_STATUSES. */
  publishStatus: SandboxGamePublishStatus;
  /** Short diagnostic set when publishStatus is FAILED; never contains bundle contents or secrets. */
  publishError: string | null;
  publishedAt: string | null;
  /** Storage key of this version's published manifest, set once publishing succeeds. */
  manifestKey: string | null;
  /** Sum of the published files' sizes (decompressed), distinct from `bundleBytes` (the archive). */
  publishedSizeBytes: number | null;
  fileCount: number | null;
}

export interface SandboxGameReviewAuditEntry {
  id: number;
  gameId: number;
  versionId: number | null;
  actorAdminId: number;
  action: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** Every field is optional — callers pass only what changed. `undefined` = leave unchanged,
 * `null` (on nullable fields) = explicitly clear. Mirrors the same convention as
 * AdminScoreSubmissionBlockRequestSchema's `reason` field elsewhere in this codebase. */
export interface SandboxGameMetadataInput {
  title?: string | undefined;
  shortDescription?: string | null | undefined;
  description?: string | null | undefined;
  genre?: string | undefined;
  xpPerCompletion?: number | undefined;
  scoreUnit?: string | null | undefined;
  scoreDirection?: "asc" | "desc" | null | undefined;
  scoreMin?: number | null | undefined;
  scoreMax?: number | null | undefined;
  scoreDisplayPrefix?: string | null | undefined;
  scoreDisplaySuffix?: string | null | undefined;
}

export interface SandboxGamePendingVersionsPage {
  versions: SandboxGameVersionRecord[];
  total: number;
}

/**
 * Persistence port for sandbox game catalog entries + their uploaded bundle versions (migration
 * 0024). Review (per-version) and visibility (per-game) are independent axes — see the migration
 * file's comment on sandbox_games for why. No update/delete path on the review audit log
 * (append-only), same pattern as UserModerationRepository/StreamerReviewRepository.
 */
export interface SandboxGameRepository {
  findById(id: number): Promise<SandboxGameRecord | null>;
  findBySlug(slug: string): Promise<SandboxGameRecord | null>;
  /** Whether `slug` is taken at the DB level — includes generic identity rows (including
   * soft-deleted rows) and permanent slug reservations, unlike findBySlug. The pre-insert check
   * must agree with both DB authorities or registration can crash with a raw uniqueness/trigger
   * failure instead of returning a clean SLUG_TAKEN. */
  slugExists(slug: string): Promise<boolean>;
  listByDeveloper(developerUserId: number): Promise<SandboxGameRecord[]>;
  /** Every game, including soft-deleted ones, regardless of developer or visibility — the
   * admin-facing "browse everything" surface (see SandboxGameUseCases.listAll's doc comment for
   * why deleted games are deliberately included here). */
  listAll(): Promise<SandboxGameRecord[]>;

  /**
   * Creates a game AND atomically claims one of the developer's `MAX_CONCURRENT_REVIEW_SLOTS`
   * review slots in the same operation — implementations must do this as one statement (or
   * equivalent single-round-trip atomic operation), not a separate count-then-insert, so a race
   * between concurrent submissions can never exceed the limit. Returns null (inserting nothing)
   * when no slot is available; the use case turns that into SUBMISSION_LIMIT_REACHED.
   */
  create(input: {
    slug: string;
    developerUserId: number;
    title: string;
    shortDescription: string | null;
    description: string | null;
    genre: string;
    mode: SandboxGameMode;
    nowIso: string;
  }): Promise<SandboxGameRecord | null>;

  /** Releases a game's review slot (sets it to null). Idempotent — a no-op if the slot is already
   * null. Called once a game's submission reaches a terminal state (see isTerminalVersionStatus):
   * approved, rejected, or withdrawn. Never reclaimed afterward. */
  releaseReviewSlot(id: number, nowIso: string): Promise<SandboxGameRecord>;

  /** Records where a game's logo object lives (see domain/sandboxGameBundle.ts's
   * sandboxGameLogoObjectKey) — called once, right after the logo bytes are actually stored,
   * during createGameFromBundle. There is currently no route to change a logo after registration. */
  setLogo(id: number, logoKey: string, nowIso: string): Promise<SandboxGameRecord>;

  /** Soft delete (migration 0026) — sets deleted_at/deleted_by_admin_id and forces visibility back
   * to PRIVATE in the same write (belt-and-suspenders: the existing isVersionServable gate already
   * refuses to serve a non-PUBLIC game, so this alone stops serving even before any listing filter
   * takes effect). The row and its versions are kept, not removed. */
  softDelete(id: number, deletedByAdminId: number, nowIso: string): Promise<SandboxGameRecord>;

  /** Hard delete — removes the game row and its versions/review-audit rows entirely. Application
   * callers use it only for never-approved drafts; the database intentionally does not delete any
   * permanent slug reservation, so even an old-worker/racing hard delete cannot free an approved
   * public identity. Implementations must remove the three workflow tables atomically regardless
   * of whether FK ON DELETE CASCADE is relied upon. */
  hardDelete(id: number): Promise<void>;

  updateMetadata(
    id: number,
    input: SandboxGameMetadataInput,
    nowIso: string,
  ): Promise<SandboxGameRecord>;

  setVisibility(
    id: number,
    visibility: SandboxGameVisibility,
    nowIso: string,
  ): Promise<SandboxGameRecord>;

  setLiveVersion(id: number, versionId: number, nowIso: string): Promise<SandboxGameRecord>;

  createVersion(input: {
    gameId: number;
    objectKey: string;
    contentHash: string;
    bundleBytes: number;
    nowIso: string;
  }): Promise<SandboxGameVersionRecord>;

  findVersionById(id: number): Promise<SandboxGameVersionRecord | null>;
  listVersionsByGame(gameId: number): Promise<SandboxGameVersionRecord[]>;

  /** Records a publish-axis transition. Called several times across one publish (PUBLISHING, then
   * READY or FAILED), so it takes only the fields that change — a READY transition carries the
   * manifest/size/count, a FAILED one carries the error, and both clear the other's fields. */
  setVersionPublishState(
    id: number,
    state: {
      publishStatus: SandboxGamePublishStatus;
      publishError: string | null;
      publishedAt: string | null;
      manifestKey: string | null;
      publishedSizeBytes: number | null;
      fileCount: number | null;
    },
  ): Promise<SandboxGameVersionRecord>;

  /** Admin review queue: every PENDING_REVIEW version across all games, oldest first. */
  listPendingVersions(limit: number, offset: number): Promise<SandboxGamePendingVersionsPage>;

  decideVersion(
    id: number,
    status: "APPROVED" | "REJECTED",
    adminId: number,
    reason: string | null,
    nowIso: string,
  ): Promise<SandboxGameVersionRecord>;

  /** Reverts a version's decision back to PENDING_REVIEW — an admin undoing a mistaken approval
   * (see SandboxGameUseCases.revokeApproval), not a developer action. Clears
   * reviewedByAdminId/reviewedAt/rejectReason. Callers are expected to have already checked the
   * version is currently APPROVED. */
  revokeVersionApproval(id: number): Promise<SandboxGameVersionRecord>;

  /** If `versionId` is currently `gameId`'s live_version_id, clears it and forces visibility back
   * to PRIVATE in the same write (same CHECK-constraint reasoning as softDelete) — a no-op if the
   * game's live version has already moved on to something else. Used by revokeApproval so an
   * un-approved version immediately stops being served. */
  clearLiveVersionIfMatches(
    gameId: number,
    versionId: number,
    nowIso: string,
  ): Promise<SandboxGameRecord>;

  /** Developer self-service withdrawal of their own still-pending submission — sets status to
   * WITHDRAWN. Only meaningful from PENDING_REVIEW; implementations should make the transition a
   * no-op (matching row unchanged) rather than throwing if called on an already-terminal version,
   * since the use case is expected to have already filtered to pending versions. No timestamp
   * parameter: unlike decideVersion, nobody reviewed this — there is no `reviewed_at` to stamp,
   * only the game-level `updated_at` from the paired releaseReviewSlot call. */
  withdrawVersion(id: number): Promise<SandboxGameVersionRecord>;

  appendReviewAudit(entry: {
    gameId: number;
    versionId: number | null;
    actorAdminId: number;
    action: string;
    reason: string | null;
    metadata: Record<string, unknown> | null;
    nowIso: string;
  }): Promise<void>;

  listReviewAudit(gameId: number, limit: number): Promise<SandboxGameReviewAuditEntry[]>;

  /** True when D1's durable reservation authority owns this slug. Approval creates the
   * reservation atomically at the database boundary; review rows and audit entries may later be
   * removed without making the public identity reusable. */
  isSlugPermanentlyReserved(slug: string): Promise<boolean>;
}

/**
 * Storage port for bytes — Backblaze B2 (S3-compatible API) in production, a fake/in-memory
 * implementation in tests (see packages/core/test/sandboxGameUseCases.test.ts). Deliberately
 * provider-neutral: nothing above `packages/db/src/storage/` may know which object-storage vendor
 * is behind it. That's what let this project swap R2 → Backblaze B2 (2026-08-16, cost-control
 * decision — see docs/GAME_CREATION_GUIDE.md §3.2) by touching only the adapter. Deliberately
 * separate from SandboxGameRepository: one is D1 metadata, the other is blob storage, and they have
 * very different failure modes.
 *
 * Purely key-addressed on purpose. Key *layout* is a domain decision (see
 * domain/sandboxGameBundle.ts) that must stay identical across providers, so no adapter is allowed
 * to invent keys — which is also why there is one small interface here rather than separate
 * source-archive and published-object repositories. Delete is expressed one key at a time and
 * driven by a version's manifest, so nothing here needs a provider-specific list/prefix operation.
 */
export interface GameBundleStorageRepository {
  putObject(input: {
    key: string;
    bytes: ArrayBuffer | Uint8Array;
    contentType: string;
    /** Stored so a re-served object keeps a transport encoding the filename implied (Unity's
     * Brotli builds) — see resolveBundleContentType. */
    contentEncoding?: string | undefined;
  }): Promise<void>;
  /** Returns null when the key doesn't exist — a plain not-found is never an exception, since
   * callers routinely treat "absent" as an ordinary 404 rather than an error. */
  getObject(key: string): Promise<ArrayBuffer | null>;
  deleteObject(key: string): Promise<void>;
}

/**
 * Reads a zip archive. A port rather than a direct dependency so `@owogg/core` stays free of
 * runtime libraries (its only dependency is another workspace package); the fflate implementation
 * lives with the other infrastructure adapters in apps/api.
 *
 * Synchronous and whole-archive by design: this only ever runs at publish time on a bundle already
 * capped at MAX_BUNDLE_BYTES, never on the request path for a player.
 */
export interface BundleArchiveReader {
  /**
   * Cheap, decompression-free pass over the archive's central directory: entry names and their
   * *declared* compressed/uncompressed sizes only, no entry's content bytes are produced. This
   * exists so `GamePublicationService.prepare` can reject an oversized/invalid archive
   * (path/count/declared-size/compression-ratio checks — see domain/sandboxGameBundle.ts's
   * `validateBundleEntryMetadata`) before paying for full decompression: a 20MiB upload can still
   * declare (or genuinely contain) hundreds of megabytes once decompressed, and that must be
   * caught without ever allocating those hundreds of megabytes. `compressedSize` is what makes the
   * compression-ratio check possible — a declared uncompressed size wildly disproportionate to
   * what that many compressed bytes could plausibly produce is rejected outright, independent of
   * the flat total-size cap. Throws on a malformed/unreadable archive.
   */
  readMetadata(
    archive: ArrayBuffer,
  ): Array<{ path: string; declaredSize: number; compressedSize: number }>;
  /** Full decompression. Only ever called after readMetadata has already validated the archive —
   * see GamePublicationService.prepare. Throws on a malformed/unreadable archive; the publisher
   * converts that into BUNDLE_MALFORMED. */
  read(archive: ArrayBuffer): Record<string, Uint8Array>;
}
