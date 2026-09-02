import type {
  SandboxGameRepository,
  SandboxGameRecord,
  SandboxGameVersionRecord,
  SandboxGameReviewAuditEntry,
  SandboxGameMetadataInput,
  SandboxGameBasicMetadataInput,
  GameContentUpdateInput,
  SandboxGamePendingVersionsPage,
  GameBundleStorageRepository,
  BundleArchiveWriter,
} from "../ports/sandboxGames.js";
import type { GameCanonicalRepository } from "../modules/game/ports/gameCanonicalRepository.js";
import { EMPTY_GAME_VERIFIER_REGISTRY, type GameVerifierCatalog } from "../ports/gameVerifier.js";
import type { MultiplayerProfileRequestRepository } from "../modules/multiplayer/ports/multiplayerProfileRequestRepository.js";
import type { GameCanonicalDocument } from "../modules/game/domain/gameCanonicalDocument.js";
import type { SandboxGameVisibility, SandboxGameMode } from "../domain/sandboxGames.js";
import {
  SANDBOX_GAME_POLICY,
  isValidSandboxGameSlug,
  canSetVisibilityPublic,
  isPublishedVersion,
} from "../domain/sandboxGames.js";
import {
  sourceArchiveObjectKey,
  findGameLogoFile,
  sandboxGameLogoObjectKey,
  revisedGameLogoObjectKey,
  standaloneGameLogoPath,
  resolveBundleContentType,
  SANDBOX_BUNDLE_REJECTIONS,
  SandboxBundleRejectionError,
  type SandboxBundleRejection,
  type PreparedBundle,
  type PreparedBundleFile,
} from "../domain/sandboxGameBundle.js";
import {
  GameCreatorManifestValidationError,
  defaultGameDescription,
  extractGameCreatorManifest,
  GAME_DESCRIPTION_LOCALE_FILES,
  gameDescriptionFilePaths,
  gameDescriptionImagePaths,
  getMultiplayerRuntimeProfileRequestV1,
  parseGameCreatorManifestBytes,
} from "../domain/gameCreatorManifest.js";
import { resolveMultiplayerRuntimeProfileRequestV1 } from "../modules/multiplayer/domain/multiplayerProfileRequest.js";
import { mapGameCreatorManifestToCanonical } from "../domain/gameCreatorManifestCanonical.js";
import { sha256Hex } from "../domain/contentHash.js";
import {
  computeUserCanonicalScorePatch,
  mapUserGameRecordToCanonical,
  patchUserGameCanonical,
} from "../domain/userGameCanonical.js";
import { jsonDeepEqual } from "./jsonDeepEqual.js";
import type { GamePublicationService } from "./gamePublicationService.js";
import {
  buildGameDescriptionRevision,
  patchGameCreatorManifestBasicMetadata,
  rebuildGameBundleArchive,
  serializeGameCreatorManifest,
} from "./gameBundleRevision.js";

export type SandboxGameUseCaseError =
  | "GAME_NOT_FOUND"
  | "VERSION_NOT_FOUND"
  | "VERSION_NOT_DRAFT"
  | "SLUG_TAKEN"
  | "INVALID_SLUG"
  | "INVALID_TITLE"
  | "NOT_OWNER"
  | "BUNDLE_TOO_LARGE"
  | "BUNDLE_EMPTY"
  | "ALREADY_DECIDED"
  | "REASON_REQUIRED"
  | "NO_APPROVED_VERSION"
  /** A version whose files aren't fully published cannot be approved, made live, or served from
   * its immutable path — see GamePublicationService. */
  | "VERSION_NOT_PUBLISHED"
  | "VERSION_NOT_APPROVED"
  | "PUBLISH_FAILED"
  /** A non-admin creator already changed description content/tags within the last 24 hours. */
  | "CONTENT_EDIT_COOLDOWN"
  /** The developer already has MAX_CONCURRENT_REVIEW_SLOTS games awaiting their first review
   * decision — checked atomically when an exact draft is submitted. */
  | "SUBMISSION_LIMIT_REACHED"
  /** Another version of the same game is already waiting for an admin decision. */
  | "PENDING_REVIEW_EXISTS"
  /** withdrawSubmission was called on a game with no open slot and no pending version — there is
   * nothing left to withdraw. */
  | "NOTHING_TO_WITHDRAW"
  /** The zip has no root-level owogg.json. New registrations and every later version require it. */
  | "MANIFEST_MISSING"
  /** owogg.json is malformed, violates v1, or a new version changes its immutable game slug. */
  | "MANIFEST_INVALID"
  /** The manifest requests PlayConfig verification but the server has no reviewed implementation
   * registered under that stable verifier ID. No storage or catalog mutation may happen. */
  | "VERIFIER_NOT_REGISTERED"
  /** The requested online runtime is recognized by manifest v1 but is not deployable yet. */
  | "MULTIPLAYER_RUNTIME_NOT_AVAILABLE"
  /** Relay was requested with a feature the current lifecycle contract cannot honor. */
  | "MULTIPLAYER_CAPABILITY_NOT_AVAILABLE"
  /** Kept as route-level validation codes for metadata edit APIs. Game Creator ZIP validation reports
   * MANIFEST_INVALID so callers get one stable manifest error contract. */
  | "INVALID_GENRE"
  /** Metadata edit API compatibility code; ZIP mode validation reports MANIFEST_INVALID. */
  | "INVALID_MODE"
  /** createGameFromBundle: no owogg.logo.{png,jpg,jpeg,webp,svg} at the bundle root (2026-08-18,
   * required on every registration going forward) — distinct from MANIFEST_MISSING, since the
   * manifest itself can be present and perfectly valid while the logo is simply absent. */
  | "LOGO_REQUIRED"
  /** createGameFromBundle: the logo file exists but exceeds SANDBOX_GAME_POLICY.MAX_LOGO_BYTES
   * once decompressed. */
  | "LOGO_TOO_LARGE"
  /** A standalone logo upload has no supported png/jpg/jpeg/webp/svg extension or is empty. */
  | "LOGO_INVALID"
  /** deleteGame was called on a game that's already soft-deleted — idempotent-failure rather than
   * a silent no-op, so a double-click doesn't look like it succeeded twice. */
  | "ALREADY_DELETED"
  /** deleteOwnGame (Game Creator self-service) was called on a game with at least one ever-APPROVED
   * version — self-delete is only for a game that has never been reviewed/approved; past that
   * point only ADMIN/OPERATOR (sandbox_games.delete) may remove it. */
  | "CANNOT_DELETE_APPROVED_GAME"
  /** purgeGame may only erase never-approved draft/test data. Once a version has ever been
   * approved, a non-cascading D1 reservation becomes the permanent slug tombstone so historical
   * score/XP/favorite data can never attach to a different game under the same slug. */
  | "CANNOT_PURGE_APPROVED_GAME"
  /** revokeApproval was called on a version that isn't currently APPROVED — there is no approval
   * decision left to undo (it's still pending, was rejected, or was already revoked). */
  | "REVOKE_REQUIRES_APPROVED"
  /** purgeGame was called on a game that hasn't been soft-deleted yet — purge only ever follows
   * deleteGame, never replaces it, so there is nothing to permanently erase yet. */
  | "NOT_YET_DELETED"
  /** The patch would leave an already-configured canonical score policy incomplete. */
  | "SCORE_POLICY_WOULD_BECOME_INCOMPLETE"
  /** The generic canonical is currently `score: null` (deliberately
   * unscored) and the patch touches a score field, but doesn't supply all four required fields as
   * explicit, non-null values in this same request — activating a score policy is never inferred
   * from D1's own possibly-stale leftover score_* columns. */
  | "AMBIGUOUS_SCORE_POLICY_ACTIVATION"
  /** Keeping the generic canonical document in sync with D1 failed. Covers
   * three distinct moments, not just one: the initial pre-read (before D1 is ever touched — D1
   * is NOT updated in this case), a save failure, or a post-write parity mismatch (both of which
   * happen after D1 has already been updated and audited). There is no cross-store transaction
   * between D1 and B2 (see sandboxGameUseCases.ts's own doc comment on updateMetadata) — the
   * caller must treat this as a real failure (never a success) regardless of which moment it came
   * from, and may safely retry the exact same request, since the whole operation is idempotent. */
  | "CANONICAL_SYNC_FAILED"
  | SandboxBundleRejection;

export class SandboxGameUseCaseFailure extends Error {
  constructor(
    public readonly code: SandboxGameUseCaseError,
    public readonly availableAt?: string | undefined,
  ) {
    super(code);
  }
}

const CREATOR_CONTENT_EDIT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function creatorManagedContentChanged(
  previousManifest: NonNullable<ReturnType<typeof extractGameCreatorManifest>>,
  previousFiles: readonly PreparedBundleFile[],
  nextManifest: NonNullable<ReturnType<typeof extractGameCreatorManifest>>,
  nextFiles: readonly PreparedBundleFile[],
): boolean {
  if (
    previousManifest.game.title !== nextManifest.game.title ||
    (previousManifest.game.shortDescription ?? "") !== (nextManifest.game.shortDescription ?? "") ||
    JSON.stringify(previousManifest.game.localizations ?? {}) !==
      JSON.stringify(nextManifest.game.localizations ?? {})
  ) {
    return true;
  }
  if (
    JSON.stringify(previousManifest.game.tags ?? []) !==
    JSON.stringify(nextManifest.game.tags ?? [])
  ) {
    return true;
  }
  if (
    JSON.stringify(previousManifest.game.description ?? null) !==
      JSON.stringify(nextManifest.game.description ?? null) ||
    JSON.stringify(previousManifest.game.description_images ?? []) !==
      JSON.stringify(nextManifest.game.description_images ?? [])
  ) {
    return true;
  }
  const managedPaths = new Set([
    ...gameDescriptionFilePaths(previousManifest),
    ...gameDescriptionImagePaths(previousManifest),
    ...gameDescriptionFilePaths(nextManifest),
    ...gameDescriptionImagePaths(nextManifest),
  ]);
  const previousByPath = new Map(previousFiles.map((file) => [file.path, file.bytes]));
  const nextByPath = new Map(nextFiles.map((file) => [file.path, file.bytes]));
  for (const path of managedPaths) {
    const before = previousByPath.get(path);
    const after = nextByPath.get(path);
    if (!before || !after || !bytesEqual(before, after)) return true;
  }
  return false;
}

/** Bundle rejections are raised deep in the pure domain layer (which has no reason to know about
 * this class), so they are translated here into the single failure type the route layer maps. */
function asFailure(err: unknown): never {
  if (err instanceof SandboxBundleRejectionError) {
    throw new SandboxGameUseCaseFailure(err.code);
  }
  throw err;
}

function manifestFailure(err: unknown): never {
  if (err instanceof GameCreatorManifestValidationError) {
    throw new SandboxGameUseCaseFailure("MANIFEST_INVALID");
  }
  throw err;
}

function isBundleRejectionCode(code: SandboxGameUseCaseError): boolean {
  return (SANDBOX_BUNDLE_REJECTIONS as readonly string[]).includes(code);
}

function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (
    trimmed.length < SANDBOX_GAME_POLICY.MIN_TITLE_LENGTH ||
    trimmed.length > SANDBOX_GAME_POLICY.MAX_TITLE_LENGTH
  ) {
    throw new SandboxGameUseCaseFailure("INVALID_TITLE");
  }
  return trimmed;
}

/**
 * Orchestrates the sandbox game catalog: developer-facing create/upload, admin-facing review
 * (approve/reject a version) and publish (visibility toggle) + metadata adjustment. Ownership and
 * admin-eligibility gating happen at the route layer (matching how admin eligibility is checked
 * in apps/api/src/auth/, not in core use cases elsewhere in this codebase) — this layer enforces
 * the domain invariants: title/slug validity, one-time slug uniqueness, bundle size limits,
 * "a version decision is final", "visibility can only go PUBLIC once a version is APPROVED", and
 * "only a fully-published version may be served or promoted".
 */
export class SandboxGameUseCases {
  constructor(
    private repo: SandboxGameRepository,
    private storage: GameBundleStorageRepository,
    private publisher: GamePublicationService,
    /** The sole canonical control-plane authority for USER metadata. */
    private gameCanonicalRepo: GameCanonicalRepository,
    private archiveWriter?: BundleArchiveWriter,
    private multiplayerProfileRequests?: MultiplayerProfileRequestRepository,
    private gameVerifierCatalog: GameVerifierCatalog = EMPTY_GAME_VERIFIER_REGISTRY,
  ) {}

  private assertSupportedManifestFeatures(
    manifest: NonNullable<ReturnType<typeof extractGameCreatorManifest>>,
  ): void {
    const verifierId = manifest.playConfig?.verifierId;
    if (verifierId !== undefined && !this.gameVerifierCatalog.has(verifierId)) {
      throw new SandboxGameUseCaseFailure("VERIFIER_NOT_REGISTERED");
    }
    const request = getMultiplayerRuntimeProfileRequestV1(manifest);
    if (!request) return;
    const resolution = resolveMultiplayerRuntimeProfileRequestV1(request);
    if (resolution.status === "RUNTIME_NOT_AVAILABLE") {
      throw new SandboxGameUseCaseFailure("MULTIPLAYER_RUNTIME_NOT_AVAILABLE");
    }
    if (resolution.status === "CAPABILITY_NOT_AVAILABLE") {
      throw new SandboxGameUseCaseFailure("MULTIPLAYER_CAPABILITY_NOT_AVAILABLE");
    }
  }

  private async submitDeclaredMultiplayerRequest(input: {
    manifest: NonNullable<ReturnType<typeof extractGameCreatorManifest>>;
    gameId: number;
    gameVersionId: number;
    contentHash: string;
    requestedByUserId: number;
  }): Promise<void> {
    const request = getMultiplayerRuntimeProfileRequestV1(input.manifest);
    if (!request) return;
    if (!this.multiplayerProfileRequests) {
      throw new SandboxGameUseCaseFailure("PUBLISH_FAILED");
    }
    try {
      const submitted = await this.multiplayerProfileRequests.submit({
        gameId: input.gameId,
        gameVersionId: input.gameVersionId,
        contentHash: input.contentHash,
        requestedByUserId: input.requestedByUserId,
        request,
        nowIso: new Date().toISOString(),
      });
      if (submitted.status === "REJECTED") {
        console.error(
          `multiplayer profile request rejected for gameId=${input.gameId} versionId=${input.gameVersionId}: ${submitted.code}`,
        );
        throw new SandboxGameUseCaseFailure("PUBLISH_FAILED");
      }
    } catch (error) {
      if (error instanceof SandboxGameUseCaseFailure) throw error;
      console.error(
        `multiplayer profile request failed for gameId=${input.gameId} versionId=${input.gameVersionId}:`,
        error instanceof Error ? error.message : error,
      );
      throw new SandboxGameUseCaseFailure("PUBLISH_FAILED");
    }
  }

  async getById(id: number): Promise<SandboxGameRecord | null> {
    return this.repo.findById(id);
  }

  async listMine(developerUserId: number): Promise<SandboxGameRecord[]> {
    return this.repo.listByDeveloper(developerUserId);
  }

  /** Every game, including soft-deleted ones, admin-facing — unlike listMine (one developer),
   * this is "everything an ADMIN/OPERATOR should be able to browse" so
   * the admin UI doesn't need to know a game's id ahead of time (see
   * docs/GAME_CREATION_GUIDE.md §3.6.4). Deliberately includes deleted games (2026-08-18 fix) —
   * purgeGame only reaches an already-deleted game, and this list was the one place an admin was
   * supposed to be able to find one without already knowing its id; excluding them defeated that
   * and made purge practically undiscoverable. The web UI disables the visibility toggle and
   * shows a "삭제됨" badge for these rows instead (setVisibility itself also refuses them, as a
   * second guard against reviving a deleted game's visibility from a stray request). */
  async listAll(): Promise<SandboxGameRecord[]> {
    return this.repo.listAll();
  }

  async listAllPage(limit: number, offset: number) {
    return this.repo.listAllPage(limit, offset);
  }

  async listVersions(gameId: number): Promise<SandboxGameVersionRecord[]> {
    return this.repo.listVersionsByGame(gameId);
  }

  async listDrafts(developerUserId: number): Promise<SandboxGameVersionRecord[]> {
    return this.repo.listDraftVersionsByDeveloper(developerUserId);
  }

  /** Resolves the exact immutable draft a creator is about to run. The route signs the returned
   * identity into a short-lived capability only after these ownership and publish checks pass. */
  async getDraftForPreview(input: {
    gameId: number;
    versionId: number;
    actingUserId: number;
  }): Promise<SandboxGameVersionRecord> {
    const game = await this.repo.findById(input.gameId);
    if (!game) throw new SandboxGameUseCaseFailure("GAME_NOT_FOUND");
    if (game.developerUserId !== input.actingUserId) {
      throw new SandboxGameUseCaseFailure("NOT_OWNER");
    }
    if (game.deletedAt !== null) throw new SandboxGameUseCaseFailure("ALREADY_DELETED");

    const version = await this.repo.findVersionById(input.versionId);
    if (!version || version.gameId !== game.id) {
      throw new SandboxGameUseCaseFailure("VERSION_NOT_FOUND");
    }
    if (version.status !== "DRAFT") throw new SandboxGameUseCaseFailure("VERSION_NOT_DRAFT");
    if (!isPublishedVersion(version.publishStatus)) {
      throw new SandboxGameUseCaseFailure("VERSION_NOT_PUBLISHED");
    }
    return version;
  }

  async listPendingReview(limit: number, offset: number): Promise<SandboxGamePendingVersionsPage> {
    return this.repo.listPendingVersions(limit, offset);
  }

  async getReviewAudit(gameId: number, limit = 50): Promise<SandboxGameReviewAuditEntry[]> {
    return this.repo.listReviewAudit(gameId, limit);
  }

  async createGame(input: {
    slug: string;
    developerUserId: number;
    title: string;
    shortDescription: string | null;
    description: string | null;
    genre: string;
    mode: SandboxGameMode;
    tags?: readonly string[] | undefined;
    defaultScreenMode?: "default" | "theater" | undefined;
  }): Promise<SandboxGameRecord> {
    const slug = input.slug.trim().toLowerCase();
    if (!isValidSandboxGameSlug(slug)) throw new SandboxGameUseCaseFailure("INVALID_SLUG");
    const title = validateTitle(input.title);

    // slugExists is the global D1 identity authority: it includes active/soft-deleted generic game
    // identities and permanent reservations, regardless of publisher. Never consult a static
    // registry here; a Game Creator slug must be checked against the same namespace every runtime read
    // uses.
    if (await this.repo.slugExists(slug)) throw new SandboxGameUseCaseFailure("SLUG_TAKEN");

    // Registration creates a private identity only. The review slot is claimed later, together
    // with the explicit DRAFT -> PENDING_REVIEW transition in submitDraftForReview().
    return this.repo.create({
      slug,
      developerUserId: input.developerUserId,
      title,
      shortDescription: input.shortDescription,
      description: input.description,
      genre: input.genre.trim(),
      mode: input.mode,
      tags: input.tags ?? [],
      defaultScreenMode: input.defaultScreenMode ?? "default",
      nowIso: new Date().toISOString(),
    });
  }

  /** Moves one exact, privately previewable draft into the admin queue. Upload and B2 publication
   * deliberately happen earlier; this operation is a small D1 workflow transition only. */
  async submitDraftForReview(input: {
    gameId: number;
    versionId: number;
    actingUserId: number;
  }): Promise<{ game: SandboxGameRecord; version: SandboxGameVersionRecord }> {
    const game = await this.repo.findById(input.gameId);
    if (!game) throw new SandboxGameUseCaseFailure("GAME_NOT_FOUND");
    if (game.developerUserId !== input.actingUserId) {
      throw new SandboxGameUseCaseFailure("NOT_OWNER");
    }
    if (game.deletedAt !== null) throw new SandboxGameUseCaseFailure("ALREADY_DELETED");

    const version = await this.repo.findVersionById(input.versionId);
    if (!version || version.gameId !== game.id) {
      throw new SandboxGameUseCaseFailure("VERSION_NOT_FOUND");
    }
    if (version.status !== "DRAFT") throw new SandboxGameUseCaseFailure("VERSION_NOT_DRAFT");
    if (!isPublishedVersion(version.publishStatus)) {
      throw new SandboxGameUseCaseFailure("VERSION_NOT_PUBLISHED");
    }

    const versions = await this.repo.listVersionsByGame(game.id);
    if (versions.some((candidate) => candidate.status === "PENDING_REVIEW")) {
      throw new SandboxGameUseCaseFailure("PENDING_REVIEW_EXISTS");
    }
    // Preserve the existing first-review quota semantics. A game that has already reached any
    // terminal review state does not reclaim an initial-submission slot on later versions.
    const claimReviewSlot = versions.every((candidate) => candidate.status === "DRAFT");
    const nowIso = new Date().toISOString();
    const submitted = await this.repo.submitDraftVersion({
      gameId: game.id,
      versionId: version.id,
      developerUserId: game.developerUserId,
      claimReviewSlot,
      nowIso,
    });
    if (!submitted) {
      const refreshed = await this.repo.listVersionsByGame(game.id);
      if (refreshed.some((candidate) => candidate.status === "PENDING_REVIEW")) {
        throw new SandboxGameUseCaseFailure("PENDING_REVIEW_EXISTS");
      }
      throw new SandboxGameUseCaseFailure("SUBMISSION_LIMIT_REACHED");
    }

    await this.repo.withdrawOtherDraftVersions(game.id, submitted.id);
    await this.repo.appendReviewAudit({
      gameId: game.id,
      versionId: submitted.id,
      actorAdminId: input.actingUserId,
      action: "VERSION_SUBMITTED",
      reason: null,
      metadata: null,
      nowIso,
    });
    const updatedGame = await this.repo.findById(game.id);
    if (!updatedGame) throw new SandboxGameUseCaseFailure("GAME_NOT_FOUND");
    return { game: updatedGame, version: submitted };
  }

  /**
   * Uploads a new bundle version for an existing game. `actingUserId`/`isAdmin` decide
   * ownership: the game's own developer, or any admin (e.g. uploading on a developer's behalf —
   * see docs/GAME_CREATION_GUIDE.md §3.6's "최후 수단"), may upload. Every creator upload starts
   * as a private DRAFT; the exact published files move to PENDING_REVIEW only after an explicit
   * preview confirmation. A previously-approved version keeps serving while a draft is prepared.
   *
   * Order matters and is deliberate:
   *   1. size limits, then full archive validation — all on the in-memory upload, so an invalid
   *      bundle costs zero storage writes and creates zero rows;
   *   2. store the source archive;
   *   3. insert the version row (best-effort source cleanup if that fails);
   *   4. publish the individual objects.
   *
   * Publishing happens here rather than at approval time so that reviewers can actually play the
   * exact build they're reviewing, and so approving is a cheap metadata flip rather than a
   * long-running storage operation.
   */
  async uploadVersion(input: {
    gameId: number;
    actingUserId: number;
    isAdmin: boolean;
    bytes: ArrayBuffer;
    contentType?: string | undefined;
  }): Promise<SandboxGameVersionRecord> {
    const game = await this.repo.findById(input.gameId);
    if (!game) throw new SandboxGameUseCaseFailure("GAME_NOT_FOUND");
    if (!input.isAdmin && game.developerUserId !== input.actingUserId) {
      throw new SandboxGameUseCaseFailure("NOT_OWNER");
    }
    if (input.bytes.byteLength === 0) throw new SandboxGameUseCaseFailure("BUNDLE_EMPTY");
    if (input.bytes.byteLength > SANDBOX_GAME_POLICY.MAX_BUNDLE_BYTES) {
      throw new SandboxGameUseCaseFailure("BUNDLE_TOO_LARGE");
    }

    const prepared = (() => {
      try {
        return this.publisher.prepare(input.bytes);
      } catch (err) {
        return asFailure(err);
      }
    })();

    const manifest = (() => {
      try {
        return extractGameCreatorManifest(prepared.files);
      } catch (err) {
        return manifestFailure(err);
      }
    })();
    if (!manifest) throw new SandboxGameUseCaseFailure("MANIFEST_MISSING");
    if (manifest.game.slug !== game.slug) {
      throw new SandboxGameUseCaseFailure("MANIFEST_INVALID");
    }
    this.assertSupportedManifestFeatures(manifest);

    const logoFile = findGameLogoFile(prepared.files);
    if (logoFile && logoFile.bytes.byteLength > SANDBOX_GAME_POLICY.MAX_LOGO_BYTES) {
      throw new SandboxGameUseCaseFailure("LOGO_TOO_LARGE");
    }
    const publishablePrepared = logoFile
      ? {
          ...prepared,
          files: prepared.files.filter((file) => file.path !== logoFile.path),
          totalSize: prepared.totalSize - logoFile.bytes.byteLength,
        }
      : prepared;

    let claimedAt: string | null = null;
    if (!input.isAdmin) {
      let previous: Awaited<ReturnType<SandboxGameUseCases["revisionBase"]>> | null = null;
      try {
        previous = await this.revisionBase(game);
      } catch (error) {
        if (!(error instanceof SandboxGameUseCaseFailure) || error.code !== "VERSION_NOT_FOUND") {
          throw error;
        }
      }
      if (
        previous &&
        creatorManagedContentChanged(
          previous.manifest,
          previous.prepared.files,
          manifest,
          publishablePrepared.files,
        )
      ) {
        claimedAt = new Date().toISOString();
        const cutoffIso = new Date(
          Date.parse(claimedAt) - CREATOR_CONTENT_EDIT_COOLDOWN_MS,
        ).toISOString();
        const claim = await this.repo.claimContentEdit({
          gameId: game.id,
          userId: input.actingUserId,
          nowIso: claimedAt,
          cutoffIso,
        });
        if (!claim.claimed) {
          throw new SandboxGameUseCaseFailure(
            "CONTENT_EDIT_COOLDOWN",
            claim.availableAt ?? undefined,
          );
        }
      }
    }

    try {
      return await this.uploadPreparedVersion({
        gameId: game.id,
        requestedByUserId: game.developerUserId,
        bytes: input.bytes,
        contentType: input.contentType,
        prepared: publishablePrepared,
        manifest,
        reviewStatus: input.isAdmin ? "PENDING_REVIEW" : "DRAFT",
        ...(logoFile ? { logoFile } : {}),
      });
    } catch (error) {
      if (claimedAt) {
        await this.repo
          .releaseContentEditClaim({
            gameId: game.id,
            userId: input.actingUserId,
            claimedAt,
          })
          .catch(() => {});
      }
      throw error;
    }
  }

  private async revisionBase(game: SandboxGameRecord): Promise<{
    prepared: PreparedBundle;
    manifest: NonNullable<ReturnType<typeof extractGameCreatorManifest>>;
  }> {
    const versions = (await this.repo.listVersionsByGame(game.id)).sort(
      (left, right) => right.uploadedAt.localeCompare(left.uploadedAt) || right.id - left.id,
    );
    for (const version of versions) {
      const source = await this.storage.getObject(version.objectKey);
      if (!source) continue;
      try {
        const prepared = this.publisher.prepare(source);
        const manifest = extractGameCreatorManifest(prepared.files);
        if (manifest?.game.slug === game.slug) return { prepared, manifest };
      } catch {
        // Try an older source archive. A single missing/corrupt draft must not make an otherwise
        // healthy game impossible to repair through the partial-update flow.
      }
    }
    throw new SandboxGameUseCaseFailure("VERSION_NOT_FOUND");
  }

  private async assertRevisionAccess(input: {
    gameId: number;
    actingUserId: number;
    isAdmin: boolean;
  }): Promise<SandboxGameRecord> {
    const game = await this.repo.findById(input.gameId);
    if (!game) throw new SandboxGameUseCaseFailure("GAME_NOT_FOUND");
    if (game.deletedAt !== null) throw new SandboxGameUseCaseFailure("ALREADY_DELETED");
    if (!input.isAdmin && game.developerUserId !== input.actingUserId) {
      throw new SandboxGameUseCaseFailure("NOT_OWNER");
    }
    return game;
  }

  /** Replaces only `owogg.json` by rebuilding the selected source ZIP and submitting the result as
   * a normal new version. Existing immutable objects are never overwritten; USER versions retain
   * the normal PENDING_REVIEW lifecycle. */
  async replaceManifest(input: {
    gameId: number;
    actingUserId: number;
    isAdmin: boolean;
    bytes: ArrayBuffer;
  }): Promise<SandboxGameVersionRecord> {
    if (!this.archiveWriter) throw new SandboxGameUseCaseFailure("PUBLISH_FAILED");
    if (
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > SANDBOX_GAME_POLICY.MAX_MANIFEST_BYTES
    ) {
      throw new SandboxGameUseCaseFailure("MANIFEST_INVALID");
    }
    const game = await this.assertRevisionAccess(input);
    let manifest: ReturnType<typeof parseGameCreatorManifestBytes>;
    try {
      manifest = parseGameCreatorManifestBytes(input.bytes);
    } catch (error) {
      return manifestFailure(error);
    }
    if (manifest.game.slug !== game.slug) {
      throw new SandboxGameUseCaseFailure("MANIFEST_INVALID");
    }
    const base = await this.revisionBase(game);
    const archive = rebuildGameBundleArchive({
      prepared: base.prepared,
      writer: this.archiveWriter,
      manifestBytes: serializeGameCreatorManifest(manifest),
      // A logo is game-level state. Omitting it from this synthetic version keeps the currently
      // selected logo untouched and prevents an old source ZIP from resurrecting stale artwork.
      currentLogo: null,
    });
    return this.uploadVersion({ ...input, bytes: archive, contentType: "application/zip" });
  }

  /** Turns a small form edit into the same immutable manifest-revision flow as replaceManifest. */
  async updateBasicMetadataAsVersion(input: {
    gameId: number;
    actingUserId: number;
    isAdmin: boolean;
    metadata: SandboxGameBasicMetadataInput;
  }): Promise<SandboxGameVersionRecord> {
    const game = await this.assertRevisionAccess(input);
    const base = await this.revisionBase(game);
    let manifest: typeof base.manifest;
    try {
      // The canonical document describes the approved/live projection and can legitimately lag a
      // newer PENDING_REVIEW source ZIP. Basing this edit on it would silently resurrect old tags
      // or description declarations. Partial creator/admin edits always preserve the newest
      // immutable source version instead; review will canonicalize the resulting version again.
      manifest = patchGameCreatorManifestBasicMetadata(base.manifest, input.metadata);
    } catch (error) {
      return manifestFailure(error);
    }
    return this.replaceManifest({
      gameId: game.id,
      actingUserId: input.actingUserId,
      isAdmin: input.isAdmin,
      bytes: serializeGameCreatorManifest(manifest).buffer as ArrayBuffer,
    });
  }

  /** Saves localized title/summary, global tags, and an optional localized Markdown document as
   * one immutable version. This is deliberately atomic: a non-admin creator changing both tags
   * and Markdown consumes one 24-hour content-edit slot, never two sequential requests. */
  async updateContentAsVersion(input: {
    gameId: number;
    actingUserId: number;
    isAdmin: boolean;
    content: GameContentUpdateInput;
  }): Promise<SandboxGameVersionRecord> {
    if (!this.archiveWriter) throw new SandboxGameUseCaseFailure("PUBLISH_FAILED");
    const game = await this.assertRevisionAccess(input);
    const base = await this.revisionBase(game);
    try {
      let manifest = patchGameCreatorManifestBasicMetadata(base.manifest, {
        locale: input.content.locale,
        title: input.content.title,
        shortDescription: input.content.shortDescription,
        tags: input.content.tags,
      });
      let replacementFiles: readonly PreparedBundleFile[] = [];
      let removePaths: readonly string[] = [];
      if (input.content.descriptionMarkdown !== undefined) {
        const path = GAME_DESCRIPTION_LOCALE_FILES[input.content.locale];
        const { contentType, contentEncoding } = resolveBundleContentType(path);
        const revision = buildGameDescriptionRevision({
          manifest,
          packageFiles: [
            {
              path,
              bytes: new TextEncoder().encode(input.content.descriptionMarkdown),
              contentType,
              contentEncoding,
            },
          ],
          replaceAll: false,
        });
        manifest = revision.manifest;
        replacementFiles = revision.replacementFiles;
        removePaths = revision.removePaths;
      }
      const archive = rebuildGameBundleArchive({
        prepared: base.prepared,
        writer: this.archiveWriter,
        manifestBytes: serializeGameCreatorManifest(manifest),
        currentLogo: null,
        replacementFiles,
        removePaths,
      });
      return await this.uploadVersion({
        gameId: game.id,
        actingUserId: input.actingUserId,
        isAdmin: input.isAdmin,
        bytes: archive,
        contentType: "application/zip",
      });
    } catch (error) {
      if (error instanceof SandboxGameUseCaseFailure) throw error;
      if (error instanceof GameCreatorManifestValidationError) return manifestFailure(error);
      throw new SandboxGameUseCaseFailure("MANIFEST_INVALID");
    }
  }

  /** Creator/admin partial description submission. USER publications remain reviewable immutable
   * versions; authorization is checked against the server-owned publisher user id. */
  async replaceDescriptionPackage(input: {
    gameId: number;
    actingUserId: number;
    isAdmin: boolean;
    fileName: string;
    bytes: ArrayBuffer;
  }): Promise<SandboxGameVersionRecord> {
    if (!this.archiveWriter) throw new SandboxGameUseCaseFailure("PUBLISH_FAILED");
    if (
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > SANDBOX_GAME_POLICY.MAX_BUNDLE_BYTES
    ) {
      throw new SandboxGameUseCaseFailure("BUNDLE_TOO_LARGE");
    }
    const game = await this.assertRevisionAccess(input);
    const base = await this.revisionBase(game);
    const replaceAll = input.fileName.toLowerCase().endsWith(".zip");
    try {
      const packageFiles = replaceAll
        ? this.publisher.prepareArchiveFiles(input.bytes).files
        : [
            (() => {
              const path = input.fileName.replace(/\\/g, "/").split("/").at(-1) ?? "";
              const { contentType, contentEncoding } = resolveBundleContentType(path);
              return {
                path,
                bytes: new Uint8Array(input.bytes),
                contentType,
                contentEncoding,
              };
            })(),
          ];
      const revision = buildGameDescriptionRevision({
        manifest: base.manifest,
        packageFiles,
        replaceAll,
      });
      const archive = rebuildGameBundleArchive({
        prepared: base.prepared,
        writer: this.archiveWriter,
        manifestBytes: serializeGameCreatorManifest(revision.manifest),
        currentLogo: null,
        removePaths: revision.removePaths,
        replacementFiles: revision.replacementFiles,
      });
      return await this.uploadVersion({ ...input, bytes: archive, contentType: "application/zip" });
    } catch (error) {
      if (error instanceof SandboxGameUseCaseFailure) throw error;
      return manifestFailure(error);
    }
  }

  /** Replaces only the game-level logo. A content-addressed object is written before D1 switches
   * to it; the previous object is then removed best-effort, so a failed D1 write cannot destroy the
   * currently visible logo. */
  async replaceLogo(input: {
    gameId: number;
    actingUserId: number;
    isAdmin: boolean;
    fileName: string;
    bytes: ArrayBuffer;
  }): Promise<SandboxGameRecord> {
    const game = await this.assertRevisionAccess(input);
    const logoPath = standaloneGameLogoPath(input.fileName);
    if (
      !logoPath ||
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > SANDBOX_GAME_POLICY.MAX_LOGO_BYTES
    ) {
      throw new SandboxGameUseCaseFailure(
        input.bytes.byteLength > SANDBOX_GAME_POLICY.MAX_LOGO_BYTES
          ? "LOGO_TOO_LARGE"
          : "LOGO_INVALID",
      );
    }
    const contentHash = await sha256Hex(input.bytes);
    const nextKey = revisedGameLogoObjectKey(game.id, logoPath, contentHash);
    const { contentType } = resolveBundleContentType(logoPath);
    const nowIso = new Date().toISOString();
    try {
      await this.storage.putObject({ key: nextKey, bytes: input.bytes, contentType });
    } catch {
      throw new SandboxGameUseCaseFailure("PUBLISH_FAILED");
    }

    let updated: SandboxGameRecord;
    try {
      updated = await this.repo.setLogo(game.id, nextKey, nowIso);
    } catch {
      // An identical re-upload resolves to the existing content-addressed key. If D1 fails in
      // that case, deleting `nextKey` would delete the still-live logo rather than roll back a
      // newly-created object.
      if (nextKey !== game.logoKey) await this.storage.deleteObject(nextKey).catch(() => {});
      throw new SandboxGameUseCaseFailure("PUBLISH_FAILED");
    }

    try {
      await this.repo.appendReviewAudit({
        gameId: game.id,
        versionId: null,
        actorAdminId: input.actingUserId,
        action: "LOGO_CHANGED",
        reason: null,
        metadata: { contentHash },
        nowIso,
      });
    } catch {
      // The durable logo pointer has already switched. Do not delete the newly-live object just
      // because the append-only support audit failed in a later D1 statement.
      console.error(`logo audit append failed for gameId=${game.id}`);
    }
    if (game.logoKey && game.logoKey !== nextKey) {
      await this.storage.deleteObject(game.logoKey).catch(() => {});
    }
    return updated;
  }

  /**
   * Self-registering upload: a single ZIP whose root contains
   * `owogg.json` creates the game *and* its first version in one
   * call — the drag-and-drop path in the Game Creator Center. Reuses `createGame`'s own
   * slug/title validation and review-slot claim rather than duplicating them, so a manifest-driven
   * registration is held to exactly the same rules as the manual form. The archive is decompressed
   * only once here (unlike calling createGame then uploadVersion separately, which would parse the
   * same bytes twice) — the manifest is read from the same `prepared.files` the upload itself uses.
   */
  async createGameFromBundle(input: {
    developerUserId: number;
    bytes: ArrayBuffer;
    contentType?: string | undefined;
  }): Promise<{ game: SandboxGameRecord; version: SandboxGameVersionRecord }> {
    if (input.bytes.byteLength === 0) throw new SandboxGameUseCaseFailure("BUNDLE_EMPTY");
    if (input.bytes.byteLength > SANDBOX_GAME_POLICY.MAX_BUNDLE_BYTES) {
      throw new SandboxGameUseCaseFailure("BUNDLE_TOO_LARGE");
    }

    const prepared = (() => {
      try {
        return this.publisher.prepare(input.bytes);
      } catch (err) {
        return asFailure(err);
      }
    })();

    const manifest = (() => {
      try {
        return extractGameCreatorManifest(prepared.files);
      } catch (err) {
        return manifestFailure(err);
      }
    })();
    if (!manifest) throw new SandboxGameUseCaseFailure("MANIFEST_MISSING");
    this.assertSupportedManifestFeatures(manifest);

    // Required on every registration (2026-08-18) — checked here, before createGame(), so a
    // missing/oversized logo never leaves a game row behind with nothing to show for it.
    const logoFile = findGameLogoFile(prepared.files);
    if (!logoFile) throw new SandboxGameUseCaseFailure("LOGO_REQUIRED");
    if (logoFile.bytes.byteLength > SANDBOX_GAME_POLICY.MAX_LOGO_BYTES) {
      throw new SandboxGameUseCaseFailure("LOGO_TOO_LARGE");
    }

    const game = await this.createGame({
      slug: manifest.game.slug,
      developerUserId: input.developerUserId,
      title: manifest.game.title,
      shortDescription: manifest.game.shortDescription ?? null,
      description: defaultGameDescription(manifest, prepared.files) ?? null,
      genre: manifest.game.genre,
      mode: manifest.game.mode,
      tags: manifest.game.tags ?? [],
      defaultScreenMode: manifest.presentation?.defaultMode ?? "default",
    });

    // The logo is a game-level asset, not a playable bundle file — excluded from what actually
    // gets published to the version's servable path (see uploadPreparedVersion's logoFile
    // handling, which stores it separately and links sandbox_games.logo_key instead).
    const publishableFiles = prepared.files.filter((f) => f.path !== logoFile.path);
    const publishablePrepared: PreparedBundle = {
      ...prepared,
      files: publishableFiles,
      totalSize: prepared.totalSize - logoFile.bytes.byteLength,
    };

    const version = await this.uploadPreparedVersion({
      gameId: game.id,
      requestedByUserId: input.developerUserId,
      bytes: input.bytes,
      contentType: input.contentType,
      prepared: publishablePrepared,
      manifest,
      reviewStatus: "DRAFT",
      logoFile,
    });

    return { game, version };
  }

  /** Shared tail of uploadVersion/createGameFromBundle once an archive has already been prepared:
   * store it, insert the version row, and publish. See uploadVersion's own doc comment for why
   * the ordering (store -> row -> publish) and the best-effort cleanup on a failed insert exist.
   * `logoFile`, when set (only by createGameFromBundle, on first registration), is stored and
   * linked in the same try/catch umbrella as everything else here — a logo write failure surfaces
   * as the same typed PUBLISH_FAILED, not a silent partial success. */
  private async uploadPreparedVersion(input: {
    gameId: number;
    requestedByUserId: number;
    bytes: ArrayBuffer;
    contentType?: string | undefined;
    prepared: PreparedBundle;
    manifest: NonNullable<ReturnType<typeof extractGameCreatorManifest>>;
    reviewStatus: "DRAFT" | "PENDING_REVIEW";
    logoFile?: PreparedBundleFile | undefined;
  }): Promise<SandboxGameVersionRecord> {
    const contentHash = await sha256Hex(input.bytes);
    const objectKey = sourceArchiveObjectKey(input.gameId, contentHash);

    // Both the storage write and the D1 row insert are wrapped in the SAME catch — a bare
    // `await this.storage.putObject(...)` with no try/catch used to let a real infra failure
    // (B2 network/auth error, D1 write failure) escape as a raw, un-typed exception. That error
    // is not a SandboxGameUseCaseFailure, so the route layer's `failureResponse` (which only
    // knows how to translate SandboxGameUseCaseFailure) re-throws it, producing an opaque
    // uncaught-exception 500 with no JSON body instead of a message the caller can show a user —
    // and for createGameFromBundle specifically, the game row from the createGame() step earlier
    // in that call had *already* committed, leaving an orphaned game with no version and a
    // permanently-blocked slug (2026-08-18 production bug report). Converting every failure here
    // to the single typed PUBLISH_FAILED code fixes both: a proper error message, and (via the
    // route's normal error path) no silent partial state that looks like nothing happened.
    let version: SandboxGameVersionRecord;
    try {
      await this.storage.putObject({
        key: objectKey,
        bytes: input.bytes,
        contentType: input.contentType ?? "application/zip",
      });
      version = await this.repo.createVersion({
        gameId: input.gameId,
        objectKey,
        contentHash,
        bundleBytes: input.bytes.byteLength,
        status: input.reviewStatus,
        nowIso: new Date().toISOString(),
      });
      if (input.logoFile) {
        const logoKey = sandboxGameLogoObjectKey(input.gameId, input.logoFile.path);
        await this.storage.putObject({
          key: logoKey,
          bytes: input.logoFile.bytes,
          contentType: input.logoFile.contentType,
        });
        await this.repo.setLogo(input.gameId, logoKey, new Date().toISOString());
      }
    } catch (err) {
      // Best-effort cleanup, not a distributed transaction: if the D1 write fails after the
      // archive already landed in storage, delete it rather than leaving an orphan nobody will
      // ever reference. Safe because source keys are content-addressed (same bytes -> same key) —
      // the only way this could delete an object another version still needs is two *different*
      // uploads producing byte-identical archives at the exact moment one of them fails to write
      // its DB row, an acceptable residual risk rather than one worth a reference-count column.
      // Also harmless (a no-op) when putObject itself was what failed, since nothing was stored.
      // Swallow the delete's own failure so the original error doesn't get masked by a cleanup
      // failure.
      await this.storage.deleteObject(objectKey).catch(() => {});
      // Server-side only (Worker console -> `wrangler tail`), never sent to the client — same
      // reasoning as publishOrFail's doc comment on why raw provider errors don't reach the
      // response body. Without this, PUBLISH_FAILED alone gives an operator no way to tell "B2
      // auth is broken" from "D1 is down" from anything else; this is the only place that
      // distinction is still observable at all.
      console.error(
        `uploadPreparedVersion failed for gameId=${input.gameId}:`,
        err instanceof Error ? err.message : err,
      );
      throw new SandboxGameUseCaseFailure("PUBLISH_FAILED");
    }

    // A publish failure here leaves a real, valid version row that simply isn't servable yet
    // (FAILED), recoverable with republishVersion — so it is surfaced as its own error rather than
    // undoing the upload the developer just paid for.
    const published = await this.publishOrFail(version, input.prepared);
    await this.submitDeclaredMultiplayerRequest({
      manifest: input.manifest,
      gameId: input.gameId,
      gameVersionId: published.id,
      contentHash: published.contentHash,
      requestedByUserId: input.requestedByUserId,
    });
    return published;
  }

  /** Storage-level publish failures become a single typed code. The underlying provider message is
   * deliberately not propagated to the caller — it is already recorded on the version's
   * `publishError` for operators, and a raw provider error can carry request URLs an end user has
   * no business seeing. */
  private async publishOrFail(
    version: SandboxGameVersionRecord,
    prepared: ReturnType<GamePublicationService["prepare"]>,
  ): Promise<SandboxGameVersionRecord> {
    try {
      await this.publisher.publish({
        gameId: version.gameId,
        versionId: version.id,
        contentHash: version.contentHash,
        prepared,
        publishedAt: new Date().toISOString(),
      });
      const published = await this.repo.findVersionById(version.id);
      if (!published) throw new Error(`Published version ${version.id} disappeared`);
      return published;
    } catch {
      throw new SandboxGameUseCaseFailure("PUBLISH_FAILED");
    }
  }

  /**
   * Re-runs publishing for an existing version from its stored source archive — the recovery path
   * for a version left FAILED/PUBLISHING by a transient storage error, without asking the
   * developer to re-upload. Idempotent: published objects are immutable, so rewriting them stores
   * identical bytes.
   */
  async republishVersion(versionId: number): Promise<SandboxGameVersionRecord> {
    const version = await this.repo.findVersionById(versionId);
    if (!version) throw new SandboxGameUseCaseFailure("VERSION_NOT_FOUND");
    const game = await this.repo.findById(version.gameId);
    if (!game) throw new SandboxGameUseCaseFailure("GAME_NOT_FOUND");

    const archive = await this.storage.getObject(version.objectKey);
    if (!archive) throw new SandboxGameUseCaseFailure("PUBLISH_FAILED");

    const preparedWithMetadata = (() => {
      try {
        return this.publisher.prepare(archive);
      } catch (err) {
        return asFailure(err);
      }
    })();

    const manifest = (() => {
      try {
        return extractGameCreatorManifest(preparedWithMetadata.files);
      } catch (err) {
        return manifestFailure(err);
      }
    })();
    if (!manifest) throw new SandboxGameUseCaseFailure("MANIFEST_MISSING");
    if (manifest.game.slug !== game.slug) throw new SandboxGameUseCaseFailure("MANIFEST_INVALID");
    this.assertSupportedManifestFeatures(manifest);
    const logo = findGameLogoFile(preparedWithMetadata.files);
    const prepared = logo
      ? {
          ...preparedWithMetadata,
          files: preparedWithMetadata.files.filter((file) => file.path !== logo.path),
          totalSize: preparedWithMetadata.totalSize - logo.bytes.byteLength,
        }
      : preparedWithMetadata;

    const published = await this.publishOrFail(version, prepared);
    await this.submitDeclaredMultiplayerRequest({
      manifest,
      gameId: game.id,
      gameVersionId: published.id,
      contentHash: published.contentHash,
      requestedByUserId: game.developerUserId,
    });
    return published;
  }

  private async synchronizeCanonicalFromVersion(
    version: SandboxGameVersionRecord,
    nowIso: string,
  ): Promise<void> {
    const game = await this.repo.findById(version.gameId);
    if (!game) throw new SandboxGameUseCaseFailure("GAME_NOT_FOUND");
    const archive = await this.storage.getObject(version.objectKey);
    if (!archive) throw new SandboxGameUseCaseFailure("PUBLISH_FAILED");

    let prepared: PreparedBundle;
    try {
      prepared = this.publisher.prepare(archive);
    } catch {
      throw new SandboxGameUseCaseFailure("PUBLISH_FAILED");
    }

    let manifest: ReturnType<typeof extractGameCreatorManifest>;
    try {
      manifest = extractGameCreatorManifest(prepared.files);
    } catch (error) {
      return manifestFailure(error);
    }
    if (!manifest) throw new SandboxGameUseCaseFailure("MANIFEST_MISSING");
    if (manifest.game.slug !== game.slug) throw new SandboxGameUseCaseFailure("MANIFEST_INVALID");
    this.assertSupportedManifestFeatures(manifest);

    try {
      const previous = await this.gameCanonicalRepo.findBySlug(game.slug);
      const score = manifest.result.score;
      await this.repo.updateMetadata(
        game.id,
        {
          title: manifest.game.title,
          shortDescription: manifest.game.shortDescription ?? null,
          description: defaultGameDescription(manifest, prepared.files) ?? null,
          genre: manifest.game.genre,
          tags: manifest.game.tags ?? [],
          defaultScreenMode: manifest.presentation?.defaultMode ?? "default",
          scoreUnit: score?.unit ?? null,
          scoreDirection: score?.direction ?? null,
          scoreMin: score?.range.min ?? null,
          scoreMax: score?.range.max ?? null,
          scoreDisplayPrefix: null,
          scoreDisplaySuffix: null,
        },
        nowIso,
      );
      await this.gameCanonicalRepo.save(
        mapGameCreatorManifestToCanonical({
          manifest,
          publisherOfficial: false,
          updatedAt: nowIso,
          defaultDescription: defaultGameDescription(manifest, prepared.files),
          previous,
        }),
      );
    } catch {
      throw new SandboxGameUseCaseFailure("CANONICAL_SYNC_FAILED");
    }
  }

  /**
   * Developer self-service withdrawal of their own not-yet-decided submission — the counterpart to
   * an admin's APPROVED/REJECTED decision, releasing the same review slot. Withdraws every
   * still-PENDING_REVIEW version of the game (in practice at most one, but this doesn't assume
   * that) and always releases the slot, even if — defensively — there happened to be no pending
   * version (e.g. a game created but never uploaded to yet): a game only reaches here with a
   * non-null reviewSlot if it hasn't been decided, so "nothing pending, but still holding a slot"
   * is exactly the case releasing it is for.
   */
  async withdrawSubmission(input: {
    gameId: number;
    actingUserId: number;
  }): Promise<SandboxGameRecord> {
    const game = await this.repo.findById(input.gameId);
    if (!game) throw new SandboxGameUseCaseFailure("GAME_NOT_FOUND");
    if (game.developerUserId !== input.actingUserId) {
      throw new SandboxGameUseCaseFailure("NOT_OWNER");
    }
    if (game.reviewSlot === null) throw new SandboxGameUseCaseFailure("NOTHING_TO_WITHDRAW");

    const versions = await this.repo.listVersionsByGame(game.id);
    const pending = versions.filter((v) => v.status === "PENDING_REVIEW");
    for (const version of pending) {
      await this.repo.withdrawVersion(version.id);
    }

    const nowIso = new Date().toISOString();
    await this.repo.releaseReviewSlot(game.id, nowIso);
    await this.repo.appendReviewAudit({
      gameId: game.id,
      versionId: null,
      actorAdminId: input.actingUserId,
      action: "SUBMISSION_WITHDRAWN",
      reason: null,
      metadata: { withdrawnVersionIds: pending.map((v) => v.id) },
      nowIso,
    });

    const updated = await this.repo.findById(game.id);
    if (!updated) throw new SandboxGameUseCaseFailure("GAME_NOT_FOUND");
    return updated;
  }

  /**
   * Soft-deletes a game (migration 0026) — ADMIN/OPERATOR only, enforced by the route's
   * `requirePermission(admin, "sandbox_games.delete")` (this use case does not itself check who is
   * calling, matching decideVersion/setVisibility's split: business rules here, authorization at
   * the route). Any still-open review slot is released and any PENDING_REVIEW version withdrawn
   * first, mirroring withdrawSubmission, so a deleted game never keeps occupying a developer's
   * limited concurrent-submission quota. The row/versions are kept for audit — see
   * SandboxGameRepository.softDelete's doc comment for why this isn't a hard delete.
   */
  async deleteGame(input: { gameId: number; actorAdminId: number }): Promise<SandboxGameRecord> {
    const game = await this.repo.findById(input.gameId);
    if (!game) throw new SandboxGameUseCaseFailure("GAME_NOT_FOUND");
    if (game.deletedAt !== null) throw new SandboxGameUseCaseFailure("ALREADY_DELETED");

    const nowIso = new Date().toISOString();

    if (game.reviewSlot !== null) {
      const versions = await this.repo.listVersionsByGame(game.id);
      const pending = versions.filter((v) => v.status === "PENDING_REVIEW");
      for (const version of pending) {
        await this.repo.withdrawVersion(version.id);
      }
      await this.repo.releaseReviewSlot(game.id, nowIso);
    }

    const deleted = await this.repo.softDelete(game.id, input.actorAdminId, nowIso);

    await this.repo.appendReviewAudit({
      gameId: game.id,
      versionId: null,
      actorAdminId: input.actorAdminId,
      action: "DELETED",
      reason: null,
      metadata: null,
      nowIso,
    });

    return deleted;
  }

  /** Permanently erases already-soft-deleted draft/test data that has never been approved.
   * Approval permanently reserves the slug: scores, XP events, favorites, and recent-play records
   * still identify games by slug, so reusing a published identity could attach history to unrelated
   * content. Revoking approval does not make the slug reusable; D1's permanent reservation row is
   * authoritative even if workflow/audit rows are later removed. */
  async purgeGame(input: { gameId: number; actorAdminId: number }): Promise<void> {
    const game = await this.repo.findById(input.gameId);
    if (!game) throw new SandboxGameUseCaseFailure("GAME_NOT_FOUND");
    if (game.deletedAt === null) throw new SandboxGameUseCaseFailure("NOT_YET_DELETED");
    if (await this.repo.isSlugPermanentlyReserved(game.slug)) {
      throw new SandboxGameUseCaseFailure("CANNOT_PURGE_APPROVED_GAME");
    }

    await this.repo.hardDelete(game.id);
  }

  /**
   * Game Creator self-service full removal of their OWN game — no permission grant required beyond
   * ownership, unlike deleteGame(), because this is only reachable while nothing has ever been
   * approved (2026-08-18 product decision — "관리자나 운영자가 승인한게 아니라면 그 전까진 게임
   * Game Creator가 지워도 됨"). Once any version reaches APPROVED, self-delete is refused
   * (CANNOT_DELETE_APPROVED_GAME) and only an ADMIN/OPERATOR can remove it from then on via
   * deleteGame(). A genuine hard delete (see SandboxGameRepository.hardDelete) rather than
   * softDelete: nothing here was ever public or reviewed, so there is nothing worth an audit trail
   * for — and hard-deleting is what actually frees `slug` for a retry with the same name, which
   * softDelete's non-partial UNIQUE constraint on slug cannot do.
   */
  async deleteOwnGame(input: { gameId: number; developerUserId: number }): Promise<void> {
    const game = await this.repo.findById(input.gameId);
    if (!game) throw new SandboxGameUseCaseFailure("GAME_NOT_FOUND");
    if (game.developerUserId !== input.developerUserId) {
      throw new SandboxGameUseCaseFailure("NOT_OWNER");
    }

    if (await this.repo.isSlugPermanentlyReserved(game.slug)) {
      throw new SandboxGameUseCaseFailure("CANNOT_DELETE_APPROVED_GAME");
    }

    // hardDelete removes the versions (and audit log rows) along with the game row itself, so
    // there is nothing left to withdraw/release separately — unlike deleteGame(), which has to
    // because it keeps the row.
    await this.repo.hardDelete(game.id);
  }

  async decideVersion(input: {
    versionId: number;
    adminId: number;
    decision: "APPROVED" | "REJECTED";
    reason: string | null;
  }): Promise<SandboxGameVersionRecord> {
    const version = await this.repo.findVersionById(input.versionId);
    if (!version) throw new SandboxGameUseCaseFailure("VERSION_NOT_FOUND");
    if (version.status !== "PENDING_REVIEW") {
      throw new SandboxGameUseCaseFailure("ALREADY_DECIDED");
    }
    if (input.decision === "REJECTED" && !input.reason?.trim()) {
      throw new SandboxGameUseCaseFailure("REASON_REQUIRED");
    }
    // Approving is what makes a version eligible to go live, so a version that isn't fully
    // published must not get there: a partial publish would otherwise become a live game missing
    // some of its files. Rejecting stays possible regardless — an admin must always be able to
    // turn down content, whether or not its files happen to be in place.
    if (input.decision === "APPROVED" && !isPublishedVersion(version.publishStatus)) {
      throw new SandboxGameUseCaseFailure("VERSION_NOT_PUBLISHED");
    }

    const nowIso = new Date().toISOString();
    const reason = input.reason?.trim() || null;
    if (input.decision === "APPROVED") {
      // Canonical must describe the exact source archive being promoted. Write it before the D1
      // live pointer changes so runtime reads never observe a new build with an old contract.
      await this.synchronizeCanonicalFromVersion(version, nowIso);
    }
    const decided = await this.repo.decideVersion(
      version.id,
      input.decision,
      input.adminId,
      reason,
      nowIso,
    );

    if (input.decision === "APPROVED") {
      await this.repo.setLiveVersion(version.gameId, version.id, nowIso);
    }

    // Terminal decision on this version — release the developer's review slot regardless of
    // whether this was actually the version holding it (releaseReviewSlot is a no-op once already
    // null), so a game re-uploaded after its first decision never re-consumes a slot on a later
    // re-review.
    await this.repo.releaseReviewSlot(version.gameId, nowIso);

    await this.repo.appendReviewAudit({
      gameId: version.gameId,
      versionId: version.id,
      actorAdminId: input.adminId,
      action: input.decision === "APPROVED" ? "VERSION_APPROVED" : "VERSION_REJECTED",
      reason,
      metadata: null,
      nowIso,
    });

    return decided;
  }

  /**
   * Reverts an APPROVED version's decision back to PENDING_REVIEW — an ADMIN/OPERATOR undoing a
   * mistaken approval (2026-08-18 product decision — "관리자가 승인 결정 자체를 취소(재심사
   * 대기로 되돌림)"), not a developer action and not the same as toggling visibility. Distinct
   * from decideVersion, which only ever moves PENDING_REVIEW forward to a terminal state.
   *
   * If this was the game's current live version, `live_version_id` is cleared and `visibility`
   * forced back to PRIVATE in the same write (same CHECK-constraint reasoning as softDelete/
   * hardDelete) — a game can't stay PUBLIC pointing at a version that is, as of this call, no
   * longer approved. If the game had already moved on to a different live version (e.g. a newer
   * upload was approved since), this is a no-op at the game level — only the specific version's
   * own status changes.
   *
   * Deliberately does NOT re-claim a review slot: MAX_CONCURRENT_REVIEW_SLOTS exists to bound how
   * many *developer-initiated* submissions can be open at once, and this is an admin correcting
   * their own past decision, not a new developer action — the reverted version still surfaces in
   * the general PENDING_REVIEW queue (listPendingReview) for re-review regardless.
   */
  async revokeApproval(input: {
    versionId: number;
    adminId: number;
    reason: string | null;
  }): Promise<SandboxGameVersionRecord> {
    const version = await this.repo.findVersionById(input.versionId);
    if (!version) throw new SandboxGameUseCaseFailure("VERSION_NOT_FOUND");
    if (version.status !== "APPROVED") {
      throw new SandboxGameUseCaseFailure("REVOKE_REQUIRES_APPROVED");
    }

    const nowIso = new Date().toISOString();
    await this.repo.clearLiveVersionIfMatches(version.gameId, version.id, nowIso);
    const reverted = await this.repo.revokeVersionApproval(version.id);

    await this.repo.appendReviewAudit({
      gameId: version.gameId,
      versionId: version.id,
      actorAdminId: input.adminId,
      action: "APPROVAL_REVOKED",
      reason: input.reason,
      metadata: null,
      nowIso,
    });

    return reverted;
  }

  /**
   * Points a game at a different already-approved, already-published version — the rollback (and
   * roll-forward) switch. Costs one D1 update and re-uploads nothing: every version keeps its own
   * immutable object prefix, so the previous build is still sitting in storage untouched.
   */
  async setLiveVersion(
    gameId: number,
    adminId: number,
    versionId: number,
  ): Promise<SandboxGameRecord> {
    const game = await this.repo.findById(gameId);
    if (!game) throw new SandboxGameUseCaseFailure("GAME_NOT_FOUND");

    const version = await this.repo.findVersionById(versionId);
    if (!version || version.gameId !== gameId) {
      throw new SandboxGameUseCaseFailure("VERSION_NOT_FOUND");
    }
    if (version.status !== "APPROVED") throw new SandboxGameUseCaseFailure("VERSION_NOT_APPROVED");
    if (!isPublishedVersion(version.publishStatus)) {
      throw new SandboxGameUseCaseFailure("VERSION_NOT_PUBLISHED");
    }

    const nowIso = new Date().toISOString();
    await this.synchronizeCanonicalFromVersion(version, nowIso);
    const updated = await this.repo.setLiveVersion(gameId, versionId, nowIso);
    await this.repo.appendReviewAudit({
      gameId,
      versionId,
      actorAdminId: adminId,
      action: "LIVE_VERSION_CHANGED",
      reason: null,
      metadata: { versionId, previousVersionId: game.liveVersionId },
      nowIso,
    });
    return updated;
  }

  /**
   * Updates D1's compatibility mirror and the sole generic canonical document.
   *
   * Ordering is deliberately fail-closed: pre-read and validate generic canonical, commit the D1
   * update and audit, re-read generic canonical to narrow concurrent-write races, then save and
   * strictly read back `game-definitions/<slug>/definition.json`. Existing canonical-only state
   * (presentation, difficulty, supportsReplay, requiresAuth, score:null and richer catalog data)
   * is patched in place and never reconstructed from D1. A missing document is first-created only
   * after the row has a complete score policy. There is no cross-store transaction; failures after
   * D1 commits surface as CANONICAL_SYNC_FAILED and an identical retry safely converges.
   */
  async updateMetadata(
    gameId: number,
    adminId: number,
    input: SandboxGameMetadataInput,
  ): Promise<SandboxGameRecord> {
    const game = await this.repo.findById(gameId);
    if (!game) throw new SandboxGameUseCaseFailure("GAME_NOT_FOUND");
    if (input.title !== undefined) validateTitle(input.title);

    let existingCanonical: GameCanonicalDocument | null;
    try {
      existingCanonical = await this.gameCanonicalRepo.findBySlug(game.slug);
    } catch {
      throw new SandboxGameUseCaseFailure("CANONICAL_SYNC_FAILED");
    }

    if (existingCanonical !== null) {
      const scoreCheck = computeUserCanonicalScorePatch(existingCanonical.policy.score, input);
      if (!scoreCheck.ok) {
        throw new SandboxGameUseCaseFailure(scoreCheck.reason);
      }
      if (
        (input.genre !== undefined || input.mode !== undefined) &&
        existingCanonical.catalog.type !== "GENRE_MODE"
      ) {
        throw new SandboxGameUseCaseFailure("CANONICAL_SYNC_FAILED");
      }
    }

    const nowIso = new Date().toISOString();
    const updated = await this.repo.updateMetadata(gameId, input, nowIso);
    await this.repo.appendReviewAudit({
      gameId,
      versionId: null,
      actorAdminId: adminId,
      action: "METADATA_CHANGED",
      reason: null,
      metadata: input as unknown as Record<string, unknown>,
      nowIso,
    });

    await this.syncCanonicalAfterMetadataUpdate(existingCanonical, updated, input);

    return updated;
  }

  /** Synchronizes the single generic canonical after D1 + audit have committed. */
  private async syncCanonicalAfterMetadataUpdate(
    preRead: GameCanonicalDocument | null,
    updated: SandboxGameRecord,
    input: SandboxGameMetadataInput,
  ): Promise<void> {
    let freshCanonical: GameCanonicalDocument | null;
    try {
      freshCanonical = await this.gameCanonicalRepo.findBySlug(updated.slug);
    } catch {
      throw new SandboxGameUseCaseFailure("CANONICAL_SYNC_FAILED");
    }

    let nextDocument: GameCanonicalDocument | null;
    if (freshCanonical !== null) {
      const patched = patchUserGameCanonical(freshCanonical, updated, input);
      if (!patched.ok) {
        throw new SandboxGameUseCaseFailure("CANONICAL_SYNC_FAILED");
      }
      nextDocument = patched.document;
    } else {
      // A document observed before the D1 write must never be reconstructed from D1 if it
      // disappears. That would erase canonical-only state and turn storage corruption/races into
      // an implicit repair.
      if (preRead !== null) throw new SandboxGameUseCaseFailure("CANONICAL_SYNC_FAILED");
      nextDocument = mapUserGameRecordToCanonical(updated);
      if (nextDocument === null) return;
    }

    try {
      await this.gameCanonicalRepo.save(nextDocument);
      const readBack = await this.gameCanonicalRepo.findBySlug(nextDocument.slug);
      if (readBack === null || !jsonDeepEqual(readBack, nextDocument)) {
        throw new SandboxGameUseCaseFailure("CANONICAL_SYNC_FAILED");
      }
    } catch (err) {
      if (err instanceof SandboxGameUseCaseFailure) throw err;
      throw new SandboxGameUseCaseFailure("CANONICAL_SYNC_FAILED");
    }
  }

  async setVisibility(
    gameId: number,
    adminId: number,
    visibility: SandboxGameVisibility,
  ): Promise<SandboxGameRecord> {
    const game = await this.repo.findById(gameId);
    if (!game) throw new SandboxGameUseCaseFailure("GAME_NOT_FOUND");
    // A deleted game has no "undelete" — deleteGame already forces PRIVATE, and without this
    // guard a stray PATCH could flip a soft-deleted (and now, since listAll includes deleted
    // games, browsable-again) row back to PUBLIC with no explicit undelete step ever happening.
    if (game.deletedAt !== null) throw new SandboxGameUseCaseFailure("ALREADY_DELETED");
    if (visibility === "PUBLIC" && !canSetVisibilityPublic(game.liveVersionId !== null)) {
      throw new SandboxGameUseCaseFailure("NO_APPROVED_VERSION");
    }

    const nowIso = new Date().toISOString();
    const updated = await this.repo.setVisibility(gameId, visibility, nowIso);
    await this.repo.appendReviewAudit({
      gameId,
      versionId: null,
      actorAdminId: adminId,
      action: "VISIBILITY_CHANGED",
      reason: null,
      metadata: { visibility },
      nowIso,
    });
    return updated;
  }
}

/** Route layers use this to decide whether a failure is the developer's bundle being unacceptable
 * (a 4xx they can fix) rather than a server-side problem. */
export function isBundleRejectionFailure(err: unknown): boolean {
  return err instanceof SandboxGameUseCaseFailure && isBundleRejectionCode(err.code);
}
