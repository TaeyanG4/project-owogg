import test from "node:test";
import assert from "node:assert/strict";
import {
  SandboxGameRecordSchema,
  SandboxGameListResponseSchema,
  SandboxGameDetailResponseSchema,
  SandboxGameUploadResponseSchema,
  SandboxGameReviewQueueResponseSchema,
  SandboxGameVersionRecordSchema,
  toSandboxGameRecordResponse,
  SandboxGameBasicMetadataUpdateRequestSchema,
  GameLogoUpdateResponseSchema,
  AdminSandboxGameListResponseSchema,
  AdminSandboxGameListQuerySchema,
  AdminGameListResponseSchema,
  AdminGameListQuerySchema,
} from "@owogg/contracts";

/** Regression guard for the 2026-08-18 outage: SandboxGameRecordSchema was a `.transform()` whose
 * *input* required the internal `logoKey` but whose *output* replaced it with `hasLogo`. The API
 * built responses with it (so the wire bytes had no `logoKey`) and the web client parsed those same
 * bytes with the same schema — which then failed "logoKey: Required" on every single request. The
 * Game Creator Center and the admin review page both went blank with a contract error.
 *
 * Nothing in the old suite caught it, because server tests only ever checked the *server* direction.
 * The missing invariant is the round trip: a wire schema must parse what it itself produced, after
 * a real JSON serialize/deserialize (which is what the network does to it).
 *
 * Every response schema on this surface is covered, not just the one that broke, so the same class
 * of asymmetry can't be reintroduced elsewhere. */

/** Shape the core layer hands the API: internal `logoKey`, no `hasLogo`. */
const coreGameRecord = {
  id: 5,
  slug: "ball-dodge",
  developerUserId: 1,
  title: "공 피하기",
  shortDescription: "마우스로 캐릭터를 움직여 떨어지는 공을 피하는 게임",
  description: null,
  genre: "arcade",
  mode: "single" as const,
  logoKey: "games/5/logo.svg",
  xpPerCompletion: 0,
  scoreUnit: null,
  scoreDirection: null,
  scoreMin: null,
  scoreMax: null,
  scoreDisplayPrefix: null,
  scoreDisplaySuffix: null,
  visibility: "PUBLIC" as const,
  liveVersionId: 1,
  reviewSlot: null,
  deletedAt: null,
  deletedByAdminId: null,
  createdAt: "2026-08-18T05:27:02.023Z",
  updatedAt: "2026-08-18T06:02:47.733Z",
};

const coreVersionRecord = {
  id: 1,
  gameId: 5,
  objectKey: "games/5/versions/1/source.zip",
  contentHash: "abc123",
  bundleBytes: 4096,
  status: "APPROVED" as const,
  reviewedByAdminId: 1,
  reviewedAt: "2026-08-18T05:40:00.000Z",
  rejectReason: null,
  uploadedAt: "2026-08-18T05:27:02.023Z",
  publishStatus: "READY" as const,
  publishError: null,
  publishedAt: "2026-08-18T05:30:00.000Z",
  publishedSizeBytes: 8192,
  fileCount: 5,
};

/** Serializes exactly the way Hono's c.json + the network do, then re-parses — the step that the
 * broken schema could not survive. */
function assertRoundTrips(schema: { parse: (v: unknown) => unknown }, serverInput: unknown) {
  const responseBody = schema.parse(serverInput);
  const overTheWire: unknown = JSON.parse(JSON.stringify(responseBody));
  assert.doesNotThrow(
    () => schema.parse(overTheWire),
    "schema must parse its own serialized output — the client parses the exact same bytes",
  );
  return overTheWire;
}

test("toSandboxGameRecordResponse strips logoKey and derives hasLogo", () => {
  const withLogo = toSandboxGameRecordResponse(coreGameRecord);
  assert.equal("logoKey" in withLogo, false, "the internal storage key must never reach the wire");
  assert.equal(withLogo.hasLogo, true);

  const withoutLogo = toSandboxGameRecordResponse({ ...coreGameRecord, logoKey: null });
  assert.equal(withoutLogo.hasLogo, false);
});

test("SandboxGameRecordSchema round-trips its own output", () => {
  const wire = assertRoundTrips(
    SandboxGameRecordSchema,
    toSandboxGameRecordResponse(coreGameRecord),
  ) as Record<string, unknown>;
  assert.equal(wire.hasLogo, true);
  assert.equal("logoKey" in wire, false);
});

test("SandboxGameListResponseSchema round-trips its own output", () => {
  assertRoundTrips(SandboxGameListResponseSchema, {
    games: [coreGameRecord, { ...coreGameRecord, id: 6, logoKey: null }].map(
      toSandboxGameRecordResponse,
    ),
  });
});

test("SandboxGameDetailResponseSchema round-trips its own output", () => {
  assertRoundTrips(SandboxGameDetailResponseSchema, {
    game: toSandboxGameRecordResponse(coreGameRecord),
    versions: [coreVersionRecord],
    auditLog: [
      {
        id: 1,
        gameId: 5,
        versionId: 1,
        actorAdminId: 1,
        action: "APPROVE",
        reason: null,
        metadata: null,
        createdAt: "2026-08-18T05:40:00.000Z",
      },
    ],
  });
});

test("SandboxGameUploadResponseSchema round-trips its own output", () => {
  assertRoundTrips(SandboxGameUploadResponseSchema, {
    game: toSandboxGameRecordResponse(coreGameRecord),
    version: coreVersionRecord,
  });
});

test("SandboxGameVersionRecordSchema round-trips and never leaks storage keys", () => {
  const wire = assertRoundTrips(SandboxGameVersionRecordSchema, coreVersionRecord) as Record<
    string,
    unknown
  >;
  assert.equal("objectKey" in wire, false);
  assert.equal("manifestKey" in wire, false);
});

test("SandboxGameReviewQueueResponseSchema round-trips its own output", () => {
  assertRoundTrips(SandboxGameReviewQueueResponseSchema, {
    entries: [
      {
        version: coreVersionRecord,
        gameId: 5,
        gameSlug: "ball-dodge",
        gameTitle: "공 피하기",
        developerUserId: 1,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  });
});

test("a raw core record fails to parse — forgetting the mapper is loud, not silent", () => {
  // The whole point of the symmetric schema: if a route skips toSandboxGameRecordResponse, it
  // breaks immediately and visibly instead of quietly shipping logoKey to a client.
  assert.throws(() => SandboxGameRecordSchema.parse(coreGameRecord));
});

test("creator basic metadata accepts only the safe non-identity subset", () => {
  const parsed = SandboxGameBasicMetadataUpdateRequestSchema.parse({
    title: "수정된 제목",
    genre: "arcade",
    mode: "multi",
    shortDescription: null,
  });
  assert.equal(parsed.mode, "multi");
  assert.throws(() =>
    SandboxGameBasicMetadataUpdateRequestSchema.parse({ title: "", slug: "changed" }),
  );
  assert.throws(() => SandboxGameBasicMetadataUpdateRequestSchema.parse({}));
});

test("logo replacement response exposes revision facts without a B2 object key", () => {
  const response = GameLogoUpdateResponseSchema.parse({
    gameId: 5,
    slug: "ball-dodge",
    hasLogo: true,
    updatedAt: "2026-08-25T00:00:00.000Z",
  });
  assert.equal("objectKey" in response, false);
});

test("admin USER game page round-trips server upload timestamps", () => {
  assertRoundTrips(AdminSandboxGameListResponseSchema, {
    entries: [
      {
        game: toSandboxGameRecordResponse(coreGameRecord),
        latestUploadedAt: "2026-08-25T09:30:00.000Z",
      },
    ],
    total: 31,
    page: 2,
    pageSize: 20,
    totalPages: 2,
  });
});

test("admin OWOGG game page carries server pagination and latest upload time", () => {
  const parsed = AdminGameListResponseSchema.parse({
    games: [
      {
        gameId: "official-game",
        title: "Official Game",
        shortDescription: null,
        description: null,
        genre: "arcade",
        mode: "single",
        latestUploadedAt: "2026-08-25T09:30:00.000Z",
        publisherType: "OWOGG",
        status: "published",
        enabled: true,
        disabledReason: null,
        updatedByAdminId: null,
        updatedAt: null,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  });
  assert.equal(parsed.games[0]?.latestUploadedAt, "2026-08-25T09:30:00.000Z");
});

test("admin game page size is limited to the 10, 20, and 30 presets", () => {
  for (const pageSize of [10, 20, 30]) {
    assert.equal(AdminGameListQuerySchema.parse({ pageSize }).pageSize, pageSize);
    assert.equal(AdminSandboxGameListQuerySchema.parse({ pageSize }).pageSize, pageSize);
  }
  assert.throws(() => AdminGameListQuerySchema.parse({ pageSize: 50 }));
  assert.throws(() => AdminSandboxGameListQuerySchema.parse({ pageSize: 50 }));
});
