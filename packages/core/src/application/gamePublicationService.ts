import type { BundleArchiveReader, GameBundleStorageRepository } from "../ports/sandboxGames.js";
import {
  buildBundleManifest,
  isSha256ContentHash,
  isValidSandboxGameBundleManifest,
  prepareArchiveFileEntries,
  prepareBundleFromArchive,
  publishedManifestObjectKey,
  publishedObjectKey,
  SandboxBundleRejectionError,
  validateBundleEntryMetadata,
  type PreparedBundle,
  type SandboxGameBundleManifest,
} from "../domain/sandboxGameBundle.js";
import type {
  GamePublicationFacts,
  GamePublicationTarget,
  GameVersionPublicationRepository,
} from "../modules/game/ports/gameVersionPublicationRepository.js";

/**
 * Provider-neutral publication engine for one already-allocated numeric game version. It owns
 * immutable file writes, manifest-last commit ordering and publication state, but knows nothing
 * about publisher authority, USER review, visibility or live-version activation.
 */
export class GamePublicationService {
  constructor(
    private readonly versions: GameVersionPublicationRepository,
    private readonly storage: GameBundleStorageRepository,
    private readonly archives?: BundleArchiveReader,
  ) {}

  prepare(archive: ArrayBuffer): PreparedBundle {
    if (!this.archives) throw new Error("Bundle archive reader is not configured");
    return prepareBundleFromArchive(this.archives, archive);
  }

  /** Validated ZIP decoding for a partial content package. Unlike prepare(), this deliberately
   * does not require index.html; the caller must enforce a narrower file allowlist. */
  prepareArchiveFiles(archive: ArrayBuffer) {
    if (!this.archives) throw new Error("Bundle archive reader is not configured");
    const metadata = this.archives.readMetadata(archive);
    validateBundleEntryMetadata(metadata);
    return prepareArchiveFileEntries(this.archives.read(archive));
  }

  async publish(
    input: GamePublicationTarget & {
      prepared: PreparedBundle;
      publishedAt: string;
    },
  ): Promise<GamePublicationFacts> {
    const target: GamePublicationTarget = {
      gameId: input.gameId,
      versionId: input.versionId,
      contentHash: input.contentHash,
    };
    assertPublicationTarget(target);
    await this.versions.markPublishing(target);

    try {
      for (const file of input.prepared.files) {
        await this.storage.putObject({
          key: publishedObjectKey(target.gameId, target.versionId, file.path),
          bytes: file.bytes,
          contentType: file.contentType,
          contentEncoding: file.contentEncoding,
        });
      }

      const manifest = buildBundleManifest({
        gameId: target.gameId,
        versionId: target.versionId,
        contentHash: target.contentHash,
        prepared: input.prepared,
        publishedAt: input.publishedAt,
      });
      const facts: GamePublicationFacts = {
        publishedAt: input.publishedAt,
        manifestKey: publishedManifestObjectKey(target.gameId, target.versionId),
        publishedSizeBytes: manifest.totalSize,
        fileCount: manifest.fileCount,
      };
      await this.storage.putObject({
        key: facts.manifestKey,
        bytes: new TextEncoder().encode(JSON.stringify(manifest)),
        contentType: "application/json; charset=utf-8",
      });
      await this.versions.markReady(target, facts);
      return facts;
    } catch (error) {
      await this.recordFailure(target, error);
      throw error;
    }
  }

  /** Used by a control plane when a pre/post-publication step fails outside the bundle engine. */
  async recordFailure(target: GamePublicationTarget, error: unknown): Promise<void> {
    await this.versions.markFailed(target, describePublicationFailure(error)).catch(() => {});
  }

  async readManifest(manifestKey: string | null): Promise<SandboxGameBundleManifest | null> {
    if (!manifestKey) return null;
    const bytes = await this.storage.getObject(manifestKey);
    if (!bytes) return null;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      return isValidSandboxGameBundleManifest(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** Marker persisted after every published object for a version has been removed. A control
   * plane may safely retry deletion after a later D1/source-object failure without needing the
   * already-deleted manifest again. */
  static readonly PUBLISHED_OBJECTS_DELETED = "published objects deleted";

  /** Generic GC primitive; source archive lifecycle remains a control-plane concern. READY
   * versions enumerate objects from the publication manifest. A failed/interrupted publication
   * may not have committed that manifest, so the immutable source ZIP is the deterministic
   * fallback for discovering every possible per-version object key without bucket listing. */
  async deletePublishedVersion(
    input: GamePublicationTarget & {
      manifestKey: string | null;
      sourceObjectKey: string;
      publishStatus: "UPLOADED" | "PUBLISHING" | "READY" | "FAILED";
      publishError: string | null;
    },
  ): Promise<number> {
    assertPublicationTarget(input);
    if (
      input.publishStatus === "FAILED" &&
      input.publishError === GamePublicationService.PUBLISHED_OBJECTS_DELETED
    ) {
      return 0;
    }

    const manifest = await this.readManifest(input.manifestKey);
    if (
      manifest &&
      (manifest.gameId !== input.gameId ||
        manifest.versionId !== input.versionId ||
        manifest.contentHash !== input.contentHash)
    ) {
      throw new Error("Published manifest does not match deletion target");
    }

    let paths = manifest?.files.map((file) => file.path) ?? null;
    if (paths === null && input.publishStatus !== "UPLOADED") {
      const source = await this.storage.getObject(input.sourceObjectKey);
      if (!source) {
        throw new Error("Cannot enumerate published objects without a manifest or source archive");
      }
      paths = this.prepare(source).files.map((file) => file.path);
    }

    let deletedObjectCount = 0;
    for (const path of paths ?? []) {
      await this.storage.deleteObject(publishedObjectKey(input.gameId, input.versionId, path));
      deletedObjectCount++;
    }
    if (input.manifestKey) {
      await this.storage.deleteObject(input.manifestKey);
      deletedObjectCount++;
    }
    await this.versions.markGarbageCollected(
      input,
      GamePublicationService.PUBLISHED_OBJECTS_DELETED,
    );
    return deletedObjectCount;
  }
}

function assertPublicationTarget(target: GamePublicationTarget): void {
  if (
    !Number.isInteger(target.gameId) ||
    target.gameId <= 0 ||
    !Number.isInteger(target.versionId) ||
    target.versionId <= 0 ||
    !isSha256ContentHash(target.contentHash)
  ) {
    throw new Error("Invalid game publication target");
  }
}

/** Deterministic and free of provider request details, signed URLs, object bytes or credentials. */
export function describePublicationFailure(error: unknown): string {
  if (error instanceof SandboxBundleRejectionError) return error.code;
  return `bundle publication failed (${error instanceof Error ? error.name : "unknown error"})`;
}
