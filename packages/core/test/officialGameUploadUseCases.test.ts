import assert from "node:assert/strict";
import test from "node:test";
import {
  GamePublicationService,
  OfficialGameDeleteFailure,
  OfficialGameLifecycleUseCases,
  OfficialGameUploadFailure,
  OfficialGameUploadUseCases,
  type BundleArchiveReader,
  type GameBundleStorageRepository,
  type GameCanonicalDocument,
  type GameCanonicalRepository,
  type GameIdentity,
  type GamePublicationFacts,
  type GamePublicationTarget,
  type GameVersion,
  type OfficialGameUploadRepository,
  type OfficialGameDeletionPlan,
  type OfficialGameLifecycleRepository,
} from "../src/index.js";

const encoder = new TextEncoder();

class FakeStorage implements GameBundleStorageRepository {
  readonly objects = new Map<string, Uint8Array>();
  async putObject(input: { key: string; bytes: ArrayBuffer | Uint8Array }): Promise<void> {
    const bytes =
      input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes.slice(0));
    this.objects.set(input.key, bytes);
  }
  async getObject(key: string): Promise<ArrayBuffer | null> {
    const bytes = this.objects.get(key);
    return bytes ? bytes.slice().buffer : null;
  }
  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

class FakeCanonicals implements GameCanonicalRepository {
  document: GameCanonicalDocument | null = null;
  async findBySlug(slug: string): Promise<GameCanonicalDocument | null> {
    return this.document?.slug === slug ? this.document : null;
  }
  async save(document: GameCanonicalDocument): Promise<void> {
    this.document = document;
  }
  async delete(slug: string): Promise<void> {
    if (this.document?.slug === slug) this.document = null;
  }
}

class FakeOfficialLifecycleRepository implements OfficialGameLifecycleRepository {
  purged = false;
  failPurgeOnce = false;
  constructor(public plan: OfficialGameDeletionPlan | null) {}
  async prepareDeletion(): Promise<OfficialGameDeletionPlan | null> {
    return this.plan;
  }
  async purgeDeletion(): Promise<void> {
    if (this.failPurgeOnce) {
      this.failPurgeOnce = false;
      throw new Error("D1 purge failed");
    }
    this.purged = true;
  }
}

class FakeOfficialRepository implements OfficialGameUploadRepository {
  readonly identity: GameIdentity = {
    id: 7,
    slug: "admin-game",
    publisher: { type: "OWOGG" },
    visibility: "PRIVATE",
    liveVersionId: null,
    deletedAt: null,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
  };
  version: GameVersion | null = null;
  logoKey: string | null = null;
  activated: { versionId: number; canonical: GameCanonicalDocument } | null = null;
  ensureFailure: "conflict" | "outage" | null = null;

  async ensureOwoggIdentity(input: { slug: string }): Promise<GameIdentity | null> {
    if (this.ensureFailure === "conflict" || input.slug !== this.identity.slug) return null;
    if (this.ensureFailure === "outage") throw new Error("D1 unavailable");
    return this.identity;
  }
  async findVersionByContentHash(): Promise<GameVersion | null> {
    return this.version;
  }
  async createVersion(input: {
    gameId: number;
    objectKey: string;
    contentHash: string;
    bundleBytes: number;
    nowIso: string;
  }): Promise<GameVersion> {
    this.version = {
      id: 11,
      gameId: input.gameId,
      objectKey: input.objectKey,
      contentHash: input.contentHash,
      bundleBytes: input.bundleBytes,
      publishStatus: "UPLOADED",
      publishError: null,
      publishedAt: null,
      manifestKey: null,
      publishedSizeBytes: null,
      fileCount: null,
      uploadedAt: input.nowIso,
    };
    return this.version;
  }
  async markPublishing(): Promise<void> {
    if (!this.version) throw new Error("missing version");
    this.version = { ...this.version, publishStatus: "PUBLISHING" };
  }
  async markReady(_target: GamePublicationTarget, facts: GamePublicationFacts): Promise<void> {
    if (!this.version) throw new Error("missing version");
    this.version = {
      ...this.version,
      publishStatus: "READY",
      publishedAt: facts.publishedAt,
      manifestKey: facts.manifestKey,
      publishedSizeBytes: facts.publishedSizeBytes,
      fileCount: facts.fileCount,
    };
  }
  async markFailed(): Promise<void> {
    if (this.version) this.version = { ...this.version, publishStatus: "FAILED" };
  }
  async markGarbageCollected(_target: GamePublicationTarget, marker: string): Promise<void> {
    if (!this.version) throw new Error("missing version");
    this.version = {
      ...this.version,
      publishStatus: "FAILED",
      publishError: marker,
      publishedAt: null,
      manifestKey: null,
      publishedSizeBytes: null,
      fileCount: null,
    };
  }
  async upsertLogo(input: { objectKey: string }): Promise<void> {
    this.logoKey = input.objectKey;
  }
  async activate(input: { versionId: number; canonical: GameCanonicalDocument }): Promise<void> {
    this.activated = { versionId: input.versionId, canonical: input.canonical };
  }
}

const files = {
  "index.html": encoder.encode("<html>game</html>"),
  "owogg.logo.svg": encoder.encode("<svg/>"),
  "owogg.json": encoder.encode(
    JSON.stringify({
      schemaVersion: 1,
      game: {
        slug: "admin-game",
        title: "관리자 게임",
        shortDescription: "설명",
        description: "OWOGG 관리자 업로드 테스트",
        genre: "arcade",
        mode: "single",
      },
      progression: { type: "none" },
      result: { score: null },
    }),
  ),
};

const archives: BundleArchiveReader = {
  readMetadata: () =>
    Object.entries(files).map(([path, bytes]) => ({
      path,
      declaredSize: bytes.byteLength,
      compressedSize: bytes.byteLength,
    })),
  read: () => files,
};

test("admin upload publishes one OWOGG D1/B2 game and ignores archive authority spoofing", async () => {
  const repository = new FakeOfficialRepository();
  const storage = new FakeStorage();
  const canonicals = new FakeCanonicals();
  const publication = new GamePublicationService(repository, storage, archives);
  const useCases = new OfficialGameUploadUseCases(repository, storage, canonicals, publication);

  const result = await useCases.upload({ bytes: new Uint8Array([1, 2, 3]).buffer });

  assert.equal(result.publisherName, "OWOGG");
  assert.equal(result.slug, "admin-game");
  assert.equal(canonicals.document?.publisher.official, true);
  assert.equal(repository.activated?.versionId, 11);
  assert.equal(repository.activated?.canonical.publisher.official, true);
  assert.equal(repository.logoKey, "games/7/logo.svg");
  assert.ok([...storage.objects.keys()].some((key) => key.startsWith("uploads/7/")));
  assert.ok(storage.objects.has("games/7/11/index.html"));
  assert.ok(storage.objects.has("games/7/11/.owogg-manifest.json"));
  assert.ok(storage.objects.has("games/7/logo.svg"));
});

test("admin upload distinguishes a real slug conflict from a D1 publication failure", async () => {
  const createUseCases = (repository: FakeOfficialRepository) => {
    const storage = new FakeStorage();
    const publication = new GamePublicationService(repository, storage, archives);
    return new OfficialGameUploadUseCases(repository, storage, new FakeCanonicals(), publication);
  };

  const conflict = new FakeOfficialRepository();
  conflict.ensureFailure = "conflict";
  await assert.rejects(
    createUseCases(conflict).upload({ bytes: new Uint8Array([1]).buffer }),
    (error) => {
      assert.ok(error instanceof OfficialGameUploadFailure);
      assert.equal(error.code, "SLUG_CONFLICT");
      return true;
    },
  );

  const outage = new FakeOfficialRepository();
  outage.ensureFailure = "outage";
  await assert.rejects(
    createUseCases(outage).upload({ bytes: new Uint8Array([1]).buffer }),
    (error) => {
      assert.ok(error instanceof OfficialGameUploadFailure);
      assert.equal(error.code, "PUBLISH_FAILED");
      return true;
    },
  );
});

test("official deletion removes published files, source ZIP, logo and canonical before D1 purge", async () => {
  const uploadRepository = new FakeOfficialRepository();
  const storage = new FakeStorage();
  const canonicals = new FakeCanonicals();
  const publication = new GamePublicationService(uploadRepository, storage, archives);
  const upload = new OfficialGameUploadUseCases(uploadRepository, storage, canonicals, publication);
  await upload.upload({ bytes: new Uint8Array([1, 2, 3]).buffer });
  assert.ok(uploadRepository.version);

  const lifecycleRepository = new FakeOfficialLifecycleRepository({
    gameId: uploadRepository.identity.id,
    slug: uploadRepository.identity.slug,
    versions: [uploadRepository.version],
    assetObjectKeys: [uploadRepository.logoKey!],
  });
  const lifecycle = new OfficialGameLifecycleUseCases(
    lifecycleRepository,
    storage,
    canonicals,
    publication,
  );
  const result = await lifecycle.deleteGame({ slug: "admin-game", actorAdminId: 1 });

  assert.equal(result.deletedVersionCount, 1);
  assert.equal(lifecycleRepository.purged, true);
  assert.equal(canonicals.document, null);
  assert.deepEqual([...storage.objects.keys()], []);
});

test("official deletion leaves D1 quarantined and reports a retryable storage failure", async () => {
  const lifecycleRepository = new FakeOfficialLifecycleRepository({
    gameId: 7,
    slug: "admin-game",
    versions: [
      {
        id: 11,
        gameId: 7,
        objectKey: "uploads/7/missing.zip",
        contentHash: "a".repeat(64),
        bundleBytes: 1,
        publishStatus: "READY",
        publishError: null,
        publishedAt: "2026-08-23T00:00:00.000Z",
        manifestKey: "games/7/11/.owogg-manifest.json",
        publishedSizeBytes: 1,
        fileCount: 1,
        uploadedAt: "2026-08-23T00:00:00.000Z",
      },
    ],
    assetObjectKeys: [],
  });
  const publicationRepository = new FakeOfficialRepository();
  const storage = new FakeStorage();
  const lifecycle = new OfficialGameLifecycleUseCases(
    lifecycleRepository,
    storage,
    new FakeCanonicals(),
    new GamePublicationService(publicationRepository, storage, archives),
  );

  await assert.rejects(lifecycle.deleteGame({ slug: "admin-game", actorAdminId: 1 }), (error) => {
    assert.ok(error instanceof OfficialGameDeleteFailure);
    assert.equal(error.code, "STORAGE_DELETE_FAILED");
    return true;
  });
  assert.equal(lifecycleRepository.purged, false);
});

test("official deletion can retry after B2 cleanup succeeded but the final D1 purge failed", async () => {
  const uploadRepository = new FakeOfficialRepository();
  const storage = new FakeStorage();
  const canonicals = new FakeCanonicals();
  const publication = new GamePublicationService(uploadRepository, storage, archives);
  await new OfficialGameUploadUseCases(uploadRepository, storage, canonicals, publication).upload({
    bytes: new Uint8Array([1, 2, 3]).buffer,
  });
  assert.ok(uploadRepository.version);

  const lifecycleRepository = new FakeOfficialLifecycleRepository({
    gameId: uploadRepository.identity.id,
    slug: uploadRepository.identity.slug,
    versions: [uploadRepository.version],
    assetObjectKeys: [uploadRepository.logoKey!],
  });
  lifecycleRepository.failPurgeOnce = true;
  const lifecycle = new OfficialGameLifecycleUseCases(
    lifecycleRepository,
    storage,
    canonicals,
    publication,
  );

  await assert.rejects(lifecycle.deleteGame({ slug: "admin-game", actorAdminId: 1 }), (error) => {
    assert.ok(error instanceof OfficialGameDeleteFailure);
    assert.equal(error.code, "DATABASE_DELETE_FAILED");
    return true;
  });
  assert.equal(uploadRepository.version?.publishError, "published objects deleted");
  assert.deepEqual([...storage.objects.keys()], []);

  lifecycleRepository.plan = {
    gameId: uploadRepository.identity.id,
    slug: uploadRepository.identity.slug,
    versions: [uploadRepository.version!],
    assetObjectKeys: [uploadRepository.logoKey!],
  };
  const retried = await lifecycle.deleteGame({ slug: "admin-game", actorAdminId: 1 });
  assert.equal(retried.deletedVersionCount, 1);
  assert.equal(lifecycleRepository.purged, true);
});
