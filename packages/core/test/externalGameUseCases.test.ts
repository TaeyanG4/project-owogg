import assert from "node:assert/strict";
import test from "node:test";
import {
  ExternalGameUseCaseFailure,
  ExternalGameUseCases,
} from "../src/application/externalGameUseCases.js";
import type {
  ExternalGameMediaRecord,
  ExternalGameRecord,
  ExternalGameRepository,
} from "../src/ports/externalGames.js";
import type { GameBundleStorageRepository } from "../src/ports/sandboxGames.js";

const NOW = new Date("2026-09-02T00:00:00.000Z");

function record(overrides: Partial<ExternalGameRecord> = {}): ExternalGameRecord {
  return {
    id: 1,
    slug: "indie-puzzle",
    introducerUserId: 10,
    introducerName: "소개자",
    title: "Indie Puzzle",
    shortDescription: "짧은 소개",
    descriptionMarkdown: "상세 소개",
    platformName: "itch.io",
    externalUrl: "https://example.com/game",
    releaseDate: "2026-09-02",
    tags: ["puzzle"],
    ownershipType: "THIRD_PARTY",
    rightsNote: "공식 소개 자료 사용 조건 확인",
    rightsAttestedAt: null,
    moderationStatus: "DRAFT",
    visibility: "PRIVATE",
    reviewSlot: null,
    rejectReason: null,
    reviewedByAdminId: null,
    reviewedAt: null,
    publishedAt: null,
    deletedAt: null,
    deletedByAdminId: null,
    bookmarkCount: 0,
    isBookmarked: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function storage(): GameBundleStorageRepository & {
  puts: string[];
  deletes: string[];
} {
  return {
    puts: [],
    deletes: [],
    async putObject(input) {
      this.puts.push(input.key);
    },
    async getObject() {
      return null;
    },
    async deleteObject(key) {
      this.deletes.push(key);
    },
  };
}

function failureCode(code: string) {
  return (error: unknown) => error instanceof ExternalGameUseCaseFailure && error.code === code;
}

test("review submission requires rights confirmation and at least one screenshot", async () => {
  let screenshots = 0;
  let submitted = false;
  const draft = record();
  const repo = {
    async findById() {
      return draft;
    },
    async countMedia(_gameId: number, kind: string) {
      return kind === "SCREENSHOT" ? screenshots : 0;
    },
    async submitForReview() {
      submitted = true;
      return record({
        moderationStatus: "PENDING_REVIEW",
        reviewSlot: 1,
        rightsAttestedAt: NOW.toISOString(),
      });
    },
  } as unknown as ExternalGameRepository;
  const useCases = new ExternalGameUseCases(repo, storage());

  await assert.rejects(
    useCases.submitOwn({ id: 1, userId: 10, rightsConfirmed: false, now: NOW }),
    failureCode("RIGHTS_CONFIRMATION_REQUIRED"),
  );
  await assert.rejects(
    useCases.submitOwn({ id: 1, userId: 10, rightsConfirmed: true, now: NOW }),
    failureCode("SCREENSHOT_REQUIRED"),
  );
  assert.equal(submitted, false);

  screenshots = 1;
  const result = await useCases.submitOwn({ id: 1, userId: 10, rightsConfirmed: true, now: NOW });
  assert.equal(result.moderationStatus, "PENDING_REVIEW");
  assert.equal(result.reviewSlot, 1);
  assert.equal(submitted, true);
});

test("media upload trusts the byte signature, stores under a hash key, and resets review state", async () => {
  const saved = storage();
  let prepared = false;
  let inserted: ExternalGameMediaRecord | null = null;
  const repo = {
    async findById() {
      return record({
        moderationStatus: "APPROVED",
        visibility: "PUBLIC",
        publishedAt: NOW.toISOString(),
      });
    },
    async listMedia() {
      return [];
    },
    async prepareForEdit() {
      prepared = true;
      return record();
    },
    async addMedia(input: Omit<ExternalGameMediaRecord, "id">) {
      inserted = { id: 5, ...input };
      return inserted;
    },
  } as unknown as ExternalGameRepository;
  const useCases = new ExternalGameUseCases(repo, saved);
  const pngSignature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const media = await useCases.uploadMedia({
    id: 1,
    userId: 10,
    kind: "SCREENSHOT",
    bytes: pngSignature.buffer,
    altText: " 소개 화면 ",
    now: NOW,
  });

  assert.equal(prepared, true);
  assert.equal(media.contentType, "image/png");
  assert.equal(media.altText, "소개 화면");
  assert.match(media.objectKey, /^external-games\/1\/media\/[a-f0-9]{64}\.png$/);
  assert.deepEqual(saved.puts, [media.objectKey]);
  assert.equal(inserted?.contentHash, media.contentHash);

  await assert.rejects(
    useCases.uploadMedia({
      id: 1,
      userId: 10,
      kind: "SCREENSHOT",
      bytes: new TextEncoder().encode("not an image").buffer,
      altText: "",
      now: NOW,
    }),
    failureCode("MEDIA_INVALID"),
  );
});

test("only approved public introductions can be read or bookmarked", async () => {
  let current = record();
  const repo = {
    async findBySlug() {
      return current;
    },
    async findById() {
      return current;
    },
    async addBookmark() {
      return 1;
    },
  } as unknown as ExternalGameRepository;
  const useCases = new ExternalGameUseCases(repo, storage());

  await assert.rejects(useCases.getPublicBySlug(current.slug, null), failureCode("NOT_FOUND"));
  await assert.rejects(
    useCases.bookmark({ id: current.id, userId: 11, bookmarked: true, now: NOW }),
    failureCode("NOT_FOUND"),
  );

  current = record({
    moderationStatus: "APPROVED",
    visibility: "PUBLIC",
    publishedAt: NOW.toISOString(),
  });
  assert.equal((await useCases.getPublicBySlug(current.slug, null)).id, current.id);
  assert.deepEqual(
    await useCases.bookmark({ id: current.id, userId: 11, bookmarked: true, now: NOW }),
    { bookmarked: true, bookmarkCount: 1 },
  );
});

test("a concurrent slug insert is still reported as SLUG_TAKEN", async () => {
  const repo = {
    async slugExists() {
      return false;
    },
    async create() {
      throw new Error("UNIQUE constraint failed: external_games.slug");
    },
  } as unknown as ExternalGameRepository;

  await assert.rejects(
    new ExternalGameUseCases(repo, storage()).create({
      slug: "indie-puzzle",
      introducerUserId: 10,
      content: {
        title: "Indie Puzzle",
        shortDescription: "소개",
        descriptionMarkdown: "상세 소개",
        platformName: "itch.io",
        externalUrl: "https://example.com/game",
        releaseDate: "2026-09-02",
        tags: [],
        ownershipType: "THIRD_PARTY",
        rightsNote: "",
      },
      now: NOW,
    }),
    failureCode("SLUG_TAKEN"),
  );
});

test("a losing duplicate upload never deletes an object already referenced by the winner", async () => {
  const saved = storage();
  let mediaReads = 0;
  const repo = {
    async findById() {
      return record();
    },
    async listMedia() {
      mediaReads++;
      if (mediaReads === 1) return [];
      return [
        {
          id: 9,
          externalGameId: 1,
          kind: "SCREENSHOT",
          objectKey: saved.puts[0]!,
          contentType: "image/png",
          byteSize: 8,
          contentHash: saved.puts[0]!.match(/[a-f0-9]{64}/)?.[0] ?? "0".repeat(64),
          altText: "winner",
          sortOrder: 0,
          createdAt: NOW.toISOString(),
        } satisfies ExternalGameMediaRecord,
      ];
    },
    async prepareForEdit() {
      return record();
    },
    async addMedia() {
      throw new Error("UNIQUE constraint failed: external_game_media.object_key");
    },
  } as unknown as ExternalGameRepository;
  const pngSignature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  await assert.rejects(
    new ExternalGameUseCases(repo, saved).uploadMedia({
      id: 1,
      userId: 10,
      kind: "SCREENSHOT",
      bytes: pngSignature.buffer,
      altText: "loser",
      now: NOW,
    }),
    failureCode("MEDIA_INVALID"),
  );
  assert.equal(saved.puts.length, 1);
  assert.deepEqual(saved.deletes, []);
});
