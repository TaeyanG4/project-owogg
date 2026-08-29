import test from "node:test";
import assert from "node:assert/strict";
import {
  ComposedRuntimeGameRegistry,
  GAME_CANONICAL_SCHEMA_VERSION,
  RuntimeGameAvailability,
  type GameCanonicalDocument,
  type GameCanonicalRepository,
  type GameIdentity,
  type GameIdentityRepository,
  type GameVersion,
  type GameVersionRepository,
} from "../src/index.js";

function identity(
  id: number,
  slug: string,
  publisher: GameIdentity["publisher"],
  overrides: Partial<GameIdentity> = {},
): GameIdentity {
  return {
    id,
    slug,
    publisher,
    visibility: "PUBLIC",
    liveVersionId: id + 100,
    deletedAt: null,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

function version(gameId: number, overrides: Partial<GameVersion> = {}): GameVersion {
  const id = gameId + 100;
  return {
    id,
    gameId,
    objectKey: `uploads/${gameId}/hash.zip`,
    contentHash: `hash-${gameId}`,
    bundleBytes: 100,
    publishStatus: "READY",
    publishError: null,
    publishedAt: "2026-08-21T00:00:00.000Z",
    manifestKey: `games/${gameId}/${id}/.owogg-manifest.json`,
    publishedSizeBytes: 200,
    fileCount: 2,
    uploadedAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

function requiredLiveVersionId(game: GameIdentity): number {
  if (game.liveVersionId === null) throw new Error(`Expected ${game.slug} to have a live version`);
  return game.liveVersionId;
}

function canonical(slug: string, catalog: GameCanonicalDocument["catalog"]): GameCanonicalDocument {
  return {
    schemaVersion: GAME_CANONICAL_SCHEMA_VERSION,
    slug,
    title: slug,
    shortDescription: `${slug} short`,
    description: `${slug} description`,
    publisher: { official: false },
    policy: {
      score: { unit: "points", direction: "desc", min: 0, max: 1000 },
      leaderboard: true,
      xpPerCompletion: 10,
      requiresAuth: false,
    },
    supportsReplay: false,
    catalog,
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
}

class IdentityRepo implements GameIdentityRepository {
  constructor(readonly rows: GameIdentity[]) {}
  async findById(id: number) {
    return this.rows.find((row) => row.id === id) ?? null;
  }
  async findBySlug(slug: string) {
    return this.rows.find((row) => row.slug === slug) ?? null;
  }
  async listAll() {
    return this.rows;
  }
}

class VersionRepo implements GameVersionRepository {
  constructor(readonly rows: GameVersion[]) {}
  async findById(id: number) {
    return this.rows.find((row) => row.id === id) ?? null;
  }
  async listByGameId(gameId: number) {
    return this.rows.filter((row) => row.gameId === gameId);
  }
  async findForGame(gameId: number, versionId: number) {
    return this.rows.find((row) => row.gameId === gameId && row.id === versionId) ?? null;
  }
}

class CanonicalRepo implements GameCanonicalRepository {
  constructor(readonly rows: Map<string, GameCanonicalDocument | Error>) {}
  async findBySlug(slug: string) {
    const value = this.rows.get(slug);
    if (value instanceof Error) throw value;
    return value ?? null;
  }
  async save(document: GameCanonicalDocument) {
    this.rows.set(document.slug, document);
  }
  async delete(slug: string) {
    this.rows.delete(slug);
  }
}

test("OWOGG and USER resolve through the same generic D1+B2 composition without publisher/catalog coupling", async () => {
  const official = identity(1, "official-genre", { type: "OWOGG" });
  const user = identity(2, "user-taxonomy", { type: "USER", userId: 42 });
  const registry = new ComposedRuntimeGameRegistry(
    new IdentityRepo([official, user]),
    new VersionRepo([version(official.id), version(user.id)]),
    new CanonicalRepo(
      new Map([
        [
          official.slug,
          canonical(official.slug, { type: "GENRE_MODE", genre: "arcade", mode: "single" }),
        ],
        [
          user.slug,
          canonical(user.slug, {
            type: "TAXONOMY",
            categories: ["skill"],
            tags: ["fast"],
            modes: ["single"],
            inputMethods: ["mouse"],
            minPlayers: 1,
            maxPlayers: 1,
            thumbnail: "/thumbnail.svg",
          }),
        ],
      ]),
    ),
  );

  assert.equal((await registry.findBySlug(official.slug))?.identity.publisher.type, "OWOGG");
  assert.equal((await registry.findBySlug(official.slug))?.canonical.catalog.type, "GENRE_MODE");
  assert.equal((await registry.findBySlug(user.slug))?.identity.publisher.type, "USER");
  assert.equal((await registry.findBySlug(user.slug))?.canonical.catalog.type, "TAXONOMY");
});

test("private, deleted, no-live, non-READY, and wrong-game live versions all fail closed", async () => {
  const rows = [
    identity(1, "private", { type: "OWOGG" }, { visibility: "PRIVATE" }),
    identity(2, "deleted", { type: "OWOGG" }, { deletedAt: "2026-08-21T00:00:00.000Z" }),
    identity(3, "no-live", { type: "USER", userId: 3 }, { liveVersionId: null }),
    identity(4, "not-ready", { type: "USER", userId: 4 }),
    identity(5, "wrong-owner", { type: "OWOGG" }),
  ];
  const wrongOwner = rows[4];
  if (!wrongOwner) throw new Error("wrong-owner fixture missing");
  const versions = [
    version(4, { publishStatus: "PUBLISHING" }),
    version(99, { id: requiredLiveVersionId(wrongOwner) }),
  ];
  const documents = new Map(
    rows.map((row) => [
      row.slug,
      canonical(row.slug, { type: "GENRE_MODE", genre: "arcade", mode: "single" }),
    ]),
  );
  const registry = new ComposedRuntimeGameRegistry(
    new IdentityRepo(rows),
    new VersionRepo(versions),
    new CanonicalRepo(documents),
  );

  for (const row of rows) assert.equal(await registry.findBySlug(row.slug), null, row.slug);
});

test("missing, malformed, or storage-failed canonical state is unavailable with no fallback", async () => {
  const game = identity(1, "canonical-test", { type: "OWOGG" });
  const identities = new IdentityRepo([game]);
  const versions = new VersionRepo([version(game.id)]);

  const missing = new ComposedRuntimeGameRegistry(
    identities,
    versions,
    new CanonicalRepo(new Map()),
  );
  assert.equal(await missing.findBySlug(game.slug), null);

  const failed = new ComposedRuntimeGameRegistry(
    identities,
    versions,
    new CanonicalRepo(new Map([[game.slug, new Error("malformed")]])),
  );
  assert.equal(await failed.findBySlug(game.slug), null);

  const malformed = canonical(game.slug, {
    type: "GENRE_MODE",
    genre: "arcade",
    mode: "single",
  }) as unknown as Record<string, unknown>;
  malformed.slug = "different-slug";
  const malformedRegistry = new ComposedRuntimeGameRegistry(
    identities,
    versions,
    new CanonicalRepo(new Map([[game.slug, malformed as unknown as GameCanonicalDocument]])),
  );
  assert.equal(await malformedRegistry.findBySlug(game.slug), null);
});

test("public catalog resolves independent live versions and canonicals concurrently", async () => {
  const first = identity(1, "first", { type: "OWOGG" });
  const second = identity(2, "second", { type: "OWOGG" });
  const started: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const canonicals: GameCanonicalRepository = {
    async findBySlug(slug) {
      started.push(slug);
      await gate;
      return canonical(slug, { type: "GENRE_MODE", genre: "arcade", mode: "single" });
    },
    async save() {},
    async delete() {},
  };
  const registry = new ComposedRuntimeGameRegistry(
    new IdentityRepo([first, second]),
    new VersionRepo([version(first.id), version(second.id)]),
    canonicals,
  );

  const pending = registry.listPublic();
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(
      started,
      ["first", "second"],
      "a slow first B2 object must not block every later canonical read",
    );
  } finally {
    release();
  }
  assert.deepEqual(
    (await pending).map((runtime) => runtime.identity.slug),
    ["first", "second"],
  );
});

test("exact-version availability serves a non-live READY version only while its room lease is active", async () => {
  const official = identity(1, "official", { type: "OWOGG" });
  const user = identity(2, "user", { type: "USER", userId: 7 });
  const versionRows = [version(official.id), version(user.id)];
  const disabled = new Set<string>();
  const leasedVersions = new Set<number>();
  const availability = new RuntimeGameAvailability(
    new IdentityRepo([official, user]),
    new VersionRepo(versionRows),
    {
      async getDisabledGameIds() {
        return [...disabled];
      },
    },
    {
      async hasActiveVersionLease(gameVersionId) {
        return leasedVersions.has(gameVersionId);
      },
    },
  );

  const officialVersionId = requiredLiveVersionId(official);
  const userVersionId = requiredLiveVersionId(user);
  assert.equal(await availability.isVersionServable(official.id, officialVersionId), true);
  assert.equal(await availability.isVersionServable(user.id, userVersionId), true);
  assert.equal(await availability.isVersionServable(official.id, 999), false);

  const previousVersionId = 501;
  versionRows.push(version(official.id, { id: previousVersionId }));
  assert.equal(await availability.isVersionServable(official.id, previousVersionId), false);
  leasedVersions.add(previousVersionId);
  assert.equal(await availability.isVersionServable(official.id, previousVersionId), true);
  leasedVersions.delete(previousVersionId);
  assert.equal(await availability.isVersionServable(official.id, previousVersionId), false);

  versionRows[0] = version(99, { id: officialVersionId });
  assert.equal(await availability.isVersionServable(official.id, officialVersionId), false);
  versionRows[0] = version(official.id, { publishStatus: "FAILED" });
  assert.equal(await availability.isVersionServable(official.id, officialVersionId), false);
  versionRows[0] = version(official.id);
  disabled.add(official.slug);
  assert.equal(await availability.isVersionServable(official.id, officialVersionId), false);
});

test("resolved catalog availability reads the kill switch once without repeating identity/version queries", async () => {
  const official = identity(1, "official", { type: "OWOGG" });
  const user = identity(2, "user", { type: "USER", userId: 7 });
  let identityReads = 0;
  let versionReads = 0;
  let settingsReads = 0;
  const availability = new RuntimeGameAvailability(
    {
      async findById() {
        identityReads += 1;
        return null;
      },
      async findBySlug() {
        identityReads += 1;
        return null;
      },
      async listAll() {
        identityReads += 1;
        return [];
      },
    },
    {
      async findById() {
        versionReads += 1;
        return null;
      },
      async listByGameId() {
        versionReads += 1;
        return [];
      },
      async findForGame() {
        versionReads += 1;
        return null;
      },
    },
    {
      async getDisabledGameIds() {
        settingsReads += 1;
        return [user.slug];
      },
    },
  );
  const resolved = [
    {
      identity: official,
      liveVersion: version(official.id),
      canonical: canonical(official.slug, {
        type: "GENRE_MODE",
        genre: "arcade",
        mode: "single",
      }),
    },
    {
      identity: user,
      liveVersion: version(user.id),
      canonical: canonical(user.slug, {
        type: "GENRE_MODE",
        genre: "arcade",
        mode: "single",
      }),
    },
  ];

  const available = await availability.filterResolvedRuntimes(resolved);
  assert.deepEqual(
    available.map((runtime) => runtime.identity.slug),
    [official.slug],
  );
  assert.equal(settingsReads, 1);
  assert.equal(identityReads, 0);
  assert.equal(versionReads, 0);
});
