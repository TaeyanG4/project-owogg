import {
  findGameLogoFile,
  revisedGameLogoObjectKey,
  standaloneGameLogoPath,
  resolveBundleContentType,
  sandboxGameLogoObjectKey,
  sourceArchiveObjectKey,
  type PreparedBundle,
} from "../domain/sandboxGameBundle.js";
import {
  extractGameCreatorManifest,
  getMultiplayerRuntimeProfileRequestV1,
  parseGameCreatorManifestBytes,
} from "../domain/gameCreatorManifest.js";
import { mapGameCreatorManifestToCanonical } from "../domain/gameCreatorManifestCanonical.js";
import { SANDBOX_GAME_POLICY } from "../domain/sandboxGames.js";
import type { GameCanonicalDocument } from "../modules/game/domain/gameCanonicalDocument.js";
import type { GameIdentity } from "../modules/game/domain/gameIdentity.js";
import type { GameVersion } from "../modules/game/domain/gameVersion.js";
import type { GameCanonicalRepository } from "../modules/game/ports/gameCanonicalRepository.js";
import type { MultiplayerProfileRequestRepository } from "../modules/multiplayer/ports/multiplayerProfileRequestRepository.js";
import { resolveMultiplayerRuntimeProfileRequestV1 } from "../modules/multiplayer/domain/multiplayerProfileRequest.js";
import type {
  GamePublicationFacts,
  GamePublicationTarget,
  GameVersionPublicationRepository,
} from "../modules/game/ports/gameVersionPublicationRepository.js";
import type {
  BundleArchiveWriter,
  GameBundleStorageRepository,
  SandboxGameBasicMetadataInput,
} from "../ports/sandboxGames.js";
import { EMPTY_GAME_VERIFIER_REGISTRY, type GameVerifierCatalog } from "../ports/gameVerifier.js";
import { GamePublicationService } from "./gamePublicationService.js";
import {
  patchGameCreatorManifestBasicMetadata,
  rebuildGameBundleArchive,
  serializeGameCreatorManifest,
} from "./gameBundleRevision.js";

export const OFFICIAL_GAME_UPLOAD_FAILURES = [
  "BUNDLE_EMPTY",
  "BUNDLE_TOO_LARGE",
  "BUNDLE_INVALID",
  "MANIFEST_MISSING",
  "MANIFEST_INVALID",
  "VERIFIER_NOT_REGISTERED",
  "MULTIPLAYER_RUNTIME_NOT_AVAILABLE",
  "MULTIPLAYER_CAPABILITY_NOT_AVAILABLE",
  "LOGO_REQUIRED",
  "LOGO_TOO_LARGE",
  "SLUG_CONFLICT",
  "GAME_NOT_FOUND",
  "VERSION_NOT_FOUND",
  "LOGO_INVALID",
  "PUBLISH_FAILED",
] as const;
export type OfficialGameUploadFailureCode = (typeof OFFICIAL_GAME_UPLOAD_FAILURES)[number];

export class OfficialGameUploadFailure extends Error {
  constructor(public readonly code: OfficialGameUploadFailureCode) {
    super(code);
  }
}

/** OWOGG-only D1 write boundary. USER review and ownership writes are intentionally absent. */
export interface OfficialGameUploadRepository extends GameVersionPublicationRepository {
  /** Returns null only when the slug already belongs to USER. A quarantined OWOGG identity is
   * reusable so immutable multiplayer history can remain attached to the same numeric identity.
   * Infrastructure failures must throw so callers do not misreport an outage as a conflict. */
  ensureOwoggIdentity(input: { slug: string; nowIso: string }): Promise<GameIdentity | null>;
  findOwoggIdentity(slug: string): Promise<GameIdentity | null>;
  findVersionById(gameId: number, versionId: number): Promise<GameVersion | null>;
  findLogoObjectKey(gameId: number): Promise<string | null>;
  findVersionByContentHash(gameId: number, contentHash: string): Promise<GameVersion | null>;
  createVersion(input: {
    gameId: number;
    objectKey: string;
    contentHash: string;
    bundleBytes: number;
    nowIso: string;
  }): Promise<GameVersion>;
  upsertLogo(input: { gameId: number; objectKey: string; nowIso: string }): Promise<void>;
  activate(input: {
    gameId: number;
    versionId: number;
    canonical: GameCanonicalDocument;
    nowIso: string;
  }): Promise<void>;
}

export interface OfficialGameDeletionPlan {
  readonly gameId: number;
  readonly slug: string;
  readonly versions: readonly GameVersion[];
  readonly assetObjectKeys: readonly string[];
}

export type OfficialGameDeletionDisposition = "PURGED" | "HISTORY_RETAINED";

/** Destructive OWOGG lifecycle boundary. The first operation quarantines the identity before any
 * cross-store deletion; the final operation is allowed only for that quarantined OWOGG row. */
export interface OfficialGameLifecycleRepository {
  prepareDeletion(input: {
    slug: string;
    nowIso: string;
  }): Promise<OfficialGameDeletionPlan | null>;
  purgeDeletion(input: {
    gameId: number;
    slug: string;
    actorAdminId: number;
    versionCount: number;
    objectCount: number;
    nowIso: string;
  }): Promise<OfficialGameDeletionDisposition>;
}

export interface OfficialGameUploadResult {
  readonly gameId: number;
  readonly versionId: number;
  readonly slug: string;
  readonly title: string;
  readonly publisherName: "OWOGG";
  readonly reusedReadyVersion: boolean;
  readonly publishedAt: string;
}

export interface OfficialGameLogoUpdateResult {
  readonly gameId: number;
  readonly slug: string;
  readonly hasLogo: true;
  readonly updatedAt: string;
}

export const OFFICIAL_GAME_DELETE_FAILURES = [
  "GAME_NOT_FOUND",
  "STORAGE_DELETE_FAILED",
  "DATABASE_DELETE_FAILED",
] as const;
export type OfficialGameDeleteFailureCode = (typeof OFFICIAL_GAME_DELETE_FAILURES)[number];

export class OfficialGameDeleteFailure extends Error {
  constructor(public readonly code: OfficialGameDeleteFailureCode) {
    super(code);
  }
}

export interface OfficialGameDeleteResult {
  readonly gameId: number;
  readonly slug: string;
  readonly deletedVersionCount: number;
  readonly deletedObjectCount: number;
  readonly deletedAt: string;
  readonly identityRetainedForHistory: boolean;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Trusted admin publication path. Publisher authority is selected by the server route; archive
 * contents can describe a game but can never request or spoof OWOGG authority. */
export class OfficialGameUploadUseCases {
  constructor(
    private readonly repository: OfficialGameUploadRepository,
    private readonly storage: GameBundleStorageRepository,
    private readonly canonicals: GameCanonicalRepository,
    private readonly publication: GamePublicationService,
    private readonly archiveWriter?: BundleArchiveWriter,
    private readonly multiplayerProfileRequests?: MultiplayerProfileRequestRepository,
    private readonly gameVerifierCatalog: GameVerifierCatalog = EMPTY_GAME_VERIFIER_REGISTRY,
  ) {}

  private assertSupportedManifestFeatures(
    manifest: NonNullable<ReturnType<typeof extractGameCreatorManifest>>,
  ): void {
    const verifierId = manifest.playConfig?.verifierId;
    if (verifierId !== undefined && !this.gameVerifierCatalog.has(verifierId)) {
      throw new OfficialGameUploadFailure("VERIFIER_NOT_REGISTERED");
    }
    const request = getMultiplayerRuntimeProfileRequestV1(manifest);
    if (!request) return;
    const resolution = resolveMultiplayerRuntimeProfileRequestV1(request);
    if (resolution.status === "RUNTIME_NOT_AVAILABLE") {
      throw new OfficialGameUploadFailure("MULTIPLAYER_RUNTIME_NOT_AVAILABLE");
    }
    if (resolution.status === "CAPABILITY_NOT_AVAILABLE") {
      throw new OfficialGameUploadFailure("MULTIPLAYER_CAPABILITY_NOT_AVAILABLE");
    }
  }

  private async submitDeclaredMultiplayerRequest(input: {
    manifest: NonNullable<ReturnType<typeof extractGameCreatorManifest>>;
    gameId: number;
    gameVersionId: number;
    contentHash: string;
    nowIso: string;
  }): Promise<void> {
    const request = getMultiplayerRuntimeProfileRequestV1(input.manifest);
    if (!request) return;
    if (!this.multiplayerProfileRequests) throw new OfficialGameUploadFailure("PUBLISH_FAILED");
    try {
      const submitted = await this.multiplayerProfileRequests.submit({
        gameId: input.gameId,
        gameVersionId: input.gameVersionId,
        contentHash: input.contentHash,
        requestedByUserId: null,
        request,
        nowIso: input.nowIso,
      });
      if (submitted.status === "REJECTED") {
        console.error(
          `official multiplayer profile request rejected for gameId=${input.gameId} versionId=${input.gameVersionId}: ${submitted.code}`,
        );
        throw new OfficialGameUploadFailure("PUBLISH_FAILED");
      }
    } catch (error) {
      if (error instanceof OfficialGameUploadFailure) throw error;
      console.error(
        `official multiplayer profile request failed for gameId=${input.gameId} versionId=${input.gameVersionId}:`,
        error instanceof Error ? error.message : error,
      );
      throw new OfficialGameUploadFailure("PUBLISH_FAILED");
    }
  }

  async upload(input: {
    bytes: ArrayBuffer;
    contentType?: string | undefined;
  }): Promise<OfficialGameUploadResult> {
    if (input.bytes.byteLength === 0) throw new OfficialGameUploadFailure("BUNDLE_EMPTY");
    if (input.bytes.byteLength > SANDBOX_GAME_POLICY.MAX_BUNDLE_BYTES) {
      throw new OfficialGameUploadFailure("BUNDLE_TOO_LARGE");
    }

    let prepared: PreparedBundle;
    try {
      prepared = this.publication.prepare(input.bytes);
    } catch {
      throw new OfficialGameUploadFailure("BUNDLE_INVALID");
    }

    let manifest: ReturnType<typeof extractGameCreatorManifest>;
    try {
      manifest = extractGameCreatorManifest(prepared.files);
    } catch {
      throw new OfficialGameUploadFailure("MANIFEST_INVALID");
    }
    if (!manifest) throw new OfficialGameUploadFailure("MANIFEST_MISSING");
    this.assertSupportedManifestFeatures(manifest);

    const nowIso = new Date().toISOString();
    const canonical = mapGameCreatorManifestToCanonical({
      manifest,
      publisherOfficial: true,
      updatedAt: nowIso,
    });
    const logo = findGameLogoFile(prepared.files);
    if (!logo) throw new OfficialGameUploadFailure("LOGO_REQUIRED");
    if (logo.bytes.byteLength > SANDBOX_GAME_POLICY.MAX_LOGO_BYTES) {
      throw new OfficialGameUploadFailure("LOGO_TOO_LARGE");
    }

    let identity: GameIdentity | null;
    try {
      identity = await this.repository.ensureOwoggIdentity({ slug: canonical.slug, nowIso });
    } catch {
      throw new OfficialGameUploadFailure("PUBLISH_FAILED");
    }
    if (!identity) throw new OfficialGameUploadFailure("SLUG_CONFLICT");

    const contentHash = await sha256Hex(input.bytes);
    const sourceKey = sourceArchiveObjectKey(identity.id, contentHash);
    let version = await this.repository.findVersionByContentHash(identity.id, contentHash);
    const reusedReadyVersion = version?.publishStatus === "READY";

    const publishable = prepared.files.filter((file) => file.path !== logo.path);
    const publishablePrepared: PreparedBundle = {
      ...prepared,
      files: publishable,
      totalSize: prepared.totalSize - logo.bytes.byteLength,
    };

    try {
      if (!reusedReadyVersion) {
        await this.storage.putObject({
          key: sourceKey,
          bytes: input.bytes,
          contentType: input.contentType ?? "application/zip",
        });
        version ??= await this.repository.createVersion({
          gameId: identity.id,
          objectKey: sourceKey,
          contentHash,
          bundleBytes: input.bytes.byteLength,
          nowIso,
        });
        await this.publication.publish({
          gameId: identity.id,
          versionId: version.id,
          contentHash,
          prepared: publishablePrepared,
          publishedAt: nowIso,
        });
      }

      if (!version) throw new Error("official version allocation failed");
      const logoKey = sandboxGameLogoObjectKey(identity.id, logo.path);
      await this.storage.putObject({
        key: logoKey,
        bytes: logo.bytes,
        contentType: logo.contentType,
      });
      await this.repository.upsertLogo({ gameId: identity.id, objectKey: logoKey, nowIso });
      await this.submitDeclaredMultiplayerRequest({
        manifest,
        gameId: identity.id,
        gameVersionId: version.id,
        contentHash: version.contentHash,
        nowIso,
      });
      await this.canonicals.save(canonical);
      await this.repository.activate({
        gameId: identity.id,
        versionId: version.id,
        canonical,
        nowIso,
      });
    } catch (error) {
      if (version && version.publishStatus !== "READY") {
        const target: GamePublicationTarget = {
          gameId: identity.id,
          versionId: version.id,
          contentHash,
        };
        await this.publication.recordFailure(target, error);
      }
      throw new OfficialGameUploadFailure("PUBLISH_FAILED");
    }

    return {
      gameId: identity.id,
      versionId: version.id,
      slug: canonical.slug,
      title: canonical.title,
      publisherName: "OWOGG",
      reusedReadyVersion,
      publishedAt: nowIso,
    };
  }

  /** Targeted full-bundle replacement for an existing official game. The route slug is checked
   * before any identity/version/storage mutation, preventing a file chosen on one row from
   * accidentally registering or updating a different official game. */
  async replaceBundle(input: {
    slug: string;
    bytes: ArrayBuffer;
    contentType?: string | undefined;
  }): Promise<OfficialGameUploadResult> {
    let prepared: PreparedBundle;
    let manifest: ReturnType<typeof extractGameCreatorManifest>;
    try {
      prepared = this.publication.prepare(input.bytes);
      manifest = extractGameCreatorManifest(prepared.files);
    } catch {
      throw new OfficialGameUploadFailure("BUNDLE_INVALID");
    }
    if (!manifest || manifest.game.slug !== input.slug) {
      throw new OfficialGameUploadFailure("MANIFEST_INVALID");
    }
    if (!(await this.repository.findOwoggIdentity(input.slug))) {
      throw new OfficialGameUploadFailure("GAME_NOT_FOUND");
    }
    return this.upload({ bytes: input.bytes, contentType: input.contentType });
  }

  private async revisionBase(slug: string): Promise<{
    identity: GameIdentity;
    prepared: PreparedBundle;
    manifest: NonNullable<ReturnType<typeof extractGameCreatorManifest>>;
    currentLogo: NonNullable<ReturnType<typeof findGameLogoFile>>;
  }> {
    if (!this.archiveWriter) throw new OfficialGameUploadFailure("PUBLISH_FAILED");
    const identity = await this.repository.findOwoggIdentity(slug);
    if (!identity) throw new OfficialGameUploadFailure("GAME_NOT_FOUND");
    if (!identity.liveVersionId) throw new OfficialGameUploadFailure("VERSION_NOT_FOUND");
    const version = await this.repository.findVersionById(identity.id, identity.liveVersionId);
    if (!version) throw new OfficialGameUploadFailure("VERSION_NOT_FOUND");
    const source = await this.storage.getObject(version.objectKey);
    if (!source) throw new OfficialGameUploadFailure("VERSION_NOT_FOUND");

    let prepared: PreparedBundle;
    let manifest: ReturnType<typeof extractGameCreatorManifest>;
    try {
      prepared = this.publication.prepare(source);
      manifest = extractGameCreatorManifest(prepared.files);
    } catch {
      throw new OfficialGameUploadFailure("BUNDLE_INVALID");
    }
    if (!manifest || manifest.game.slug !== slug) {
      throw new OfficialGameUploadFailure("MANIFEST_INVALID");
    }

    const currentLogoKey = await this.repository.findLogoObjectKey(identity.id);
    if (!currentLogoKey) throw new OfficialGameUploadFailure("LOGO_REQUIRED");
    const logoBytes = await this.storage.getObject(currentLogoKey);
    const logoPath = standaloneGameLogoPath(currentLogoKey);
    if (!logoBytes || !logoPath) throw new OfficialGameUploadFailure("LOGO_REQUIRED");
    const { contentType, contentEncoding } = resolveBundleContentType(logoPath);
    return {
      identity,
      prepared,
      manifest,
      currentLogo: {
        path: logoPath,
        bytes: new Uint8Array(logoBytes),
        contentType,
        contentEncoding,
      },
    };
  }

  /** Replaces only `owogg.json`, but publishes the result through the normal official version path
   * so source ZIP, immutable files, canonical metadata and leaderboard generation stay aligned. */
  async replaceManifest(input: {
    slug: string;
    bytes: ArrayBuffer;
  }): Promise<OfficialGameUploadResult> {
    if (
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > SANDBOX_GAME_POLICY.MAX_MANIFEST_BYTES
    ) {
      throw new OfficialGameUploadFailure("MANIFEST_INVALID");
    }
    let manifest: ReturnType<typeof parseGameCreatorManifestBytes>;
    try {
      manifest = parseGameCreatorManifestBytes(input.bytes);
    } catch {
      throw new OfficialGameUploadFailure("MANIFEST_INVALID");
    }
    if (manifest.game.slug !== input.slug) {
      throw new OfficialGameUploadFailure("MANIFEST_INVALID");
    }
    const base = await this.revisionBase(input.slug);
    const archive = rebuildGameBundleArchive({
      prepared: base.prepared,
      writer: this.archiveWriter as BundleArchiveWriter,
      manifestBytes: serializeGameCreatorManifest(manifest),
      currentLogo: base.currentLogo,
    });
    return this.upload({ bytes: archive, contentType: "application/zip" });
  }

  async updateBasicMetadata(input: {
    slug: string;
    metadata: SandboxGameBasicMetadataInput;
  }): Promise<OfficialGameUploadResult> {
    const base = await this.revisionBase(input.slug);
    let manifest = base.manifest;
    try {
      const canonical = await this.canonicals.findBySlug(input.slug);
      if (canonical?.creatorManifest) manifest = canonical.creatorManifest;
      manifest = patchGameCreatorManifestBasicMetadata(manifest, input.metadata);
    } catch {
      throw new OfficialGameUploadFailure("MANIFEST_INVALID");
    }
    return this.replaceManifest({
      slug: input.slug,
      bytes: serializeGameCreatorManifest(manifest).buffer as ArrayBuffer,
    });
  }

  async replaceLogo(input: {
    slug: string;
    fileName: string;
    bytes: ArrayBuffer;
  }): Promise<OfficialGameLogoUpdateResult> {
    const identity = await this.repository.findOwoggIdentity(input.slug);
    if (!identity) throw new OfficialGameUploadFailure("GAME_NOT_FOUND");
    const logoPath = standaloneGameLogoPath(input.fileName);
    if (
      !logoPath ||
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > SANDBOX_GAME_POLICY.MAX_LOGO_BYTES
    ) {
      throw new OfficialGameUploadFailure(
        input.bytes.byteLength > SANDBOX_GAME_POLICY.MAX_LOGO_BYTES
          ? "LOGO_TOO_LARGE"
          : "LOGO_INVALID",
      );
    }
    const oldKey = await this.repository.findLogoObjectKey(identity.id);
    const hash = await sha256Hex(input.bytes);
    const objectKey = revisedGameLogoObjectKey(identity.id, logoPath, hash);
    const { contentType } = resolveBundleContentType(logoPath);
    const nowIso = new Date().toISOString();
    try {
      await this.storage.putObject({ key: objectKey, bytes: input.bytes, contentType });
      await this.repository.upsertLogo({ gameId: identity.id, objectKey, nowIso });
    } catch {
      // An identical re-upload reuses the live content-addressed key. Only a genuinely new
      // object may be removed as rollback when the D1 pointer update fails.
      if (objectKey !== oldKey) await this.storage.deleteObject(objectKey).catch(() => {});
      throw new OfficialGameUploadFailure("PUBLISH_FAILED");
    }
    if (oldKey && oldKey !== objectKey) await this.storage.deleteObject(oldKey).catch(() => {});
    return { gameId: identity.id, slug: identity.slug, hasLogo: true, updatedAt: nowIso };
  }
}

/** Removes an OWOGG game from B2 and public service so the same slug can be registered again. D1
 * quarantine happens first, making play and score submission fail closed while B2 cleanup runs.
 * Games without multiplayer history are physically purged; games with immutable match history
 * retain the same tombstoned identity and revive only after a replacement publish succeeds. Every
 * storage delete is idempotent, so a partial failure is safe to retry. */
export class OfficialGameLifecycleUseCases {
  constructor(
    private readonly repository: OfficialGameLifecycleRepository,
    private readonly storage: GameBundleStorageRepository,
    private readonly canonicals: GameCanonicalRepository,
    private readonly publication: GamePublicationService,
  ) {}

  async deleteGame(input: {
    slug: string;
    actorAdminId: number;
  }): Promise<OfficialGameDeleteResult> {
    const nowIso = new Date().toISOString();
    let plan: OfficialGameDeletionPlan | null;
    try {
      plan = await this.repository.prepareDeletion({ slug: input.slug, nowIso });
    } catch {
      throw new OfficialGameDeleteFailure("DATABASE_DELETE_FAILED");
    }
    if (!plan) throw new OfficialGameDeleteFailure("GAME_NOT_FOUND");

    let deletedObjectCount = 0;
    try {
      for (const version of plan.versions) {
        deletedObjectCount += await this.publication.deletePublishedVersion({
          gameId: plan.gameId,
          versionId: version.id,
          contentHash: version.contentHash,
          manifestKey: version.manifestKey,
          sourceObjectKey: version.objectKey,
          publishStatus: version.publishStatus,
          publishError: version.publishError,
        });
      }

      for (const sourceObjectKey of new Set(plan.versions.map((version) => version.objectKey))) {
        await this.storage.deleteObject(sourceObjectKey);
        deletedObjectCount++;
      }
      for (const assetObjectKey of new Set(plan.assetObjectKeys)) {
        await this.storage.deleteObject(assetObjectKey);
        deletedObjectCount++;
      }
      await this.canonicals.delete(plan.slug);
      deletedObjectCount++;
    } catch {
      throw new OfficialGameDeleteFailure("STORAGE_DELETE_FAILED");
    }

    let disposition: OfficialGameDeletionDisposition;
    try {
      disposition = await this.repository.purgeDeletion({
        gameId: plan.gameId,
        slug: plan.slug,
        actorAdminId: input.actorAdminId,
        versionCount: plan.versions.length,
        objectCount: deletedObjectCount,
        nowIso,
      });
    } catch {
      throw new OfficialGameDeleteFailure("DATABASE_DELETE_FAILED");
    }

    return {
      gameId: plan.gameId,
      slug: plan.slug,
      deletedVersionCount: plan.versions.length,
      deletedObjectCount,
      deletedAt: nowIso,
      identityRetainedForHistory: disposition === "HISTORY_RETAINED",
    };
  }
}

// Re-exported only for persistence adapters implementing the publication transition port.
export type { GamePublicationFacts, GamePublicationTarget };
