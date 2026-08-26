import assert from "node:assert/strict";
import test from "node:test";
import {
  OfficialMultiplayerProfileUseCases,
  type MultiplayerProfileRecord,
  type MultiplayerProfileRepository,
  type RuntimeGame,
  type RuntimeGameRegistry,
} from "../src/index.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");

function runtime(
  overrides: {
    slug?: string;
    publisher?: "OWOGG" | "USER";
    mode?: "single" | "multi";
    leaderboard?: boolean;
    score?: null | { unit: string; direction: "asc"; min: number; max: number };
    xpPerCompletion?: number;
    versionId?: number;
  } = {},
): RuntimeGame {
  const publisher = overrides.publisher ?? "OWOGG";
  const slug = overrides.slug ?? "official-omok";
  return {
    identity: {
      id: 11,
      slug,
      publisher: publisher === "OWOGG" ? { type: "OWOGG" } : { type: "USER", userId: 7 },
      visibility: "PUBLIC",
      liveVersionId: overrides.versionId ?? 12,
      deletedAt: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    },
    liveVersion: {
      id: overrides.versionId ?? 12,
      gameId: 11,
      objectKey: "games/11/12.zip",
      contentHash: "content-hash",
      bundleBytes: 100,
      publishStatus: "READY",
      publishError: null,
      publishedAt: NOW.toISOString(),
      manifestKey: "games/11/12/.owogg-manifest.json",
      publishedSizeBytes: 100,
      fileCount: 5,
      uploadedAt: NOW.toISOString(),
    },
    canonical: {
      schemaVersion: 3,
      slug,
      title: "온라인 오목",
      shortDescription: "fixture",
      description: "fixture",
      publisher: { official: publisher === "OWOGG" },
      policy: {
        score: overrides.score ?? null,
        leaderboard: overrides.leaderboard ?? false,
        xpPerCompletion: overrides.xpPerCompletion ?? 0,
        requiresAuth: false,
      },
      supportsReplay: false,
      catalog: {
        type: "GENRE_MODE",
        genre: "board",
        mode: overrides.mode ?? "multi",
        inputMethods: ["mouse", "touch"],
      },
      updatedAt: NOW.toISOString(),
    },
  } as unknown as RuntimeGame;
}

function harness(selectedRuntime = runtime()) {
  let nextId = 1;
  const records: MultiplayerProfileRecord[] = [];
  const registry: RuntimeGameRegistry = {
    async findBySlug(slug) {
      return slug === selectedRuntime.identity.slug ? selectedRuntime : null;
    },
    async listPublic() {
      return [selectedRuntime];
    },
  };
  const profiles: MultiplayerProfileRepository = {
    async createApprovedRevision(input) {
      const existing = records.find(
        (record) =>
          record.profile.gameId === input.profile.gameId &&
          record.profile.gameVersionId === input.profile.gameVersionId &&
          record.profile.profileRevision === input.profile.profileRevision,
      );
      if (existing) return { status: "REPLAYED", record: existing };
      const record: MultiplayerProfileRecord = {
        id: nextId++,
        sourceRequestId: input.sourceRequestId,
        profile: input.profile,
        createdByAdminId: input.createdByAdminId,
        approvedAt: input.nowIso,
        disabledAt: null,
        disabledReasonCode: null,
        disabledByAdminId: null,
        updatedAt: input.nowIso,
      };
      records.push(record);
      return { status: "CREATED", record };
    },
    async setEnabled(input) {
      const index = records.findIndex((record) => record.id === input.profileId);
      if (index === -1) return { status: "NOT_FOUND" };
      const current = records[index]!;
      if (current.profile.enabled === input.enabled) return { status: "REPLAYED", record: current };
      if (
        input.enabled &&
        records.some(
          (record) =>
            record.id !== current.id &&
            record.profile.gameVersionId === current.profile.gameVersionId &&
            record.profile.enabled,
        )
      ) {
        return { status: "CONFLICT", record: current };
      }
      const updated: MultiplayerProfileRecord = {
        ...current,
        profile: { ...current.profile, enabled: input.enabled },
        disabledAt: input.enabled ? null : input.nowIso,
        disabledReasonCode: input.enabled ? null : input.reasonCode,
        disabledByAdminId: input.enabled ? null : input.changedByAdminId,
        updatedAt: input.nowIso,
      };
      records[index] = updated;
      return { status: "UPDATED", record: updated };
    },
    async findById(profileId) {
      return records.find((record) => record.id === profileId) ?? null;
    },
    async findLatestForExactVersion(gameId, gameVersionId) {
      return (
        records
          .filter(
            (record) =>
              record.profile.gameId === gameId && record.profile.gameVersionId === gameVersionId,
          )
          .sort((left, right) => right.profile.profileRevision - left.profile.profileRevision)[0] ??
        null
      );
    },
    async findEnabledForExactVersion(gameId, gameVersionId) {
      return (
        records.find(
          (record) =>
            record.profile.gameId === gameId &&
            record.profile.gameVersionId === gameVersionId &&
            record.profile.enabled,
        ) ?? null
      );
    },
  };
  return {
    records,
    useCases: new OfficialMultiplayerProfileUseCases({
      runtimeGames: registry,
      profiles,
      now: () => NOW,
    }),
  };
}

test("trusted admin activation creates one exact-version Omok profile without rank or reward", async () => {
  const { records, useCases } = harness();
  const first = await useCases.setEnabled({
    gameSlug: "official-omok",
    enabled: true,
    changedByAdminId: 3,
    disabledReasonCode: null,
  });
  assert.equal(first.ok, true);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.profile.enabled, true);
  assert.equal(records[0]?.profile.rulesetKey, "official:omok");
  assert.equal(records[0]?.profile.gameVersionId, 12);
  assert.equal(records[0]?.profile.rewardPolicyId, null);
  assert.deepEqual(records[0]?.profile.allowedVisibility, ["PRIVATE"]);
  assert.deepEqual(records[0]?.profile.allowedJoinPolicies, ["OPEN"]);

  const replay = await useCases.setEnabled({
    gameSlug: "official-omok",
    enabled: true,
    changedByAdminId: 3,
    disabledReasonCode: null,
  });
  assert.equal(replay.ok, true);
  assert.equal(records.length, 1);
  assert.equal((await useCases.get("official-omok")).ok, true);
});

test("profile disable is audited and can be re-enabled without creating another revision", async () => {
  const { records, useCases } = harness();
  await useCases.setEnabled({
    gameSlug: "official-omok",
    enabled: true,
    changedByAdminId: 3,
    disabledReasonCode: null,
  });
  const disabled = await useCases.setEnabled({
    gameSlug: "official-omok",
    enabled: false,
    changedByAdminId: 3,
    disabledReasonCode: "STAGING_TEST_COMPLETE",
  });
  assert.equal(disabled.ok, true);
  assert.equal(records[0]?.profile.enabled, false);
  assert.equal(records[0]?.disabledReasonCode, "STAGING_TEST_COMPLETE");

  const reenabled = await useCases.setEnabled({
    gameSlug: "official-omok",
    enabled: true,
    changedByAdminId: 3,
    disabledReasonCode: null,
  });
  assert.equal(reenabled.ok, true);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.profile.enabled, true);
});

test("an enabled legacy invite profile upgrades to a new room-code revision", async () => {
  const { records, useCases } = harness();
  await useCases.setEnabled({
    gameSlug: "official-omok",
    enabled: true,
    changedByAdminId: 3,
    disabledReasonCode: null,
  });
  const current = records[0]!;
  records[0] = {
    ...current,
    profile: { ...current.profile, allowedJoinPolicies: ["INVITE_ONLY"] },
  };

  const upgraded = await useCases.setEnabled({
    gameSlug: "official-omok",
    enabled: true,
    changedByAdminId: 3,
    disabledReasonCode: null,
  });

  assert.equal(upgraded.ok, true);
  assert.equal(records.length, 2);
  assert.equal(records[0]?.profile.enabled, false);
  assert.equal(records[0]?.disabledReasonCode, "ACCESS_POLICY_UPGRADE");
  assert.equal(records[1]?.profile.profileRevision, 2);
  assert.deepEqual(records[1]?.profile.allowedJoinPolicies, ["OPEN"]);
  assert.equal(records[1]?.profile.enabled, true);
});

test("USER, single-player, and score/rank manifests cannot obtain official authority", async () => {
  for (const [candidate, code] of [
    [runtime({ publisher: "USER" }), "OFFICIAL_GAME_REQUIRED"],
    [runtime({ mode: "single" }), "MULTIPLAYER_MANIFEST_REQUIRED"],
    [
      runtime({
        leaderboard: true,
        score: { unit: "wins", direction: "desc", min: 0, max: 999 },
      }),
      "LEADERBOARD_FORBIDDEN",
    ],
    [runtime({ xpPerCompletion: 10 }), "LEADERBOARD_FORBIDDEN"],
  ] as const) {
    const result = await harness(candidate).useCases.setEnabled({
      gameSlug: "official-omok",
      enabled: true,
      changedByAdminId: 3,
      disabledReasonCode: null,
    });
    assert.deepEqual(result, { ok: false, code });
  }
});

test("the Omok preset cannot be attached to an unrelated official multiplayer slug", async () => {
  const candidate = runtime({ slug: "official-chess" });
  const result = await harness(candidate).useCases.setEnabled({
    gameSlug: "official-chess",
    enabled: true,
    changedByAdminId: 3,
    disabledReasonCode: null,
  });
  assert.deepEqual(result, { ok: false, code: "PRESET_GAME_MISMATCH" });
});
