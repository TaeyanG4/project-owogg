import {
  findGameLogoFile,
  sandboxGameLogoObjectKey,
  sourceArchiveObjectKey,
  type PreparedBundle,
} from "../domain/sandboxGameBundle.js";
import { extractGameCreatorManifest } from "../domain/gameCreatorManifest.js";
import { mapGameCreatorManifestToCanonical } from "../domain/gameCreatorManifestCanonical.js";
import { SANDBOX_GAME_POLICY } from "../domain/sandboxGames.js";
import type { GameCanonicalDocument } from "../modules/game/domain/gameCanonicalDocument.js";
import type { GameIdentity } from "../modules/game/domain/gameIdentity.js";
import type { GameVersion } from "../modules/game/domain/gameVersion.js";
import type { GameCanonicalRepository } from "../modules/game/ports/gameCanonicalRepository.js";
import type {
  GamePublicationFacts,
  GamePublicationTarget,
  GameVersionPublicationRepository,
} from "../modules/game/ports/gameVersionPublicationRepository.js";
import type { GameBundleStorageRepository } from "../ports/sandboxGames.js";
import { GamePublicationService } from "./gamePublicationService.js";

export const OFFICIAL_GAME_UPLOAD_FAILURES = [
  "BUNDLE_EMPTY",
  "BUNDLE_TOO_LARGE",
  "BUNDLE_INVALID",
  "MANIFEST_MISSING",
  "MANIFEST_INVALID",
  "LOGO_REQUIRED",
  "LOGO_TOO_LARGE",
  "SLUG_CONFLICT",
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
  /** Returns null only when the slug already belongs to USER or a deleted identity. Infrastructure
   * failures must throw so callers do not misreport an outage as a user-correctable conflict. */
  ensureOwoggIdentity(input: { slug: string; nowIso: string }): Promise<GameIdentity | null>;
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
  }): Promise<void>;
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
  ) {}

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
}

/** Permanently removes an OWOGG game from both B2 and D1 so the same slug can be registered as a
 * new identity. D1 quarantine happens first, making play and score submission fail closed while
 * B2 cleanup runs. Every storage delete is idempotent, so a partial failure is safe to retry. */
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

    try {
      await this.repository.purgeDeletion({
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
    };
  }
}

// Re-exported only for persistence adapters implementing the publication transition port.
export type { GamePublicationFacts, GamePublicationTarget };
