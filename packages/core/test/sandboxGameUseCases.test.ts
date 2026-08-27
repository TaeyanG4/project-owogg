import test from "node:test";
import assert from "node:assert/strict";
import {
  SandboxGameUseCases,
  SandboxGameUseCaseFailure,
} from "../src/application/sandboxGameUseCases.js";
import { GamePublicationService } from "../src/application/gamePublicationService.js";
import { SandboxGameVersionPublicationRepository } from "../src/application/sandboxGameVersionPublicationRepository.js";
import type {
  SandboxGameRepository,
  SandboxGameRecord,
  SandboxGameVersionRecord,
  SandboxGameMetadataInput,
  SandboxGamePublishStatus,
  GameBundleStorageRepository,
  BundleArchiveReader,
  BundleArchiveWriter,
} from "../src/ports/sandboxGames.js";
import { SANDBOX_GAME_POLICY } from "../src/domain/sandboxGames.js";
import type { SandboxGameBundleManifest } from "../src/domain/sandboxGameBundle.js";
import { OWOGG_GAME_CREATOR_MANIFEST_FILENAME } from "../src/domain/gameCreatorManifest.js";
import type { GameCanonicalRepository } from "../src/modules/game/ports/gameCanonicalRepository.js";
import type {
  MultiplayerProfileRequestRecord,
  MultiplayerProfileRequestRepository,
  SubmitMultiplayerProfileRequestInput,
} from "../src/modules/multiplayer/ports/multiplayerProfileRequestRepository.js";
import {
  GAME_CANONICAL_SCHEMA_VERSION,
  parseGameCanonicalDocument,
  serializeGameCanonicalDocument,
  type GameCanonicalDocument,
} from "../src/modules/game/domain/gameCanonicalDocument.js";

// The zip container format itself is an infrastructure detail behind the BundleArchiveReader port,
// so these tests inject archive *contents* directly. Real zip bytes (and therefore fflate) are
// exercised end to end in apps/api/test/gameServing.test.ts and publishPipeline.test.ts.
function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const MINIMAL_BUNDLE: Record<string, Uint8Array> = {
  "index.html": bytes("<h1>hi</h1>"),
  "Build/game.wasm": bytes("\0asm fake"),
};

function creatorManifestBytes(game: Record<string, unknown>): Uint8Array {
  return bytes(
    JSON.stringify({
      schemaVersion: 1,
      game,
      progression: { type: "none" },
      result: { score: null },
    }),
  );
}

function multiplayerCreatorManifestBytes(slug = "my-game"): Uint8Array {
  return bytes(
    JSON.stringify({
      $schema: "https://owogg.com/schemas/manifest/v2.json",
      schemaVersion: 2,
      game: {
        slug,
        title: "Online Grid",
        genre: "board",
        mode: "multi",
        playModes: ["online-multi"],
      },
      progression: { type: "none" },
      result: { score: null },
      leaderboard: { enabled: false },
      multiplayer: {
        requestVersion: 1,
        kind: "managed-template",
        template: { id: "turn-grid", version: 1 },
        players: { min: 2, max: 2 },
        requirements: {
          simulation: "turn",
          lifecycle: "match",
          persistence: "match",
          latency: "relaxed",
          reconnect: "resume",
          hiddenInformation: false,
          simultaneousResponse: false,
          joinInProgress: false,
          spectators: false,
        },
        config: { boardWidth: 15, boardHeight: 15, winLength: 5 },
        client: { protocolVersion: 1 },
      },
    }),
  );
}

const VERSION_BUNDLE: Record<string, Uint8Array> = {
  ...MINIMAL_BUNDLE,
  [OWOGG_GAME_CREATOR_MANIFEST_FILENAME]: creatorManifestBytes({
    slug: "my-game",
    title: "Game",
    genre: "puzzle",
    mode: "single",
  }),
};

function createFakeArchiveReader(
  entries: Record<string, Uint8Array> = VERSION_BUNDLE,
): BundleArchiveReader & {
  entries: Record<string, Uint8Array>;
  malformed: boolean;
  /** When set, readMetadata() reports these declared sizes instead of the real entry byte
   * lengths — lets a test simulate an archive whose central directory claims a huge decompressed
   * size while never actually materializing bytes that large (see the zip-bomb preflight test). */
  declaredSizeOverride: Record<string, number> | null;
  /** When set, readMetadata() reports these compressed sizes instead of matching declaredSize 1:1
   * — lets a test exercise the compression-ratio guard specifically (as opposed to the flat
   * total-size cap), which a 1:1 ratio would never trigger. */
  compressedSizeOverride: Record<string, number> | null;
  readCalls: number;
} {
  return {
    entries,
    malformed: false,
    declaredSizeOverride: null,
    compressedSizeOverride: null,
    readCalls: 0,
    readMetadata() {
      if (this.malformed) throw new Error("not a zip");
      return Object.entries(this.entries).map(([path, bytes]) => {
        const declaredSize = this.declaredSizeOverride?.[path] ?? bytes.byteLength;
        return {
          path,
          declaredSize,
          // Defaults to matching declaredSize (a 1:1, always-plausible ratio) so tests that don't
          // care about the ratio guard never trip it by accident.
          compressedSize: this.compressedSizeOverride?.[path] ?? declaredSize,
        };
      });
    },
    read() {
      this.readCalls++;
      if (this.malformed) throw new Error("not a zip");
      return this.entries;
    },
  };
}

function createFakeRepo(): SandboxGameRepository & {
  games: Map<number, SandboxGameRecord>;
  versions: Map<number, SandboxGameVersionRecord>;
  auditActions: string[];
  reservedSlugs: Set<string>;
} {
  const games = new Map<number, SandboxGameRecord>();
  const versions = new Map<number, SandboxGameVersionRecord>();
  const auditActions: string[] = [];
  const reservedSlugs = new Set<string>();
  let nextGameId = 1;
  let nextVersionId = 1;

  return {
    games,
    versions,
    auditActions,
    reservedSlugs,
    async findById(id) {
      return games.get(id) ?? null;
    },
    async findBySlug(slug) {
      return [...games.values()].find((g) => g.slug === slug) ?? null;
    },
    async slugExists(slug) {
      return reservedSlugs.has(slug) || [...games.values()].some((g) => g.slug === slug);
    },
    async listByDeveloper(developerUserId) {
      return [...games.values()].filter((g) => g.developerUserId === developerUserId);
    },
    async listAll() {
      return [...games.values()];
    },
    async listAllPage(limit, offset) {
      const entries = [...games.values()]
        .slice(offset, offset + limit)
        .map((game) => ({ game, latestUploadedAt: null }));
      return { entries, total: games.size };
    },
    async create(input) {
      // Mirrors D1SandboxGameRepository.create's contract: atomically pick the lowest slot (1 or
      // 2) not already held by this developer, or return null if both are taken. A single-threaded
      // Map can't reproduce the race the real UNIQUE INDEX guards against — that invariant is
      // proven against real SQLite in packages/db/test/D1SandboxGameRepository.test.ts — this only
      // needs to match the *contract* so use-case-level tests can exercise SUBMISSION_LIMIT_REACHED.
      const takenSlots = new Set(
        [...games.values()]
          .filter((g) => g.developerUserId === input.developerUserId && g.reviewSlot !== null)
          .map((g) => g.reviewSlot),
      );
      const slot = !takenSlots.has(1) ? 1 : !takenSlots.has(2) ? 2 : null;
      if (slot === null) return null;

      const id = nextGameId++;
      const record: SandboxGameRecord = {
        id,
        slug: input.slug,
        developerUserId: input.developerUserId,
        title: input.title,
        shortDescription: input.shortDescription,
        description: input.description,
        genre: input.genre,
        mode: input.mode,
        logoKey: null,
        xpPerCompletion: 0,
        scoreUnit: null,
        scoreDirection: null,
        scoreMin: null,
        scoreMax: null,
        scoreDisplayPrefix: null,
        scoreDisplaySuffix: null,
        visibility: "PRIVATE",
        liveVersionId: null,
        reviewSlot: slot,
        deletedAt: null,
        deletedByAdminId: null,
        createdAt: input.nowIso,
        updatedAt: input.nowIso,
      };
      games.set(id, record);
      return record;
    },
    async softDelete(id, deletedByAdminId, nowIso) {
      const existing = games.get(id);
      if (!existing) throw new Error("not found");
      const updated: SandboxGameRecord = {
        ...existing,
        deletedAt: nowIso,
        deletedByAdminId,
        visibility: "PRIVATE",
        updatedAt: nowIso,
      };
      games.set(id, updated);
      return updated;
    },
    async hardDelete(id) {
      games.delete(id);
      for (const [versionId, version] of versions) {
        if (version.gameId === id) versions.delete(versionId);
      }
    },
    async releaseReviewSlot(id, nowIso) {
      const existing = games.get(id);
      if (!existing) throw new Error("not found");
      const updated = { ...existing, reviewSlot: null, updatedAt: nowIso };
      games.set(id, updated);
      return updated;
    },
    async updateMetadata(id, input: SandboxGameMetadataInput, nowIso) {
      const existing = games.get(id);
      if (!existing) throw new Error("not found");
      const updated = { ...existing, ...input, updatedAt: nowIso } as SandboxGameRecord;
      games.set(id, updated);
      return updated;
    },
    async setVisibility(id, visibility, nowIso) {
      const existing = games.get(id);
      if (!existing) throw new Error("not found");
      const updated = { ...existing, visibility, updatedAt: nowIso };
      games.set(id, updated);
      return updated;
    },
    async setLiveVersion(id, versionId, nowIso) {
      const existing = games.get(id);
      if (!existing) throw new Error("not found");
      const updated = { ...existing, liveVersionId: versionId, updatedAt: nowIso };
      games.set(id, updated);
      return updated;
    },
    async setLogo(id, logoKey, nowIso) {
      const existing = games.get(id);
      if (!existing) throw new Error("not found");
      const updated: SandboxGameRecord = { ...existing, logoKey, updatedAt: nowIso };
      games.set(id, updated);
      return updated;
    },
    async clearLiveVersionIfMatches(id, versionId, nowIso) {
      const existing = games.get(id);
      if (!existing) throw new Error("not found");
      if (existing.liveVersionId !== versionId) return existing;
      const updated: SandboxGameRecord = {
        ...existing,
        liveVersionId: null,
        visibility: "PRIVATE",
        updatedAt: nowIso,
      };
      games.set(id, updated);
      return updated;
    },
    async createVersion(input) {
      const id = nextVersionId++;
      const record: SandboxGameVersionRecord = {
        id,
        gameId: input.gameId,
        objectKey: input.objectKey,
        contentHash: input.contentHash,
        bundleBytes: input.bundleBytes,
        status: "PENDING_REVIEW",
        reviewedByAdminId: null,
        reviewedAt: null,
        rejectReason: null,
        uploadedAt: input.nowIso,
        publishStatus: "UPLOADED",
        publishError: null,
        publishedAt: null,
        manifestKey: null,
        publishedSizeBytes: null,
        fileCount: null,
      };
      versions.set(id, record);
      return record;
    },
    async setVersionPublishState(id, state) {
      const existing = versions.get(id);
      if (!existing) throw new Error("not found");
      const updated: SandboxGameVersionRecord = { ...existing, ...state };
      versions.set(id, updated);
      return updated;
    },
    async findVersionById(id) {
      return versions.get(id) ?? null;
    },
    async listVersionsByGame(gameId) {
      return [...versions.values()].filter((v) => v.gameId === gameId);
    },
    async listPendingVersions(limit, offset) {
      const pending = [...versions.values()].filter((v) => v.status === "PENDING_REVIEW");
      return { total: pending.length, versions: pending.slice(offset, offset + limit) };
    },
    async decideVersion(id, status, adminId, reason, nowIso) {
      const existing = versions.get(id);
      if (!existing) throw new Error("not found");
      const updated: SandboxGameVersionRecord = {
        ...existing,
        status,
        reviewedByAdminId: adminId,
        reviewedAt: nowIso,
        rejectReason: reason,
      };
      versions.set(id, updated);
      if (status === "APPROVED") {
        const game = games.get(existing.gameId);
        if (!game) throw new Error("not found");
        reservedSlugs.add(game.slug);
      }
      return updated;
    },
    async revokeVersionApproval(id) {
      const existing = versions.get(id);
      if (!existing) throw new Error("not found");
      const updated: SandboxGameVersionRecord = {
        ...existing,
        status: "PENDING_REVIEW",
        reviewedByAdminId: null,
        reviewedAt: null,
        rejectReason: null,
      };
      versions.set(id, updated);
      return updated;
    },
    async withdrawVersion(id) {
      const existing = versions.get(id);
      if (!existing) throw new Error("not found");
      if (existing.status !== "PENDING_REVIEW") return existing;
      const updated: SandboxGameVersionRecord = { ...existing, status: "WITHDRAWN" };
      versions.set(id, updated);
      return updated;
    },
    async appendReviewAudit(entry) {
      auditActions.push(entry.action);
    },
    async listReviewAudit() {
      return [];
    },
    async isSlugPermanentlyReserved(slug) {
      return reservedSlugs.has(slug);
    },
  };
}

function createFakeStorage(): GameBundleStorageRepository & {
  objects: Map<string, { bytes: Uint8Array; contentType: string; contentEncoding?: string }>;
  putKeys: string[];
  deletedKeys: string[];
  /** When set, a putObject whose key contains this substring throws — used to simulate a publish
   * that dies part-way through, which is the failure mode partial-publish safety exists for. */
  failPutContaining?: string;
} {
  return {
    objects: new Map(),
    putKeys: [],
    deletedKeys: [],
    async putObject(input) {
      if (this.failPutContaining && input.key.includes(this.failPutContaining)) {
        throw new Error(`simulated storage failure for ${input.key}`);
      }
      const raw =
        input.bytes instanceof Uint8Array
          ? input.bytes
          : new Uint8Array(input.bytes as ArrayBuffer);
      this.putKeys.push(input.key);
      this.objects.set(input.key, {
        bytes: raw,
        contentType: input.contentType,
        ...(input.contentEncoding ? { contentEncoding: input.contentEncoding } : {}),
      });
    },
    async getObject(key) {
      const found = this.objects.get(key);
      if (!found) return null;
      return found.bytes.buffer.slice(
        found.bytes.byteOffset,
        found.bytes.byteOffset + found.bytes.byteLength,
      ) as ArrayBuffer;
    },
    async deleteObject(key) {
      this.deletedKeys.push(key);
      this.objects.delete(key);
    },
  };
}

/** In-memory generic canonical repository with the real adapter's validate-before-write contract. */
function createFakeCanonicalRepo(): GameCanonicalRepository & {
  documents: Map<string, GameCanonicalDocument>;
  saveCalls: GameCanonicalDocument[];
  throwOnFindFor?: string;
  throwOnSaveFor?: string;
} {
  return {
    documents: new Map(),
    saveCalls: [],
    async findBySlug(slug) {
      if (this.throwOnFindFor === slug) {
        throw new Error(`simulated malformed/unreadable document at ${slug}`);
      }
      return this.documents.get(slug) ?? null;
    },
    async save(document) {
      if (this.throwOnSaveFor === document.slug) {
        throw new Error(`simulated storage failure saving ${document.slug}`);
      }
      // Throws (INVALID_DOCUMENT etc.) for a semantically-invalid document, before it's ever
      // stored — same as the real adapter.
      parseGameCanonicalDocument(serializeGameCanonicalDocument(document), document.slug);
      this.saveCalls.push(document);
      this.documents.set(document.slug, document);
    },
    async delete(slug) {
      this.documents.delete(slug);
    },
  };
}

function createFakeMultiplayerProfileRequests(): MultiplayerProfileRequestRepository & {
  submissions: SubmitMultiplayerProfileRequestInput[];
  rejectNext: boolean;
} {
  let nextId = 1;
  const records = new Map<number, MultiplayerProfileRequestRecord>();
  return {
    submissions: [],
    rejectNext: false,
    async submit(input) {
      this.submissions.push(input);
      if (this.rejectNext) {
        this.rejectNext = false;
        return { status: "REJECTED", code: "REQUEST_CONFLICT" };
      }
      const existing = [...records.values()].find(
        (record) => record.gameVersionId === input.gameVersionId,
      );
      if (existing) return { status: "REPLAYED", record: existing };
      const now = input.nowIso;
      const record: MultiplayerProfileRequestRecord = {
        id: nextId++,
        gameId: input.gameId,
        gameVersionId: input.gameVersionId,
        requestSchemaVersion: 1,
        requestHash: "a".repeat(64),
        requestJson: "{}",
        request: input.request,
        requestedByUserId: input.requestedByUserId,
        status: "PENDING_REVIEW",
        reviewedByAdminId: null,
        reviewedAt: null,
        decisionReasonCode: null,
        createdAt: now,
        updatedAt: now,
      };
      records.set(record.id, record);
      return { status: "CREATED", record };
    },
    async findById(requestId) {
      return records.get(requestId) ?? null;
    },
    async findByExactVersion(gameVersionId) {
      return [...records.values()].find((record) => record.gameVersionId === gameVersionId) ?? null;
    },
    async listPending(limit) {
      return [...records.values()]
        .filter((record) => record.status === "PENDING_REVIEW")
        .slice(0, limit);
    },
    async review() {
      throw new Error("not used");
    },
    async withdraw() {
      throw new Error("not used");
    },
  };
}

function createUseCases(
  entries?: Record<string, Uint8Array>,
  canonicalRepo: ReturnType<typeof createFakeCanonicalRepo> = createFakeCanonicalRepo(),
  multiplayerProfileRequests?: MultiplayerProfileRequestRepository,
) {
  const repo = createFakeRepo();
  const storage = createFakeStorage();
  const archives = createFakeArchiveReader(entries);
  const publisher = new GamePublicationService(
    new SandboxGameVersionPublicationRepository(repo),
    storage,
    archives,
  );
  const archiveWriter: BundleArchiveWriter = {
    write(nextEntries) {
      archives.entries = { ...nextEntries };
      return bytes("rebuilt-archive").buffer as ArrayBuffer;
    },
  };
  const useCases = new SandboxGameUseCases(
    repo,
    storage,
    publisher,
    canonicalRepo,
    archiveWriter,
    multiplayerProfileRequests,
  );
  return {
    useCases,
    repo,
    storage,
    archives,
    publisher,
    canonicalRepo,
  };
}

async function createGameWithLiveVersion(entries?: Record<string, Uint8Array>) {
  const ctx = createUseCases(entries);
  const game = await ctx.useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  const version = await ctx.useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(10),
  });
  await ctx.useCases.decideVersion({
    versionId: version.id,
    adminId: 99,
    decision: "APPROVED",
    reason: null,
  });
  await ctx.useCases.setVisibility(game.id, 99, "PUBLIC");
  return { ...ctx, game, version };
}

// ── existing catalog/review invariants ───────────────────────────────────────

test("createGame rejects an invalid slug", async () => {
  const { useCases } = createUseCases();
  await assert.rejects(
    () =>
      useCases.createGame({
        slug: "AB", // too short, and uppercase
        developerUserId: 1,
        title: "Game",
        shortDescription: null,
        description: null,
        genre: "puzzle",
        mode: "single",
      }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "INVALID_SLUG",
  );
});

test("createGame rejects a duplicate slug", async () => {
  const { useCases } = createUseCases();
  await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  await assert.rejects(
    () =>
      useCases.createGame({
        slug: "my-game",
        developerUserId: 2,
        title: "Other",
        shortDescription: null,
        description: null,
        genre: "puzzle",
        mode: "single",
      }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "SLUG_TAKEN",
  );
});

// Regression (2026-08-18): a soft-deleted game's row survives for audit (see deleteGame), and
// `slug` carries a raw DB UNIQUE constraint that the soft delete does not lift. findBySlug alone
// (which excludes deleted rows) would miss this and let the create fall through to a raw,
// unhandled constraint violation instead of a clean SLUG_TAKEN — this is what actually happened
// in production when a Game Creator re-registered a slug an admin had just soft-deleted.
test("createGame rejects a slug held by a soft-deleted game, instead of crashing on it", async () => {
  const { useCases } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  await useCases.deleteGame({ gameId: game.id, actorAdminId: 9 });

  await assert.rejects(
    () =>
      useCases.createGame({
        slug: "my-game",
        developerUserId: 1,
        title: "Game Again",
        shortDescription: null,
        description: null,
        genre: "puzzle",
        mode: "single",
      }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "SLUG_TAKEN",
  );
});

// ── Generic D1 slug authority ───────────────────────────────────────────────

test("createGame rejects an existing OWOGG generic identity without a registry lookup", async () => {
  const { useCases, repo } = createUseCases();
  repo.reservedSlugs.add("reaction-time");

  await assert.rejects(
    () =>
      useCases.createGame({
        slug: "reaction-time",
        developerUserId: 1,
        title: "Reaction Time Clone",
        shortDescription: null,
        description: null,
        genre: "arcade",
        mode: "single",
      }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "SLUG_TAKEN",
  );
});

test("createGame rejects an existing USER generic identity", async () => {
  const { useCases, repo } = createUseCases();
  repo.reservedSlugs.add("user-game");

  await assert.rejects(
    () =>
      useCases.createGame({
        slug: "user-game",
        developerUserId: 1,
        title: "USER collision",
        shortDescription: null,
        description: null,
        genre: "arcade",
        mode: "single",
      }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "SLUG_TAKEN",
  );
});

test("createGame rejects a permanently reserved slug", async () => {
  const { useCases, repo } = createUseCases();
  repo.reservedSlugs.add("retired-game");

  await assert.rejects(
    () =>
      useCases.createGame({
        slug: "retired-game",
        developerUserId: 1,
        title: "Retired collision",
        shortDescription: null,
        description: null,
        genre: "arcade",
        mode: "single",
      }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "SLUG_TAKEN",
  );
});

test("the generic slug authority doesn't disturb an existing Creator-vs-Creator collision", async () => {
  const { useCases } = createUseCases();

  await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "First",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () =>
      useCases.createGame({
        slug: "my-game",
        developerUserId: 2,
        title: "Second",
        shortDescription: null,
        description: null,
        genre: "puzzle",
        mode: "single",
      }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "SLUG_TAKEN",
  );
});

test("a genuinely free slug still registers normally", async () => {
  const { useCases } = createUseCases();

  const game = await useCases.createGame({
    slug: "brand-new-creator-game",
    developerUserId: 1,
    title: "Brand New",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  assert.equal(game.slug, "brand-new-creator-game");
});

test("uploadVersion rejects a non-owner, non-admin caller with NOT_OWNER", async () => {
  const { useCases } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () =>
      useCases.uploadVersion({
        gameId: game.id,
        actingUserId: 2,
        isAdmin: false,
        bytes: new ArrayBuffer(10),
      }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "NOT_OWNER",
  );
});

test("uploadVersion allows an admin to upload on the developer's behalf", async () => {
  const { useCases, storage } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  const version = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 999,
    isAdmin: true,
    bytes: new ArrayBuffer(10),
  });
  assert.equal(version.status, "PENDING_REVIEW");
  assert.ok(storage.putKeys.some((k) => k.startsWith(`uploads/${game.id}/`)));
});

test("uploadVersion rejects a bundle over the size cap without ever touching storage", async () => {
  const { useCases, storage } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () =>
      useCases.uploadVersion({
        gameId: game.id,
        actingUserId: 1,
        isAdmin: false,
        bytes: new ArrayBuffer(SANDBOX_GAME_POLICY.MAX_BUNDLE_BYTES + 1),
      }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "BUNDLE_TOO_LARGE",
  );
  assert.equal(storage.putKeys.length, 0);
});

test("setVisibility to PUBLIC is rejected until a version has been approved", async () => {
  const { useCases } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () => useCases.setVisibility(game.id, 99, "PUBLIC"),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "NO_APPROVED_VERSION",
  );

  const version = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(10),
  });
  await useCases.decideVersion({
    versionId: version.id,
    adminId: 99,
    decision: "APPROVED",
    reason: null,
  });

  const published = await useCases.setVisibility(game.id, 99, "PUBLIC");
  assert.equal(published.visibility, "PUBLIC");
});

test("decideVersion(APPROVED) sets the game's live_version_id", async () => {
  const { useCases, repo } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  const version = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(10),
  });

  await useCases.decideVersion({
    versionId: version.id,
    adminId: 99,
    decision: "APPROVED",
    reason: null,
  });

  assert.equal(repo.games.get(game.id)?.liveVersionId, version.id);
});

test("decideVersion(REJECTED) requires a non-empty reason", async () => {
  const { useCases } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  const version = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(10),
  });

  await assert.rejects(
    () =>
      useCases.decideVersion({
        versionId: version.id,
        adminId: 99,
        decision: "REJECTED",
        reason: "  ",
      }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "REASON_REQUIRED",
  );
});

test("decideVersion is final — a second decision on the same version is rejected with ALREADY_DECIDED", async () => {
  const { useCases } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  const version = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(10),
  });

  await useCases.decideVersion({
    versionId: version.id,
    adminId: 99,
    decision: "APPROVED",
    reason: null,
  });
  await assert.rejects(
    () =>
      useCases.decideVersion({
        versionId: version.id,
        adminId: 99,
        decision: "REJECTED",
        reason: "changed my mind",
      }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "ALREADY_DECIDED",
  );
});

test("updateMetadata rejects an out-of-policy title without writing anything", async () => {
  const { useCases, repo } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () => useCases.updateMetadata(game.id, 99, { title: "" }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "INVALID_TITLE",
  );
  assert.equal(repo.games.get(game.id)?.title, "Game");
});

// ── updateMetadata: generic canonical control-plane convergence ──────────────

function fixtureCanonicalDoc(
  slug: string,
  overrides: Partial<GameCanonicalDocument> = {},
): GameCanonicalDocument {
  return {
    schemaVersion: GAME_CANONICAL_SCHEMA_VERSION,
    slug,
    title: "Canonical Title",
    shortDescription: "Canonical short",
    description: "Canonical long",
    publisher: { official: false },
    policy: {
      score: { unit: "pts", direction: "desc", min: 0, max: 100 },
      leaderboard: true,
      xpPerCompletion: 10,
      requiresAuth: false,
    },
    supportsReplay: false,
    catalog: { type: "GENRE_MODE", genre: "puzzle", mode: "single" },
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function createBareGame(useCases: SandboxGameUseCases) {
  return useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Original Title",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
}

// -- pre-canonical --

test("updateMetadata: pre-canonical row + title-only patch + score still incomplete -> D1 updates, zero B2 writes", async () => {
  const { useCases, repo, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);

  const updated = await useCases.updateMetadata(game.id, 99, { title: "New Title" });

  assert.equal(updated.title, "New Title");
  assert.equal(repo.games.get(game.id)?.title, "New Title");
  assert.equal(canonicalRepo.saveCalls.length, 0);
  assert.equal(canonicalRepo.documents.size, 0);
});

test("updateMetadata: pre-canonical row + a partial score config patch stays pre-canonical, no B2 write", async () => {
  const { useCases, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);

  await useCases.updateMetadata(game.id, 99, { scoreUnit: "pts", scoreDirection: "desc" });

  assert.equal(canonicalRepo.saveCalls.length, 0);
  assert.equal(canonicalRepo.documents.size, 0);
});

test("updateMetadata: pre-canonical row + a patch that completes all four required score fields creates the first canonical document", async () => {
  const { useCases, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);

  const updated = await useCases.updateMetadata(game.id, 99, {
    scoreUnit: "pts",
    scoreDirection: "desc",
    scoreMin: 0,
    scoreMax: 100,
  });

  assert.equal(canonicalRepo.saveCalls.length, 1);
  const doc = canonicalRepo.documents.get(game.slug);
  assert.ok(doc);
  assert.deepEqual(doc?.policy.score, { unit: "pts", direction: "desc", min: 0, max: 100 });
  assert.equal(doc?.policy.requiresAuth, false);
  assert.equal(doc?.policy.leaderboard, true);
  assert.equal(doc?.updatedAt, updated.updatedAt);
});

// -- existing canonical --

test("updateMetadata: title change updates only B2 title, presentation preserved", async () => {
  const { useCases, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  const presentation = {
    viewport: { mode: "fixed" as const, preferredWidth: 640, preferredHeight: 360 },
    fullscreen: { supported: true, recommended: false },
    mobile: { support: "unsupported" as const },
  };
  const difficulty = {
    levels: [
      { id: "normal", label: "Normal" },
      { id: "hard", label: "Hard" },
    ],
    defaultLevelId: "normal",
  };
  canonicalRepo.documents.set(
    game.slug,
    fixtureCanonicalDoc(game.slug, { presentation, difficulty, supportsReplay: true }),
  );

  await useCases.updateMetadata(game.id, 99, { title: "Brand New Title" });

  const doc = canonicalRepo.documents.get(game.slug);
  assert.equal(doc?.title, "Brand New Title");
  assert.deepEqual(doc?.presentation, presentation);
  assert.deepEqual(doc?.difficulty, difficulty);
  assert.equal(doc?.supportsReplay, true);
});

test("updateMetadata: genre/description change leaves every other canonical field untouched", async () => {
  const { useCases, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  const existing = fixtureCanonicalDoc(game.slug);
  canonicalRepo.documents.set(game.slug, existing);

  await useCases.updateMetadata(game.id, 99, { genre: "arcade", description: "New desc" });

  const doc = canonicalRepo.documents.get(game.slug);
  assert.equal(doc?.catalog.type === "GENRE_MODE" ? doc.catalog.genre : null, "arcade");
  assert.equal(doc?.catalog.type === "GENRE_MODE" ? doc.catalog.mode : null, "single");
  assert.equal(doc?.description, "New desc");
  assert.equal(doc?.title, existing.title);
  assert.equal(doc?.shortDescription, existing.shortDescription);
  assert.deepEqual(doc?.policy, existing.policy);
});

test("updateMetadata: genre patch fails closed for a richer TAXONOMY catalog before D1 changes", async () => {
  const { useCases, repo, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  canonicalRepo.documents.set(
    game.slug,
    fixtureCanonicalDoc(game.slug, {
      catalog: {
        type: "TAXONOMY",
        categories: ["arcade"],
        tags: ["fast"],
        modes: ["single"],
        inputMethods: ["mouse"],
        minPlayers: 1,
        maxPlayers: 1,
        thumbnail: "/games/thumb.svg",
      },
    }),
  );

  await assert.rejects(
    () => useCases.updateMetadata(game.id, 99, { genre: "action" }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "CANONICAL_SYNC_FAILED",
  );
  assert.equal(repo.games.get(game.id)?.genre, "puzzle");
  assert.equal(canonicalRepo.saveCalls.length, 0);
});

test("updateMetadata: xpPerCompletion change preserves requiresAuth/leaderboard", async () => {
  const { useCases, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  canonicalRepo.documents.set(game.slug, fixtureCanonicalDoc(game.slug));

  await useCases.updateMetadata(game.id, 99, { xpPerCompletion: 75 });

  const doc = canonicalRepo.documents.get(game.slug);
  assert.equal(doc?.policy.xpPerCompletion, 75);
  assert.equal(doc?.policy.requiresAuth, false);
  assert.equal(doc?.policy.leaderboard, true);
});

test("updateMetadata: a partial score patch keeps the rest of the existing ScoreConfig, decimal bounds preserved", async () => {
  const { useCases, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  // D1's own score_* columns must be complete too — the pre-D1-mutation validation step merges
  // THIS request onto D1's current row, not onto whatever B2 happens to hold (see
  // computeCreatorCanonicalScorePatch's own doc comment) — so bootstrap a fully-scored game
  // through the real flow first, which naturally keeps D1 and B2 consistent with each other.
  await useCases.updateMetadata(game.id, 99, {
    scoreUnit: "s",
    scoreDirection: "asc",
    scoreMin: 0.5,
    scoreMax: 99.9,
  });
  canonicalRepo.saveCalls.length = 0;

  await useCases.updateMetadata(game.id, 99, { scoreMax: 199.5 });

  const doc = canonicalRepo.documents.get(game.slug);
  assert.deepEqual(doc?.policy.score, { unit: "s", direction: "asc", min: 0.5, max: 199.5 });
});

test("updateMetadata: a patch that would null out a required score field is rejected before any D1 or B2 write", async () => {
  const { useCases, repo, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  await useCases.updateMetadata(game.id, 99, {
    scoreUnit: "pts",
    scoreDirection: "desc",
    scoreMin: 0,
    scoreMax: 100,
  });
  canonicalRepo.saveCalls.length = 0;

  await assert.rejects(
    () => useCases.updateMetadata(game.id, 99, { scoreMax: null }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure &&
      err.code === "SCORE_POLICY_WOULD_BECOME_INCOMPLETE",
  );

  assert.equal(repo.games.get(game.id)?.scoreMax, 100, "D1 must be untouched");
  assert.equal(canonicalRepo.saveCalls.length, 0);
});

test("updateMetadata: canonical score:null + title-only patch keeps score:null", async () => {
  const { useCases, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  canonicalRepo.documents.set(
    game.slug,
    fixtureCanonicalDoc(game.slug, {
      policy: { score: null, leaderboard: false, xpPerCompletion: 0, requiresAuth: false },
    }),
  );

  await useCases.updateMetadata(game.id, 99, { title: "Renamed" });

  const doc = canonicalRepo.documents.get(game.slug);
  assert.equal(doc?.policy.score, null);
  assert.equal(doc?.title, "Renamed");
});

test("updateMetadata: canonical score:null + an incomplete score patch is rejected as ambiguous", async () => {
  const { useCases, repo, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  canonicalRepo.documents.set(
    game.slug,
    fixtureCanonicalDoc(game.slug, {
      policy: { score: null, leaderboard: false, xpPerCompletion: 0, requiresAuth: false },
    }),
  );

  await assert.rejects(
    () => useCases.updateMetadata(game.id, 99, { scoreUnit: "pts" }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "AMBIGUOUS_SCORE_POLICY_ACTIVATION",
  );
  assert.equal(repo.games.get(game.id)?.scoreUnit, null, "D1 must be untouched");
  assert.equal(canonicalRepo.saveCalls.length, 0);
});

test("updateMetadata: canonical score:null + all four required score fields explicitly patched transitions to a real ScoreConfig", async () => {
  const { useCases, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  canonicalRepo.documents.set(
    game.slug,
    fixtureCanonicalDoc(game.slug, {
      policy: { score: null, leaderboard: false, xpPerCompletion: 0, requiresAuth: false },
    }),
  );

  await useCases.updateMetadata(game.id, 99, {
    scoreUnit: "pts",
    scoreDirection: "desc",
    scoreMin: 0,
    scoreMax: 50,
  });

  const doc = canonicalRepo.documents.get(game.slug);
  assert.deepEqual(doc?.policy.score, { unit: "pts", direction: "desc", min: 0, max: 50 });
});

// -- failure semantics --

test("updateMetadata: a B2 pre-read failure leaves D1 untouched", async () => {
  const { useCases, repo, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  canonicalRepo.throwOnFindFor = game.slug;

  await assert.rejects(
    () => useCases.updateMetadata(game.id, 99, { title: "New Title" }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "CANONICAL_SYNC_FAILED",
  );
  assert.equal(repo.games.get(game.id)?.title, "Original Title");
});

test("updateMetadata: a D1 update failure never reaches B2 at all", async () => {
  const { repo, storage, canonicalRepo } = createUseCases();
  const publisher = new GamePublicationService(
    new SandboxGameVersionPublicationRepository(repo),
    storage,
    createFakeArchiveReader(),
  );
  const failingRepo: SandboxGameRepository = {
    ...repo,
    async updateMetadata(): Promise<SandboxGameRecord> {
      throw new Error("simulated D1 write failure");
    },
  };
  const useCases = new SandboxGameUseCases(failingRepo, storage, publisher, canonicalRepo);
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Original Title",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(() => useCases.updateMetadata(game.id, 99, { title: "New Title" }));
  assert.equal(canonicalRepo.saveCalls.length, 0);
});

test("updateMetadata: a B2 save failure after a successful D1 update never returns success", async () => {
  const { useCases, repo, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  canonicalRepo.documents.set(game.slug, fixtureCanonicalDoc(game.slug));
  canonicalRepo.throwOnSaveFor = game.slug;

  await assert.rejects(
    () => useCases.updateMetadata(game.id, 99, { title: "New Title" }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "CANONICAL_SYNC_FAILED",
  );
  // D1 was already committed — the failure is in keeping B2 in sync, not hidden as a full no-op.
  assert.equal(repo.games.get(game.id)?.title, "New Title");
});

test("updateMetadata: a B2 read-back parity mismatch after save is surfaced as a sync failure", async () => {
  const { useCases, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  canonicalRepo.documents.set(game.slug, fixtureCanonicalDoc(game.slug));
  const realSave = canonicalRepo.save.bind(canonicalRepo);
  canonicalRepo.save = async (document) => {
    await realSave(document);
    // Corrupt what's actually stored right after saving, simulating a read-back that doesn't
    // match what was just written.
    canonicalRepo.documents.set(document.slug, { ...document, title: "corrupted-in-storage" });
  };

  await assert.rejects(
    () => useCases.updateMetadata(game.id, 99, { title: "New Title" }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "CANONICAL_SYNC_FAILED",
  );
});

test("updateMetadata: end to end, a D1/B2-diverged score policy only changes the field the PATCH names — B2 stays the source of truth for the rest", async () => {
  const { useCases, repo, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  // B2 canonical: a real, complete ScoreConfig.
  canonicalRepo.documents.set(
    game.slug,
    fixtureCanonicalDoc(game.slug, {
      policy: {
        score: { unit: "seconds", direction: "asc", min: 0.5, max: 100, displayPrefix: "T:" },
        leaderboard: true,
        xpPerCompletion: 10,
        requiresAuth: false,
      },
    }),
  );
  // D1's own score_* columns are deliberately different (a stale/diverged mirror) — directly
  // written to the fake repo's underlying map, bypassing updateMetadata, to simulate D1 having
  // drifted from B2 without going through this same sync path.
  const diverged = repo.games.get(game.id);
  assert.ok(diverged);
  repo.games.set(game.id, {
    ...diverged,
    scoreUnit: "pts",
    scoreDirection: "desc",
    scoreMin: 0,
    scoreMax: 999,
    scoreDisplayPrefix: "OLD",
  });

  await useCases.updateMetadata(game.id, 99, { scoreMax: 200 });

  const doc = canonicalRepo.documents.get(game.slug);
  assert.deepEqual(doc?.policy.score, {
    unit: "seconds",
    direction: "asc",
    min: 0.5,
    max: 200,
    displayPrefix: "T:",
  });
});

test("updateMetadata: a B2 save failure followed by a retry still preserves the untouched canonical score fields — no fallback to D1's mirror on the second attempt either", async () => {
  const { useCases, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  canonicalRepo.documents.set(
    game.slug,
    fixtureCanonicalDoc(game.slug, {
      policy: {
        score: { unit: "seconds", direction: "asc", min: 0.5, max: 100, displayPrefix: "T:" },
        leaderboard: true,
        xpPerCompletion: 10,
        requiresAuth: false,
      },
    }),
  );
  canonicalRepo.throwOnSaveFor = game.slug;

  await assert.rejects(
    () => useCases.updateMetadata(game.id, 99, { scoreMax: 200 }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "CANONICAL_SYNC_FAILED",
  );
  // The failed attempt must not have partially written anything.
  assert.deepEqual(canonicalRepo.documents.get(game.slug)?.policy.score, {
    unit: "seconds",
    direction: "asc",
    min: 0.5,
    max: 100,
    displayPrefix: "T:",
  });

  canonicalRepo.throwOnSaveFor = undefined;
  await useCases.updateMetadata(game.id, 99, { scoreMax: 200 });

  assert.deepEqual(canonicalRepo.documents.get(game.slug)?.policy.score, {
    unit: "seconds",
    direction: "asc",
    min: 0.5,
    max: 200,
    displayPrefix: "T:",
  });
});

test("updateMetadata: a canonical document created by a concurrent writer between the first-create decision and the actual save is patched, not overwritten", async () => {
  const { useCases, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  // No document exists yet, so this metadata patch (which completes the score policy) would
  // normally trigger first-canonical creation — but simulate another writer creating a real
  // document with its own presentation in between the use case's own pre-read and its final
  // pre-save recheck by making findBySlug return null once, then something real afterward.
  let findCalls = 0;
  const concurrentDoc = fixtureCanonicalDoc(game.slug, { title: "Created By Someone Else" });
  const originalFindBySlug = canonicalRepo.findBySlug.bind(canonicalRepo);
  canonicalRepo.findBySlug = async (slug: string) => {
    findCalls++;
    if (slug === game.slug && findCalls === 2) {
      canonicalRepo.documents.set(game.slug, concurrentDoc);
    }
    return originalFindBySlug(slug);
  };

  await useCases.updateMetadata(game.id, 99, {
    scoreUnit: "pts",
    scoreDirection: "desc",
    scoreMin: 0,
    scoreMax: 100,
  });

  const doc = canonicalRepo.documents.get(game.slug);
  // The concurrent writer's title must survive — this patched onto their document rather than
  // overwriting it with a freshly-mapped one.
  assert.equal(doc?.title, "Created By Someone Else");
});

test("updateMetadata: a canonical that disappears after pre-read is never rebuilt from D1", async () => {
  const { useCases, repo, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  canonicalRepo.documents.set(game.slug, fixtureCanonicalDoc(game.slug));
  const originalFind = canonicalRepo.findBySlug.bind(canonicalRepo);
  let reads = 0;
  canonicalRepo.findBySlug = async (slug: string) => {
    reads++;
    if (slug === game.slug && reads === 2) canonicalRepo.documents.delete(slug);
    return originalFind(slug);
  };

  await assert.rejects(
    () => useCases.updateMetadata(game.id, 99, { title: "New Title" }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "CANONICAL_SYNC_FAILED",
  );
  assert.equal(repo.games.get(game.id)?.title, "New Title", "D1 committed before the B2 race");
  assert.equal(canonicalRepo.saveCalls.length, 0, "must not recreate from the D1 mirror");
});

test("updateMetadata: B2-only presentation survives an unrelated metadata patch end to end", async () => {
  const { useCases, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  // "responsive" is the only GamePresentation viewport mode with min*/max* bounds (see
  // @owogg/game-sdk's presentation.ts) — a pre-existing "scale-to-fit" value here was never a
  // real GamePresentation mode; it went unnoticed only because packages/core's typecheck config
  // excludes test/ and this fake never round-tripped the value through a real parser. Stage U-3's
  // generic shadow sync is the first thing that actually validates it (see gameCanonicalDocument
  // .ts's own doc comment on why the generic schema is stricter than the Game Creator schema).
  const presentation = {
    viewport: { mode: "responsive" as const, minWidth: 320, minHeight: 240 },
    fullscreen: { supported: false, recommended: false },
    mobile: { support: "supported" as const, orientation: "any" as const },
  };
  canonicalRepo.documents.set(game.slug, fixtureCanonicalDoc(game.slug, { presentation }));

  await useCases.updateMetadata(game.id, 99, { description: "updated description" });

  assert.deepEqual(canonicalRepo.documents.get(game.slug)?.presentation, presentation);
});

test("updateMetadata: existing requiresAuth/leaderboard are preserved verbatim by an unrelated patch", async () => {
  const { useCases, canonicalRepo } = createUseCases();
  const game = await createBareGame(useCases);
  canonicalRepo.documents.set(
    game.slug,
    fixtureCanonicalDoc(game.slug, {
      policy: {
        score: { unit: "pts", direction: "desc", min: 0, max: 100 },
        leaderboard: false,
        xpPerCompletion: 10,
        requiresAuth: false,
      },
    }),
  );

  await useCases.updateMetadata(game.id, 99, { title: "New Title" });

  const doc = canonicalRepo.documents.get(game.slug);
  assert.equal(doc?.policy.leaderboard, false);
  assert.equal(doc?.policy.requiresAuth, false);
});

test("uploadVersion cleans up the orphaned storage object when the D1 write fails after a successful put, and surfaces PUBLISH_FAILED rather than the raw D1 error", async () => {
  const repo = createFakeRepo();
  const storage = createFakeStorage();
  const dbFailure = new Error("D1 write failed");
  const publisher = new GamePublicationService(
    new SandboxGameVersionPublicationRepository(repo),
    storage,
    createFakeArchiveReader(),
  );
  const useCases = new SandboxGameUseCases(
    {
      ...repo,
      async createVersion(): Promise<SandboxGameVersionRecord> {
        throw dbFailure;
      },
    },
    storage,
    publisher,
    createFakeCanonicalRepo(),
  );

  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  // The raw D1 error must NOT leak past this call — a route's failureResponse() only knows how
  // to translate SandboxGameUseCaseFailure, so anything else would escape as an uncaught,
  // JSON-less 500 (see the private uploadPreparedVersion's doc comment for the production bug
  // this was fixed for).
  await assert.rejects(
    () =>
      useCases.uploadVersion({
        gameId: game.id,
        actingUserId: 1,
        isAdmin: false,
        bytes: new ArrayBuffer(10),
      }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "PUBLISH_FAILED",
  );
  assert.equal(storage.deletedKeys.length, 1);
  assert.match(storage.deletedKeys[0]!, new RegExp(`^uploads/${game.id}/[0-9a-f]{64}\\.zip$`));
});

test("uploadVersion surfaces PUBLISH_FAILED (not a raw error) when the source archive write itself fails", async () => {
  const { useCases, repo, storage } = createUseCases();
  const storageFailure = new Error("simulated B2 network/auth failure");
  storage.putObject = async () => {
    throw storageFailure;
  };

  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () =>
      useCases.uploadVersion({
        gameId: game.id,
        actingUserId: 1,
        isAdmin: false,
        bytes: new ArrayBuffer(10),
      }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "PUBLISH_FAILED",
  );
  // Nothing was ever stored, so the best-effort cleanup delete is a harmless no-op — no version
  // row exists either (createVersion is never reached).
  assert.equal(repo.versions.size, 0);
});

// ── publish pipeline ─────────────────────────────────────────────────────────

test("uploadVersion publishes each bundle file as its own versioned object and reaches READY", async () => {
  const { useCases, storage, game, version } = await createGameWithLiveVersion();

  assert.equal(version.publishStatus, "READY");
  assert.equal(version.fileCount, 3);
  assert.ok(storage.putKeys.includes(`games/${game.id}/${version.id}/index.html`));
  assert.ok(storage.putKeys.includes(`games/${game.id}/${version.id}/Build/game.wasm`));
  assert.ok(storage.putKeys.includes(`games/${game.id}/${version.id}/owogg.json`));
});

test("owogg.json v2 upload stores its managed request against the exact USER version", async () => {
  const requests = createFakeMultiplayerProfileRequests();
  const entries = {
    ...MINIMAL_BUNDLE,
    [OWOGG_GAME_CREATOR_MANIFEST_FILENAME]: multiplayerCreatorManifestBytes(),
  };
  const { useCases } = createUseCases(entries, createFakeCanonicalRepo(), requests);
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 7,
    title: "Online Grid",
    shortDescription: null,
    description: null,
    genre: "board",
    mode: "multi",
  });

  const version = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 7,
    isAdmin: false,
    bytes: new ArrayBuffer(10),
  });

  assert.equal(version.publishStatus, "READY");
  assert.equal(requests.submissions.length, 1);
  assert.equal(requests.submissions[0]?.gameId, game.id);
  assert.equal(requests.submissions[0]?.gameVersionId, version.id);
  assert.equal(requests.submissions[0]?.requestedByUserId, 7);
  assert.equal(requests.submissions[0]?.request.template.id, "turn-grid");
});

test("a failed managed-request insert is retryable through exact-version republish", async () => {
  const requests = createFakeMultiplayerProfileRequests();
  requests.rejectNext = true;
  const entries = {
    ...MINIMAL_BUNDLE,
    [OWOGG_GAME_CREATOR_MANIFEST_FILENAME]: multiplayerCreatorManifestBytes(),
  };
  const { useCases, repo } = createUseCases(entries, createFakeCanonicalRepo(), requests);
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 7,
    title: "Online Grid",
    shortDescription: null,
    description: null,
    genre: "board",
    mode: "multi",
  });

  await assert.rejects(
    () =>
      useCases.uploadVersion({
        gameId: game.id,
        actingUserId: 7,
        isAdmin: false,
        bytes: new ArrayBuffer(10),
      }),
    (error: unknown) =>
      error instanceof SandboxGameUseCaseFailure && error.code === "PUBLISH_FAILED",
  );
  const version = [...repo.versions.values()][0];
  assert.ok(version);
  assert.equal(version.publishStatus, "READY");

  const repaired = await useCases.republishVersion(version.id);
  assert.equal(repaired.id, version.id);
  assert.equal(requests.submissions.length, 2);
});

test("publishing writes a manifest listing every file with its size and content type", async () => {
  const { storage, game, version } = await createGameWithLiveVersion();

  const manifestKey = `games/${game.id}/${version.id}/.owogg-manifest.json`;
  assert.equal(version.manifestKey, manifestKey);
  const stored = storage.objects.get(manifestKey);
  assert.ok(stored);
  const manifest = JSON.parse(new TextDecoder().decode(stored.bytes)) as SandboxGameBundleManifest;

  assert.equal(manifest.gameId, game.id);
  assert.equal(manifest.versionId, version.id);
  assert.equal(manifest.entry, "index.html");
  assert.equal(manifest.fileCount, 3);
  assert.equal(manifest.contentHash, version.contentHash);
  const wasm = manifest.files.find((f) => f.path === "Build/game.wasm");
  assert.equal(wasm?.contentType, "application/wasm");
  assert.equal(wasm?.size, bytes("\0asm fake").byteLength);
  assert.equal(manifest.totalSize, version.publishedSizeBytes);
});

test("uploadVersion rejects a bundle with no index.html at its root", async () => {
  const { useCases } = createUseCases({ "readme.txt": bytes("no game here") });
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () =>
      useCases.uploadVersion({
        gameId: game.id,
        actingUserId: 1,
        isAdmin: false,
        bytes: new ArrayBuffer(10),
      }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "BUNDLE_MISSING_ENTRY",
  );
});

test("uploadVersion rejects a path-traversal entry and stores nothing at all", async () => {
  const { useCases, storage } = createUseCases({
    "index.html": bytes("<h1>hi</h1>"),
    "../../etc/passwd": bytes("nope"),
  });
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () =>
      useCases.uploadVersion({
        gameId: game.id,
        actingUserId: 1,
        isAdmin: false,
        bytes: new ArrayBuffer(10),
      }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "BUNDLE_INVALID_PATH",
  );
  // Validation runs on the in-memory upload, before the source archive is stored or a row exists.
  assert.equal(storage.putKeys.length, 0);
  assert.equal(storage.objects.size, 0);
});

test("uploadVersion rejects an absolute path entry", async () => {
  const { useCases } = createUseCases({
    "index.html": bytes("<h1>hi</h1>"),
    "/etc/hosts": bytes("nope"),
  });
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () =>
      useCases.uploadVersion({
        gameId: game.id,
        actingUserId: 1,
        isAdmin: false,
        bytes: new ArrayBuffer(10),
      }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "BUNDLE_INVALID_PATH",
  );
});

test("uploadVersion rejects a bundle whose decompressed size exceeds the extracted cap", async () => {
  // One entry just over the cap — the compressed upload is a tiny ArrayBuffer, which is exactly
  // the zip-bomb shape MAX_EXTRACTED_BUNDLE_BYTES guards against.
  const { useCases } = createUseCases({
    "index.html": bytes("<h1>hi</h1>"),
    "big.data": new Uint8Array(SANDBOX_GAME_POLICY.MAX_EXTRACTED_BUNDLE_BYTES + 1),
  });
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () =>
      useCases.uploadVersion({
        gameId: game.id,
        actingUserId: 1,
        isAdmin: false,
        bytes: new ArrayBuffer(10),
      }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "BUNDLE_EXTRACTED_TOO_LARGE",
  );
});

test("an oversized *declared* size is rejected from archive metadata alone, before any full decompression is attempted", async () => {
  // The actual entry bytes here are tiny — if the code only checked size after decompressing
  // (the old behavior), this upload would sail through. declaredSizeOverride simulates a central
  // directory claiming a huge decompressed size regardless of what the fake's real bytes are, so
  // this test can tell "rejected from metadata" apart from "rejected after materializing bytes".
  const { useCases, archives } = createUseCases({
    "index.html": bytes("<h1>hi</h1>"),
    "big.data": bytes("tiny"),
  });
  archives.declaredSizeOverride = {
    "index.html": 11,
    "big.data": SANDBOX_GAME_POLICY.MAX_EXTRACTED_BUNDLE_BYTES + 1,
  };
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () =>
      useCases.uploadVersion({
        gameId: game.id,
        actingUserId: 1,
        isAdmin: false,
        bytes: new ArrayBuffer(10),
      }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "BUNDLE_EXTRACTED_TOO_LARGE",
  );
  assert.equal(
    archives.readCalls,
    0,
    "full decompression (readCalls) must never run once metadata alone is over the cap",
  );
});

test("an implausible compression ratio is rejected even when the declared total stays under the flat size cap", async () => {
  // A single small entry claiming to decompress at ~10000:1 from a tiny compressed size — under
  // the flat 50MiB total-size cap on its own, but far beyond what DEFLATE can physically produce
  // from that many compressed bytes (see MAX_PLAUSIBLE_COMPRESSION_RATIO). This is the guard that
  // exists specifically because "under the flat cap" alone isn't the whole memory-safety story —
  // see FflateBundleArchiveReader's header comment for why a lying *total* can't smuggle memory
  // past what's already checked, and why an implausible *ratio* is the residual thing worth
  // catching early instead of paying for a long decode loop.
  const { useCases, archives } = createUseCases({
    "index.html": bytes("<h1>hi</h1>"),
    "suspicious.data": bytes("tiny"),
  });
  archives.compressedSizeOverride = { "suspicious.data": 100 };
  archives.declaredSizeOverride = { "suspicious.data": 100 * 1200 + 1 }; // just over the ratio cap
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () =>
      useCases.uploadVersion({
        gameId: game.id,
        actingUserId: 1,
        isAdmin: false,
        bytes: new ArrayBuffer(10),
      }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "BUNDLE_EXTRACTED_TOO_LARGE",
  );
  assert.equal(
    archives.readCalls,
    0,
    "an implausible ratio must be caught before full decompression",
  );
});

test("a well-compressed but plausible entry (well under the ratio ceiling) is not rejected by the ratio guard", async () => {
  // Legitimate assets — e.g. a large solid-color texture or a repetitive data table — can
  // genuinely compress very well. The ratio guard must not treat "compresses nicely" as suspicious
  // on its own; it exists to catch ratios DEFLATE cannot physically produce, not merely high ones.
  const { useCases, archives } = createUseCases({
    "index.html": bytes("<h1>hi</h1>"),
    "texture.data": bytes("real bytes"),
    [OWOGG_GAME_CREATOR_MANIFEST_FILENAME]: creatorManifestBytes({
      slug: "my-game",
      title: "Game",
      genre: "puzzle",
      mode: "single",
    }),
  });
  archives.compressedSizeOverride = { "texture.data": 1000 };
  archives.declaredSizeOverride = { "texture.data": 1000 * 500 }; // 500:1 — well under the 1200:1 ceiling
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  const version = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(10),
  });
  assert.equal(version.publishStatus, "READY");
});

test("an oversized declared file count is rejected from archive metadata alone, before any full decompression is attempted", async () => {
  const entries: Record<string, Uint8Array> = { "index.html": bytes("<h1>hi</h1>") };
  const declaredSizeOverride: Record<string, number> = {};
  for (let i = 0; i <= SANDBOX_GAME_POLICY.MAX_BUNDLE_FILE_COUNT; i++) {
    // Real bytes stay tiny; only the declared count is large, so a pass here can only mean the
    // code counted from metadata, not from materialized entries.
    entries[`assets/file-${i}.txt`] = bytes("x");
    declaredSizeOverride[`assets/file-${i}.txt`] = 1;
  }
  const { useCases, archives } = createUseCases(entries);
  archives.declaredSizeOverride = declaredSizeOverride;
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () =>
      useCases.uploadVersion({
        gameId: game.id,
        actingUserId: 1,
        isAdmin: false,
        bytes: new ArrayBuffer(10),
      }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "BUNDLE_TOO_MANY_FILES",
  );
  assert.equal(archives.readCalls, 0);
});

test("a path-traversal entry reported only in metadata is rejected before any full decompression", async () => {
  const { useCases, archives } = createUseCases({
    "index.html": bytes("<h1>hi</h1>"),
    "safe.txt": bytes("ok"),
  });
  // Simulate the traversal entry only showing up in the central directory listing, distinct from
  // whatever the fake's `entries` dict (used by the never-reached full read()) contains.
  const originalMetadata = archives.readMetadata.bind(archives);
  archives.readMetadata = () => [
    ...originalMetadata(),
    { path: "../../etc/passwd", declaredSize: 4 },
  ];

  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () =>
      useCases.uploadVersion({
        gameId: game.id,
        actingUserId: 1,
        isAdmin: false,
        bytes: new ArrayBuffer(10),
      }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "BUNDLE_INVALID_PATH",
  );
  assert.equal(archives.readCalls, 0);
});

test("a malformed archive is rejected at the metadata stage, without ever calling the full reader", async () => {
  const { useCases, archives } = createUseCases();
  archives.malformed = true;
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () =>
      useCases.uploadVersion({
        gameId: game.id,
        actingUserId: 1,
        isAdmin: false,
        bytes: new ArrayBuffer(10),
      }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "BUNDLE_MALFORMED",
  );
  assert.equal(archives.readCalls, 0);
});

test("uploadVersion rejects a bundle with more files than the entry-count cap", async () => {
  const many: Record<string, Uint8Array> = { "index.html": bytes("<h1>hi</h1>") };
  for (let i = 0; i <= SANDBOX_GAME_POLICY.MAX_BUNDLE_FILE_COUNT; i++) {
    many[`assets/file-${i}.txt`] = bytes("x");
  }
  const { useCases } = createUseCases(many);
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () =>
      useCases.uploadVersion({
        gameId: game.id,
        actingUserId: 1,
        isAdmin: false,
        bytes: new ArrayBuffer(10),
      }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "BUNDLE_TOO_MANY_FILES",
  );
});

test("uploadVersion rejects a malformed archive with BUNDLE_MALFORMED", async () => {
  const { useCases, archives } = createUseCases();
  archives.malformed = true;
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () =>
      useCases.uploadVersion({
        gameId: game.id,
        actingUserId: 1,
        isAdmin: false,
        bytes: new ArrayBuffer(10),
      }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "BUNDLE_MALFORMED",
  );
});

test("publishing unwraps a single top-level wrapping folder so index.html lands at the root", async () => {
  const { game, version, storage } = await createGameWithLiveVersion({
    "MyGame/index.html": bytes("<h1>wrapped</h1>"),
    "MyGame/Build/game.wasm": bytes("\0asm"),
    "MyGame/owogg.json": creatorManifestBytes({
      slug: "my-game",
      title: "Game",
      genre: "puzzle",
      mode: "single",
    }),
  });

  assert.equal(version.publishStatus, "READY");
  assert.ok(storage.putKeys.includes(`games/${game.id}/${version.id}/index.html`));
  assert.ok(storage.putKeys.includes(`games/${game.id}/${version.id}/Build/game.wasm`));
  assert.ok(!storage.putKeys.some((k) => k.includes("MyGame/")));
});

test("a publish that fails part-way leaves the version non-READY with a recorded error", async () => {
  const { useCases, storage, repo } = createUseCases({
    "index.html": bytes("<h1>hi</h1>"),
    "Build/game.wasm": bytes("\0asm"),
    [OWOGG_GAME_CREATOR_MANIFEST_FILENAME]: creatorManifestBytes({
      slug: "my-game",
      title: "Game",
      genre: "puzzle",
      mode: "single",
    }),
  });
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  storage.failPutContaining = "game.wasm";

  await assert.rejects(() =>
    useCases.uploadVersion({
      gameId: game.id,
      actingUserId: 1,
      isAdmin: false,
      bytes: new ArrayBuffer(10),
    }),
  );

  const version = [...repo.versions.values()].at(-1);
  assert.equal(version?.publishStatus, "FAILED");
  assert.ok(version?.publishError);
  assert.equal(version?.manifestKey, null);
  // No manifest was written, so nothing claims this partial set of objects is a complete version.
  assert.ok(!storage.putKeys.some((k) => k.endsWith(".owogg-manifest.json")));
});

test("a version left non-READY by a failed publish cannot be approved or made live", async () => {
  const { useCases, storage, repo } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  storage.failPutContaining = "index.html";
  await assert.rejects(() =>
    useCases.uploadVersion({
      gameId: game.id,
      actingUserId: 1,
      isAdmin: false,
      bytes: new ArrayBuffer(10),
    }),
  );
  const failed = [...repo.versions.values()].at(-1)!;

  await assert.rejects(
    () =>
      useCases.decideVersion({
        versionId: failed.id,
        adminId: 99,
        decision: "APPROVED",
        reason: null,
      }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "VERSION_NOT_PUBLISHED",
  );
  // ...and the game therefore never gained a live version at all.
  assert.equal(repo.games.get(game.id)?.liveVersionId, null);

  await assert.rejects(
    () => useCases.setLiveVersion(game.id, 99, failed.id),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "VERSION_NOT_APPROVED",
  );
});

test("a failed publish can be recovered by republishing from the stored source archive", async () => {
  const { useCases, storage, repo } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  storage.failPutContaining = "index.html";
  await assert.rejects(() =>
    useCases.uploadVersion({
      gameId: game.id,
      actingUserId: 1,
      isAdmin: false,
      bytes: new ArrayBuffer(10),
    }),
  );
  const failed = [...repo.versions.values()].at(-1)!;
  assert.equal(failed.publishStatus, "FAILED");

  // The source archive survived the failed publish, so no re-upload is needed.
  delete storage.failPutContaining;
  const republished = await useCases.republishVersion(failed.id);
  assert.equal(republished.publishStatus, "READY");
  assert.ok(storage.putKeys.includes(`games/${game.id}/${failed.id}/index.html`));
});

test("two versions of the same game publish to completely independent object paths", async () => {
  const { useCases, storage, game, version: v1 } = await createGameWithLiveVersion();
  const v2 = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(20), // different bytes -> different hash -> different source key
  });

  assert.notEqual(v1.id, v2.id);
  assert.ok(storage.objects.has(`games/${game.id}/${v1.id}/index.html`));
  assert.ok(storage.objects.has(`games/${game.id}/${v2.id}/index.html`));
  // The earlier version's objects are untouched — which is what makes rollback free.
  assert.ok(!storage.deletedKeys.some((k) => k.includes(`/${v1.id}/`)));
});

// ── live version switching / rollback ────────────────────────────────────────

test("setLiveVersion switches the live version and records an audit entry, without re-uploading", async () => {
  const { useCases, repo, storage, game, version: v1 } = await createGameWithLiveVersion();
  const v2 = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(20),
  });
  await useCases.decideVersion({
    versionId: v2.id,
    adminId: 99,
    decision: "APPROVED",
    reason: null,
  });
  assert.equal(repo.games.get(game.id)?.liveVersionId, v2.id);

  const putsBefore = storage.putKeys.length;
  const rolledBack = await useCases.setLiveVersion(game.id, 99, v1.id);

  assert.equal(rolledBack.liveVersionId, v1.id);
  assert.equal(storage.putKeys.length, putsBefore, "rollback must not re-upload any object");
  assert.ok(repo.auditActions.includes("LIVE_VERSION_CHANGED"));
});

test("setLiveVersion refuses a version belonging to a different game", async () => {
  const { useCases, version } = await createGameWithLiveVersion();
  const other = await useCases.createGame({
    slug: "other-game",
    developerUserId: 1,
    title: "Other",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () => useCases.setLiveVersion(other.id, 99, version.id),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "VERSION_NOT_FOUND",
  );
});

test("setLiveVersion refuses a version that has not been approved", async () => {
  const { useCases, game } = await createGameWithLiveVersion();
  const pending = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(20),
  });

  await assert.rejects(
    () => useCases.setLiveVersion(game.id, 99, pending.id),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "VERSION_NOT_APPROVED",
  );
});

// ── revokeApproval / listAll ──────────────────────────────────────────────────

test("revokeApproval reverts an APPROVED version to PENDING_REVIEW and clears the review fields", async () => {
  const { useCases, version } = await createGameWithLiveVersion();

  const reverted = await useCases.revokeApproval({
    versionId: version.id,
    adminId: 99,
    reason: "실수로 승인함",
  });

  assert.equal(reverted.status, "PENDING_REVIEW");
  assert.equal(reverted.reviewedByAdminId, null);
  assert.equal(reverted.reviewedAt, null);
  assert.equal(reverted.rejectReason, null);
});

test("revokeApproval forces the game back to PRIVATE and clears liveVersionId when that version was live", async () => {
  const { useCases, game, version } = await createGameWithLiveVersion();
  assert.equal(game.liveVersionId, null); // stale reference from before setVisibility(PUBLIC)
  const beforeRevoke = await useCases.getById(game.id);
  assert.equal(beforeRevoke?.visibility, "PUBLIC");
  assert.equal(beforeRevoke?.liveVersionId, version.id);

  await useCases.revokeApproval({ versionId: version.id, adminId: 99, reason: null });

  const afterRevoke = await useCases.getById(game.id);
  assert.equal(afterRevoke?.visibility, "PRIVATE");
  assert.equal(afterRevoke?.liveVersionId, null);
});

test("revokeApproval leaves the game alone at the game level if a different version is now live", async () => {
  const { useCases, game, version: firstVersion } = await createGameWithLiveVersion();
  const secondVersion = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(20),
  });
  await useCases.decideVersion({
    versionId: secondVersion.id,
    adminId: 99,
    decision: "APPROVED",
    reason: null,
  });
  await useCases.setLiveVersion(game.id, 99, secondVersion.id);

  // Revoke the OLDER, no-longer-live version — the game itself must be untouched.
  await useCases.revokeApproval({ versionId: firstVersion.id, adminId: 99, reason: null });

  const afterRevoke = await useCases.getById(game.id);
  assert.equal(afterRevoke?.visibility, "PUBLIC");
  assert.equal(afterRevoke?.liveVersionId, secondVersion.id);
});

test("revokeApproval records an APPROVAL_REVOKED audit entry with the given reason", async () => {
  const { useCases, repo, version } = await createGameWithLiveVersion();
  await useCases.revokeApproval({ versionId: version.id, adminId: 99, reason: "테스트 사유" });
  assert.equal(repo.auditActions.at(-1), "APPROVAL_REVOKED");
});

test("revokeApproval refuses a version that is still pending", async () => {
  const { useCases } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  const pending = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(10),
  });

  await assert.rejects(
    () => useCases.revokeApproval({ versionId: pending.id, adminId: 99, reason: null }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "REVOKE_REQUIRES_APPROVED",
  );
});

test("revokeApproval refuses an already-rejected version", async () => {
  const { useCases } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  const version = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(10),
  });
  await useCases.decideVersion({
    versionId: version.id,
    adminId: 99,
    decision: "REJECTED",
    reason: "부적절함",
  });

  await assert.rejects(
    () => useCases.revokeApproval({ versionId: version.id, adminId: 99, reason: null }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "REVOKE_REQUIRES_APPROVED",
  );
});

test("revokeApproval on an unknown version id is VERSION_NOT_FOUND", async () => {
  const { useCases } = createUseCases();
  await assert.rejects(
    () => useCases.revokeApproval({ versionId: 999, adminId: 99, reason: null }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "VERSION_NOT_FOUND",
  );
});

test("listAll returns every game regardless of developer, visibility, or deletion", async () => {
  const { useCases } = createUseCases();
  await useCases.createGame({
    slug: "private-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  const other = await useCases.createGame({
    slug: "other-devs-game",
    developerUserId: 2,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  await useCases.deleteGame({ gameId: other.id, actorAdminId: 9 });

  // Regression (2026-08-18): listAll used to exclude soft-deleted games, which made purgeGame
  // (only ever reachable on an already-deleted game) practically undiscoverable — an admin had
  // no way to find one without already knowing its id. See purgeGame's doc comment.
  const all = await useCases.listAll();
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((g) => g.slug).sort(), ["other-devs-game", "private-game"]);
  assert.ok(all.find((g) => g.slug === "other-devs-game")?.deletedAt !== null);
});

test("setVisibility refuses a soft-deleted game with ALREADY_DELETED", async () => {
  const { useCases } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  await useCases.deleteGame({ gameId: game.id, actorAdminId: 9 });

  // Without this guard, listAll now including deleted games would let a stray PATCH flip a
  // soft-deleted row's visibility back to PUBLIC with no explicit undelete ever happening.
  await assert.rejects(
    () => useCases.setVisibility(game.id, 9, "PRIVATE"),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "ALREADY_DELETED",
  );
});

test("deleting a game forces it PRIVATE, which is what the serving gates actually read", async () => {
  const { useCases, game } = await createGameWithLiveVersion();
  const deleted = await useCases.deleteGame({ gameId: game.id, actorAdminId: 9 });

  assert.notEqual(deleted.deletedAt, null);
  assert.equal(deleted.visibility, "PRIVATE");
});

test("deletePublishedVersion removes exactly the objects the manifest lists, leaving the source archive", async () => {
  const { publisher, storage, repo, game, version } = await createGameWithLiveVersion();

  await publisher.deletePublishedVersion({
    gameId: version.gameId,
    versionId: version.id,
    contentHash: version.contentHash,
    manifestKey: repo.versions.get(version.id)?.manifestKey ?? null,
    sourceObjectKey: version.objectKey,
    publishStatus: version.publishStatus,
    publishError: version.publishError,
  });

  assert.ok(!storage.objects.has(`games/${game.id}/${version.id}/index.html`));
  assert.ok(!storage.objects.has(`games/${game.id}/${version.id}/Build/game.wasm`));
  assert.ok(!storage.objects.has(`games/${game.id}/${version.id}/.owogg-manifest.json`));
  assert.ok(storage.objects.has(version.objectKey), "source archive must survive");

  const after: SandboxGamePublishStatus | undefined = repo.versions.get(version.id)?.publishStatus;
  assert.equal(after, "FAILED");
});

test("deletePublishedVersion falls back to the source ZIP when an interrupted publish has no manifest", async () => {
  const { publisher, storage, repo, game, version } = await createGameWithLiveVersion();
  const manifestKey = repo.versions.get(version.id)?.manifestKey ?? null;
  assert.ok(manifestKey);
  storage.objects.delete(manifestKey);
  await repo.setVersionPublishState(version.id, {
    publishStatus: "FAILED",
    publishError: "interrupted before manifest commit",
    publishedAt: null,
    manifestKey: null,
    publishedSizeBytes: null,
    fileCount: null,
  });

  await publisher.deletePublishedVersion({
    gameId: version.gameId,
    versionId: version.id,
    contentHash: version.contentHash,
    manifestKey: null,
    sourceObjectKey: version.objectKey,
    publishStatus: "FAILED",
    publishError: "interrupted before manifest commit",
  });

  assert.ok(!storage.objects.has(`games/${game.id}/${version.id}/index.html`));
  assert.ok(!storage.objects.has(`games/${game.id}/${version.id}/Build/game.wasm`));
  assert.ok(
    storage.objects.has(version.objectKey),
    "GC primitive leaves source lifecycle to caller",
  );
});

// ── review-slot quota ─────────────────────────────────────────────────────────

test("createGame claims a review slot, visible on the returned record", async () => {
  const { useCases } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  assert.equal(game.reviewSlot, 1);
});

test("a third concurrent submission is rejected with SUBMISSION_LIMIT_REACHED", async () => {
  const { useCases } = createUseCases();
  const create = (slug: string) =>
    useCases.createGame({
      slug,
      developerUserId: 1,
      title: "Game",
      shortDescription: null,
      description: null,
      genre: "puzzle",
      mode: "single",
    });

  await create("game-1");
  await create("game-2");

  await assert.rejects(
    () => create("game-3"),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "SUBMISSION_LIMIT_REACHED",
  );
});

test("this is not a lifetime cap: a decided game frees its slot for an unlimited number of future submissions", async () => {
  const { useCases, archives } = createUseCases();
  for (let i = 0; i < 5; i++) {
    const slug = `game-${i}`;
    const game = await useCases.createGame({
      slug,
      developerUserId: 1,
      title: "Game",
      shortDescription: null,
      description: null,
      genre: "puzzle",
      mode: "single",
    });
    archives.entries = {
      ...MINIMAL_BUNDLE,
      [OWOGG_GAME_CREATOR_MANIFEST_FILENAME]: creatorManifestBytes({
        slug,
        title: "Game",
        genre: "puzzle",
        mode: "single",
      }),
    };
    const version = await useCases.uploadVersion({
      gameId: game.id,
      actingUserId: 1,
      isAdmin: false,
      bytes: new ArrayBuffer(10),
    });
    // Decide it immediately so the next iteration's createGame has a free slot again.
    await useCases.decideVersion({
      versionId: version.id,
      adminId: 99,
      decision: i % 2 === 0 ? "APPROVED" : "REJECTED",
      reason: i % 2 === 0 ? null : "no",
    });
  }
  // If this ran, 5 games were created sequentially by one developer despite a 2-slot cap —
  // proving the cap bounds *concurrently open* submissions, not lifetime game count.
});

test("this is not a cap on total approved games: multiple already-approved games coexist without occupying slots", async () => {
  const { useCases, repo, archives } = createUseCases();
  const approvedIds: number[] = [];
  for (let i = 0; i < 3; i++) {
    const slug = `game-${i}`;
    const game = await useCases.createGame({
      slug,
      developerUserId: 1,
      title: "Game",
      shortDescription: null,
      description: null,
      genre: "puzzle",
      mode: "single",
    });
    archives.entries = {
      ...MINIMAL_BUNDLE,
      [OWOGG_GAME_CREATOR_MANIFEST_FILENAME]: creatorManifestBytes({
        slug,
        title: "Game",
        genre: "puzzle",
        mode: "single",
      }),
    };
    const version = await useCases.uploadVersion({
      gameId: game.id,
      actingUserId: 1,
      isAdmin: false,
      bytes: new ArrayBuffer(10),
    });
    await useCases.decideVersion({
      versionId: version.id,
      adminId: 99,
      decision: "APPROVED",
      reason: null,
    });
    approvedIds.push(game.id);
  }
  for (const id of approvedIds) {
    assert.equal(repo.games.get(id)?.reviewSlot, null, "an approved game must not hold a slot");
  }
  // A 4th and 5th concurrent NEW submission still succeed, since none of the 3 approved games
  // hold a slot anymore.
  await useCases.createGame({
    slug: "game-4",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  await useCases.createGame({
    slug: "game-5",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
});

test("REJECTED also releases the review slot, not just APPROVED", async () => {
  const { useCases, repo } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  const version = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(10),
  });
  await useCases.decideVersion({
    versionId: version.id,
    adminId: 99,
    decision: "REJECTED",
    reason: "no good",
  });
  assert.equal(repo.games.get(game.id)?.reviewSlot, null);
});

test("withdrawSubmission releases the slot and marks the pending version WITHDRAWN", async () => {
  const { useCases, repo } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  const version = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(10),
  });

  const withdrawn = await useCases.withdrawSubmission({ gameId: game.id, actingUserId: 1 });
  assert.equal(withdrawn.reviewSlot, null);
  assert.equal(repo.versions.get(version.id)?.status, "WITHDRAWN");
});

test("withdrawSubmission frees the slot for a new submission", async () => {
  const { useCases } = createUseCases();
  const g1 = await useCases.createGame({
    slug: "game-1",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  await useCases.createGame({
    slug: "game-2",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  await useCases.withdrawSubmission({ gameId: g1.id, actingUserId: 1 });

  const g3 = await useCases.createGame({
    slug: "game-3",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  assert.equal(g3.reviewSlot, 1);
});

test("withdrawSubmission rejects a non-owner", async () => {
  const { useCases } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () => useCases.withdrawSubmission({ gameId: game.id, actingUserId: 999 }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "NOT_OWNER",
  );
});

test("withdrawSubmission on a game with no open slot is rejected with NOTHING_TO_WITHDRAW", async () => {
  const { useCases } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  const version = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(10),
  });
  await useCases.decideVersion({
    versionId: version.id,
    adminId: 99,
    decision: "APPROVED",
    reason: null,
  });

  await assert.rejects(
    () => useCases.withdrawSubmission({ gameId: game.id, actingUserId: 1 }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "NOTHING_TO_WITHDRAW",
  );
});

test("different developers have independent review-slot budgets", async () => {
  const { useCases } = createUseCases();
  const create = (slug: string, developerUserId: number) =>
    useCases.createGame({
      slug,
      developerUserId,
      title: "Game",
      shortDescription: null,
      description: null,
      genre: "puzzle",
      mode: "single",
    });

  await create("dev-a-1", 1);
  await create("dev-a-2", 1);
  // Developer 1 is now at their limit — developer 2 is unaffected.
  const b1 = await create("dev-b-1", 2);
  assert.equal(b1.reviewSlot, 1);
});

// ── createGameFromBundle ──────────────────────────────────────────────────────

/** Defaults `mode` to "single" and always includes a valid logo file, so every existing test that
 * only cares about ONE specific validation failure doesn't also have to think about the two
 * newer requirements (2026-08-18) — tests that specifically exercise INVALID_MODE/LOGO_REQUIRED/
 * LOGO_TOO_LARGE override or omit these explicitly instead. */
function manifestEntries(
  manifest: Record<string, unknown>,
  extra: Record<string, Uint8Array> = MINIMAL_BUNDLE,
): Record<string, Uint8Array> {
  // A caller-provided `extra` keeps whichever `owogg.logo.*` entry it already has (e.g. the
  // oversized-logo test) — only default one in when none is present at all.
  const hasLogo = Object.keys(extra).some((path) => path.startsWith("owogg.logo."));
  return {
    ...extra,
    [OWOGG_GAME_CREATOR_MANIFEST_FILENAME]: creatorManifestBytes({ mode: "single", ...manifest }),
    ...(hasLogo ? {} : { "owogg.logo.png": bytes("fake-logo-bytes") }),
  };
}

test("createGameFromBundle creates the game and its first version from the embedded manifest", async () => {
  const { useCases, repo } = createUseCases(
    manifestEntries({ slug: "ball-dodge", title: "공 피하기", genre: "action" }),
  );

  const { game, version } = await useCases.createGameFromBundle({
    developerUserId: 1,
    bytes: new ArrayBuffer(10),
  });

  assert.equal(game.slug, "ball-dodge");
  assert.equal(game.title, "공 피하기");
  assert.equal(game.genre, "action");
  assert.equal(game.developerUserId, 1);
  assert.equal(game.reviewSlot, 1);
  assert.equal(version.gameId, game.id);
  assert.equal(version.status, "PENDING_REVIEW");
  assert.equal(repo.versions.size, 1);
});

test("createGameFromBundle only decompresses the archive once (shared with the upload)", async () => {
  const { useCases, archives } = createUseCases(
    manifestEntries({ slug: "ball-dodge", title: "공 피하기", genre: "action" }),
  );
  await useCases.createGameFromBundle({ developerUserId: 1, bytes: new ArrayBuffer(10) });
  assert.equal(archives.readCalls, 1);
});

test("createGameFromBundle rejects a bundle with no manifest as MANIFEST_MISSING", async () => {
  const { useCases } = createUseCases(MINIMAL_BUNDLE);
  await assert.rejects(
    () => useCases.createGameFromBundle({ developerUserId: 1, bytes: new ArrayBuffer(10) }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "MANIFEST_MISSING",
  );
});

test("createGameFromBundle rejects a manifest missing/invalid slug as MANIFEST_INVALID", async () => {
  const { useCases } = createUseCases(manifestEntries({ title: "공 피하기", genre: "action" }));
  await assert.rejects(
    () => useCases.createGameFromBundle({ developerUserId: 1, bytes: new ArrayBuffer(10) }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "MANIFEST_INVALID",
  );
});

test("createGameFromBundle rejects a manifest missing/invalid title as MANIFEST_INVALID", async () => {
  const { useCases } = createUseCases(manifestEntries({ slug: "ball-dodge", genre: "action" }));
  await assert.rejects(
    () => useCases.createGameFromBundle({ developerUserId: 1, bytes: new ArrayBuffer(10) }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "MANIFEST_INVALID",
  );
});

test("createGameFromBundle rejects a manifest with a blank genre as MANIFEST_INVALID", async () => {
  const { useCases } = createUseCases(
    manifestEntries({ slug: "ball-dodge", title: "공 피하기", genre: "   " }),
  );
  await assert.rejects(
    () => useCases.createGameFromBundle({ developerUserId: 1, bytes: new ArrayBuffer(10) }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "MANIFEST_INVALID",
  );
});

test("createGameFromBundle rejects a manifest with a non-string genre as MANIFEST_INVALID", async () => {
  const { useCases } = createUseCases(
    manifestEntries({ slug: "ball-dodge", title: "공 피하기", genre: 5 }),
  );
  await assert.rejects(
    () => useCases.createGameFromBundle({ developerUserId: 1, bytes: new ArrayBuffer(10) }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "MANIFEST_INVALID",
  );
});

test("replaceManifest rebuilds a new review version without mutating the existing version", async () => {
  const { useCases, repo, storage } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  const original = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: bytes("original").buffer as ArrayBuffer,
  });
  const replacement = creatorManifestBytes({
    slug: "my-game",
    title: "Corrected title",
    genre: "arcade",
    mode: "multi",
  });

  const revised = await useCases.replaceManifest({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: replacement.buffer as ArrayBuffer,
  });

  assert.notEqual(revised.id, original.id);
  assert.equal(revised.status, "PENDING_REVIEW");
  assert.equal(repo.versions.get(original.id)?.contentHash, original.contentHash);
  const published = storage.objects.get(`games/${game.id}/${revised.id}/owogg.json`);
  assert.ok(published);
  const manifest = JSON.parse(new TextDecoder().decode(published.bytes)) as {
    game: { title: string; mode: string };
  };
  assert.equal(manifest.game.title, "Corrected title");
  assert.equal(manifest.game.mode, "multi");
});

test("replaceLogo switches to a content-addressed object and removes the previous logo", async () => {
  const { useCases, repo, storage } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  const oldKey = `games/${game.id}/logo.png`;
  await storage.putObject({ key: oldKey, bytes: bytes("old"), contentType: "image/png" });
  await repo.setLogo(game.id, oldKey, new Date().toISOString());

  const updated = await useCases.replaceLogo({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    fileName: "new-logo.webp",
    bytes: bytes("new-logo").buffer as ArrayBuffer,
  });

  assert.match(updated.logoKey ?? "", new RegExp(`^games/${game.id}/logos/[a-f0-9]{64}\\.webp$`));
  assert.equal(storage.objects.has(oldKey), false);
  assert.ok(updated.logoKey && storage.objects.has(updated.logoKey));
  assert.ok(repo.auditActions.includes("LOGO_CHANGED"));
});

test("replaceLogo keeps the live object when an identical re-upload cannot update D1", async () => {
  const { useCases, repo, storage } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  const logoBytes = bytes("stable-logo").buffer as ArrayBuffer;
  const first = await useCases.replaceLogo({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    fileName: "logo.png",
    bytes: logoBytes,
  });
  const liveKey = first.logoKey;
  assert.ok(liveKey && storage.objects.has(liveKey));

  repo.setLogo = async () => {
    throw new Error("simulated D1 failure");
  };
  await assert.rejects(
    useCases.replaceLogo({
      gameId: game.id,
      actingUserId: 1,
      isAdmin: false,
      fileName: "same-content.png",
      bytes: logoBytes,
    }),
    (error: unknown) =>
      error instanceof SandboxGameUseCaseFailure && error.code === "PUBLISH_FAILED",
  );

  assert.equal(repo.games.get(game.id)?.logoKey, liveKey);
  assert.ok(liveKey && storage.objects.has(liveKey));
  assert.equal(storage.deletedKeys.includes(liveKey ?? ""), false);
});

test("createGameFromBundle surfaces a slug collision as SLUG_TAKEN, same as the manual form", async () => {
  const { useCases } = createUseCases(
    manifestEntries({ slug: "ball-dodge", title: "공 피하기", genre: "action" }),
  );
  await useCases.createGame({
    slug: "ball-dodge",
    developerUserId: 2,
    title: "Existing",
    shortDescription: null,
    description: null,
    genre: "arcade",
    mode: "single",
  });

  await assert.rejects(
    () => useCases.createGameFromBundle({ developerUserId: 1, bytes: new ArrayBuffer(10) }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "SLUG_TAKEN",
  );
});

test("createGameFromBundle rejects malformed JSON as MANIFEST_INVALID", async () => {
  const { useCases } = createUseCases({
    ...MINIMAL_BUNDLE,
    [OWOGG_GAME_CREATOR_MANIFEST_FILENAME]: bytes("{ not json"),
  });
  await assert.rejects(
    () => useCases.createGameFromBundle({ developerUserId: 1, bytes: new ArrayBuffer(10) }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "MANIFEST_INVALID",
  );
});

// ── createGameFromBundle: mode + logo (2026-08-18) ────────────────────────────

test("createGameFromBundle rejects a missing mode as INVALID_MODE", async () => {
  const { useCases } = createUseCases({
    ...MINIMAL_BUNDLE,
    "owogg.logo.png": bytes("fake-logo-bytes"),
    [OWOGG_GAME_CREATOR_MANIFEST_FILENAME]: creatorManifestBytes({
      slug: "ball-dodge",
      title: "공 피하기",
      genre: "action",
    }),
  });
  await assert.rejects(
    () => useCases.createGameFromBundle({ developerUserId: 1, bytes: new ArrayBuffer(10) }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "MANIFEST_INVALID",
  );
});

test("createGameFromBundle rejects a mode outside single/multi as INVALID_MODE", async () => {
  const { useCases } = createUseCases(
    manifestEntries({ slug: "ball-dodge", title: "공 피하기", genre: "action", mode: "coop" }),
  );
  await assert.rejects(
    () => useCases.createGameFromBundle({ developerUserId: 1, bytes: new ArrayBuffer(10) }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "MANIFEST_INVALID",
  );
});

test("createGameFromBundle rejects a bundle with no logo file as LOGO_REQUIRED", async () => {
  const { useCases } = createUseCases({
    ...MINIMAL_BUNDLE,
    [OWOGG_GAME_CREATOR_MANIFEST_FILENAME]: creatorManifestBytes({
      slug: "ball-dodge",
      title: "공 피하기",
      genre: "action",
      mode: "single",
    }),
  });
  await assert.rejects(
    () => useCases.createGameFromBundle({ developerUserId: 1, bytes: new ArrayBuffer(10) }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "LOGO_REQUIRED",
  );
});

test("createGameFromBundle accepts any of the logo extensions (png/jpg/jpeg/webp/svg)", async () => {
  for (const ext of ["png", "jpg", "jpeg", "webp", "svg"]) {
    const { useCases } = createUseCases({
      ...MINIMAL_BUNDLE,
      [`owogg.logo.${ext}`]: bytes("fake-logo-bytes"),
      [OWOGG_GAME_CREATOR_MANIFEST_FILENAME]: creatorManifestBytes({
        slug: `ball-dodge-${ext}`,
        title: "공 피하기",
        genre: "action",
        mode: "single",
      }),
    });
    const { game } = await useCases.createGameFromBundle({
      developerUserId: 1,
      bytes: new ArrayBuffer(10),
    });
    assert.equal(game.slug, `ball-dodge-${ext}`, `expected .${ext} logo to be accepted`);
  }
});

test("createGameFromBundle rejects an oversized logo as LOGO_TOO_LARGE", async () => {
  const { useCases } = createUseCases(
    manifestEntries(
      { slug: "ball-dodge", title: "공 피하기", genre: "action" },
      {
        ...MINIMAL_BUNDLE,
        "owogg.logo.png": new Uint8Array(SANDBOX_GAME_POLICY.MAX_LOGO_BYTES + 1),
      },
    ),
  );
  await assert.rejects(
    () => useCases.createGameFromBundle({ developerUserId: 1, bytes: new ArrayBuffer(10) }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "LOGO_TOO_LARGE",
  );
});

test("createGameFromBundle links the game's logoKey and excludes the logo from published files", async () => {
  const { useCases, repo, publisher } = createUseCases(
    manifestEntries({ slug: "ball-dodge", title: "공 피하기", genre: "action" }),
  );
  const publishSpy: string[][] = [];
  const originalPublish = publisher.publish.bind(publisher);
  publisher.publish = async (input) => {
    publishSpy.push(input.prepared.files.map((f) => f.path));
    return originalPublish(input);
  };

  const { game } = await useCases.createGameFromBundle({
    developerUserId: 1,
    bytes: new ArrayBuffer(10),
  });

  const stored = repo.games.get(game.id);
  assert.equal(stored?.logoKey, `games/${game.id}/logo.png`);
  assert.ok(
    publishSpy[0] && !publishSpy[0].includes("owogg.logo.png"),
    "the logo must not be published as a servable game asset",
  );
  assert.ok(publishSpy[0]?.includes("index.html"), "index.html must still be published");
});

// ── deleteGame ─────────────────────────────────────────────────────────────────

test("deleteGame soft-deletes the game, forces it PRIVATE, and records a DELETED audit entry", async () => {
  const { useCases, repo } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  // Take this game past its review slot so deletion doesn't also exercise the withdraw path here.
  await useCases.withdrawSubmission({ gameId: game.id, actingUserId: 1 });

  const deleted = await useCases.deleteGame({ gameId: game.id, actorAdminId: 9 });

  assert.notEqual(deleted.deletedAt, null);
  assert.equal(deleted.deletedByAdminId, 9);
  assert.equal(deleted.visibility, "PRIVATE");
  assert.equal(repo.auditActions.at(-1), "DELETED");
});

test("deleteGame releases an open review slot and withdraws the pending version", async () => {
  const { useCases, repo } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  const version = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(10),
  });
  assert.notEqual(game.reviewSlot, null);

  const deleted = await useCases.deleteGame({ gameId: game.id, actorAdminId: 9 });

  assert.equal(deleted.reviewSlot, null);
  assert.equal(repo.versions.get(version.id)?.status, "WITHDRAWN");
});

test("deleteGame frees the review slot for a new submission, same as withdrawSubmission", async () => {
  const { useCases } = createUseCases();
  const g1 = await useCases.createGame({
    slug: "game-1",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  await useCases.createGame({
    slug: "game-2",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  await useCases.deleteGame({ gameId: g1.id, actorAdminId: 9 });

  const g3 = await useCases.createGame({
    slug: "game-3",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  assert.equal(g3.reviewSlot, 1);
});

test("deleteGame is idempotent-failure: a second call returns ALREADY_DELETED, not a silent no-op", async () => {
  const { useCases } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  await useCases.deleteGame({ gameId: game.id, actorAdminId: 9 });

  await assert.rejects(
    () => useCases.deleteGame({ gameId: game.id, actorAdminId: 9 }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "ALREADY_DELETED",
  );
});

test("deleteGame on an unknown game id is GAME_NOT_FOUND", async () => {
  const { useCases } = createUseCases();
  await assert.rejects(
    () => useCases.deleteGame({ gameId: 999, actorAdminId: 9 }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "GAME_NOT_FOUND",
  );
});

// ── purgeGame (admin-only, follow-up to deleteGame) ─────────────────────────────

test("purgeGame hard-deletes an already soft-deleted game and frees its slug", async () => {
  const { useCases } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  await useCases.deleteGame({ gameId: game.id, actorAdminId: 9 });

  await useCases.purgeGame({ gameId: game.id, actorAdminId: 9 });

  assert.equal(await useCases.getById(game.id), null);

  // The whole point: the slug is genuinely free again, not just SLUG_TAKEN-avoided.
  const reregistered = await useCases.createGame({
    slug: "my-game",
    developerUserId: 2,
    title: "Reregistered",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  assert.equal(reregistered.slug, "my-game");
});

test("purgeGame refuses a game that hasn't been soft-deleted yet, with NOT_YET_DELETED", async () => {
  const { useCases } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () => useCases.purgeGame({ gameId: game.id, actorAdminId: 9 }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "NOT_YET_DELETED",
  );
});

test("purgeGame permanently reserves the slug after any approval, even when approval was revoked", async () => {
  const { useCases, repo } = createUseCases();
  const game = await useCases.createGame({
    slug: "published-game",
    developerUserId: 1,
    title: "Published",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  repo.reservedSlugs.add(game.slug);
  await useCases.deleteGame({ gameId: game.id, actorAdminId: 9 });

  await assert.rejects(
    () => useCases.purgeGame({ gameId: game.id, actorAdminId: 9 }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "CANNOT_PURGE_APPROVED_GAME",
  );
  assert.equal(await repo.slugExists("published-game"), true);
});

test("purgeGame on an unknown game id is GAME_NOT_FOUND", async () => {
  const { useCases } = createUseCases();
  await assert.rejects(
    () => useCases.purgeGame({ gameId: 999, actorAdminId: 9 }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "GAME_NOT_FOUND",
  );
});

// ── deleteOwnGame (Game Creator self-service) ───────────────────────────────────

test("deleteOwnGame hard-deletes a never-approved game — findById/findBySlug both return null afterward", async () => {
  const { useCases, repo } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await useCases.deleteOwnGame({ gameId: game.id, developerUserId: 1 });

  assert.equal(await useCases.getById(game.id), null);
  assert.equal(repo.games.has(game.id), false);
});

test("deleteOwnGame frees the slug for immediate reuse, unlike admin's soft-delete", async () => {
  const { useCases } = createUseCases();
  const game = await useCases.createGame({
    slug: "ball-dodge",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  await useCases.deleteOwnGame({ gameId: game.id, developerUserId: 1 });

  // The exact production scenario this fixes: a failed drag-and-drop registration leaves an
  // orphaned game with no version, blocking the slug — deleteOwnGame must let the Game Creator retry
  // with the identical slug.
  const retried = await useCases.createGame({
    slug: "ball-dodge",
    developerUserId: 1,
    title: "Game (retry)",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  assert.equal(retried.slug, "ball-dodge");
});

test("deleteOwnGame also removes any pending version — it isn't left dangling in the review queue", async () => {
  const { useCases, repo } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });
  const version = await useCases.uploadVersion({
    gameId: game.id,
    actingUserId: 1,
    isAdmin: false,
    bytes: new ArrayBuffer(10),
  });

  await useCases.deleteOwnGame({ gameId: game.id, developerUserId: 1 });

  assert.equal(repo.versions.has(version.id), false);
});

test("deleteOwnGame rejects a non-owner with NOT_OWNER", async () => {
  const { useCases } = createUseCases();
  const game = await useCases.createGame({
    slug: "my-game",
    developerUserId: 1,
    title: "Game",
    shortDescription: null,
    description: null,
    genre: "puzzle",
    mode: "single",
  });

  await assert.rejects(
    () => useCases.deleteOwnGame({ gameId: game.id, developerUserId: 999 }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "NOT_OWNER",
  );
  // Confirm it really wasn't deleted, not just that the error code is right.
  assert.notEqual(await useCases.getById(game.id), null);
});

test("deleteOwnGame on an unknown game id is GAME_NOT_FOUND", async () => {
  const { useCases } = createUseCases();
  await assert.rejects(
    () => useCases.deleteOwnGame({ gameId: 999, developerUserId: 1 }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "GAME_NOT_FOUND",
  );
});

test("deleteOwnGame refuses a game with an approved version, even a not-currently-live one", async () => {
  const { useCases, game } = await createGameWithLiveVersion();

  await assert.rejects(
    () => useCases.deleteOwnGame({ gameId: game.id, developerUserId: 1 }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "CANNOT_DELETE_APPROVED_GAME",
  );
  // Still there — the refusal must not have half-deleted anything.
  assert.notEqual(await useCases.getById(game.id), null);
});

test("approve -> revoke -> creator delete stays blocked and the slug cannot be registered again", async () => {
  const { useCases, repo, game, version } = await createGameWithLiveVersion();

  const revoked = await useCases.revokeApproval({
    versionId: version.id,
    adminId: 99,
    reason: "re-review",
  });
  assert.equal(revoked.status, "PENDING_REVIEW");

  await assert.rejects(
    () => useCases.deleteOwnGame({ gameId: game.id, developerUserId: 1 }),
    (err: unknown) =>
      err instanceof SandboxGameUseCaseFailure && err.code === "CANNOT_DELETE_APPROVED_GAME",
  );
  assert.equal(await repo.isSlugPermanentlyReserved(game.slug), true);

  await assert.rejects(
    () =>
      useCases.createGame({
        slug: game.slug,
        developerUserId: 2,
        title: "Different Game",
        shortDescription: null,
        description: null,
        genre: "puzzle",
        mode: "single",
      }),
    (err: unknown) => err instanceof SandboxGameUseCaseFailure && err.code === "SLUG_TAKEN",
  );
});
