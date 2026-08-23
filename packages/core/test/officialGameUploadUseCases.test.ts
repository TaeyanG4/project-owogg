import assert from "node:assert/strict";
import test from "node:test";
import {
  GamePublicationService,
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
