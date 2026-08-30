import test from "node:test";
import assert from "node:assert/strict";
import { GameSettingsUseCases } from "../src/application/gameSettingsUseCases.js";
import type { GameSettingsRepository, GameSettingRecord } from "../src/ports/repositories.js";
import type { GameIdentityRepository } from "../src/modules/game/ports/gameIdentityRepository.js";
import type { GameCanonicalRepository } from "../src/modules/game/ports/gameCanonicalRepository.js";
import type { AdminGameCatalogRepository } from "../src/ports/adminGameCatalog.js";
import { canonicalFixture, TEST_GAME_SLUGS } from "./runtimeGameFixture.js";

const TEST_GAMES = TEST_GAME_SLUGS.map((slug) => canonicalFixture(slug, `${slug} title`));

class FakeGameSettingsRepository implements GameSettingsRepository {
  private overrides = new Map<string, GameSettingRecord>();

  async getDisabledGameIds(): Promise<string[]> {
    return [...this.overrides.values()].filter((o) => !o.enabled).map((o) => o.gameId);
  }

  async getPublicCatalogExcludedGameIds(): Promise<string[]> {
    return [...this.overrides.values()]
      .filter((override) => !override.enabled || override.catalogRole === "INTERNAL_TOOL")
      .map((override) => override.gameId);
  }

  async getAllOverrides(): Promise<GameSettingRecord[]> {
    return [...this.overrides.values()];
  }

  async setEnabled(
    gameId: string,
    enabled: boolean,
    disabledReason: string | null,
    updatedByAdminId: number,
  ): Promise<GameSettingRecord> {
    const record: GameSettingRecord = {
      gameId,
      enabled,
      catalogRole: this.overrides.get(gameId)?.catalogRole ?? "GAME",
      disabledReason,
      updatedByAdminId,
      updatedAt: new Date().toISOString(),
    };
    this.overrides.set(gameId, record);
    return record;
  }

  async setCatalogRole(
    gameId: string,
    catalogRole: "GAME" | "INTERNAL_TOOL",
    updatedByAdminId: number,
  ): Promise<GameSettingRecord> {
    const previous = this.overrides.get(gameId);
    const record: GameSettingRecord = {
      gameId,
      enabled: previous?.enabled ?? true,
      catalogRole,
      disabledReason: previous?.disabledReason ?? null,
      updatedByAdminId,
      updatedAt: new Date().toISOString(),
    };
    this.overrides.set(gameId, record);
    return record;
  }
}

/** The real production registry, same reasoning as scoreUseCases.test.ts's `newUseCases` — this
 * is what makes the tests below an equivalence check against the four official games' actual
 * enable/disable behaviour, not just a shape check against synthetic data. */
function genericSources(games = TEST_GAMES): {
  identities: GameIdentityRepository;
  canonicals: GameCanonicalRepository;
} {
  const identities = {
    async findById(id: number) {
      return games[id - 1]
        ? {
            id,
            slug: games[id - 1]!.slug,
            publisher: { type: "OWOGG" as const },
            visibility: "PUBLIC" as const,
            liveVersionId: id,
            deletedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }
        : null;
    },
    async findBySlug(slug: string) {
      const game = games.find((item) => item.slug === slug);
      return game
        ? {
            id: games.indexOf(game) + 1,
            slug,
            publisher: { type: "OWOGG" as const },
            visibility: "PUBLIC" as const,
            liveVersionId: games.indexOf(game) + 1,
            deletedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }
        : null;
    },
    async listAll() {
      return Promise.all(
        games.map(async (game, index) => ({
          id: index + 1,
          slug: game.slug,
          publisher: { type: "OWOGG" as const },
          visibility: "PUBLIC" as const,
          liveVersionId: index + 1,
          deletedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        })),
      );
    },
  } satisfies GameIdentityRepository;
  const canonicals = {
    async findBySlug(slug: string) {
      return games.find((item) => item.slug === slug) ?? null;
    },
    async save() {
      return undefined;
    },
  } satisfies GameCanonicalRepository;
  return { identities, canonicals };
}

function newUseCases(games = TEST_GAMES): {
  useCases: GameSettingsUseCases;
  repo: FakeGameSettingsRepository;
} {
  const repo = new FakeGameSettingsRepository();
  const sources = genericSources(games);
  return {
    useCases: new GameSettingsUseCases(repo, sources.identities, sources.canonicals),
    repo,
  };
}

test("listAll returns every registry game as enabled when nothing has ever been overridden", async () => {
  const { useCases } = newUseCases();
  const all = await useCases.listAll();

  assert.equal(all.length, TEST_GAMES.length);
  for (const game of all) {
    assert.equal(game.enabled, true, game.gameId);
    assert.equal(game.disabledReason, null, game.gameId);
  }
});

test("listAll reports title/status from the registry, and gameId from its slug", async () => {
  const { useCases } = newUseCases();
  const all = await useCases.listAll();

  const reactionTime = all.find((g) => g.gameId === "reaction-time");
  const game = TEST_GAMES.find((item) => item.slug === "reaction-time");
  assert.ok(reactionTime && game);
  assert.equal(reactionTime.title, game.title);
  assert.equal(reactionTime.status, "published");
});

test("setEnabled(false) disables a known game and getDisabledGameIds reflects it", async () => {
  const { useCases } = newUseCases();

  const result = await useCases.setEnabled("aim-test", false, "점검 중", 9);
  assert.equal(result.ok, true);

  const disabled = await useCases.getDisabledGameIds();
  assert.deepEqual(disabled, ["aim-test"]);

  const all = await useCases.listAll();
  const aimTest = all.find((g) => g.gameId === "aim-test");
  assert.equal(aimTest?.enabled, false);
  assert.equal(aimTest?.disabledReason, "점검 중");
  assert.equal(aimTest?.updatedByAdminId, 9);
});

test("setEnabled refuses a game id the registry doesn't know, without writing an override", async () => {
  const { useCases, repo } = newUseCases();

  const result = await useCases.setEnabled("some-sandbox-game-slug", false, null, 9);
  assert.deepEqual(result, { ok: false, code: "GAME_NOT_FOUND" });
  assert.deepEqual(await repo.getAllOverrides(), []);
});

test("re-enabling a previously disabled game clears it from getDisabledGameIds", async () => {
  const { useCases } = newUseCases();

  await useCases.setEnabled("typing-test", false, "테스트", 1);
  assert.deepEqual(await useCases.getDisabledGameIds(), ["typing-test"]);

  await useCases.setEnabled("typing-test", true, null, 1);
  assert.deepEqual(await useCases.getDisabledGameIds(), []);
});

test("disabling one game never touches another's enabled state", async () => {
  const { useCases } = newUseCases();
  await useCases.setEnabled("memory-test", false, null, 1);

  const all = await useCases.listAll();
  for (const game of all) {
    if (game.gameId === "memory-test") continue;
    assert.equal(game.enabled, true, game.gameId);
  }
});

// ── the registry-scoping property this refactor establishes ─────────────────

test("GameSettingsUseCases only ever reaches games the injected registry actually resolves", async () => {
  const definitions = TEST_GAMES.slice(0, 1); // pretend only one identity is registered
  const repo = new FakeGameSettingsRepository();
  const sources = genericSources(definitions);
  const useCases = new GameSettingsUseCases(repo, sources.identities, sources.canonicals);

  const all = await useCases.listAll();
  assert.equal(all.length, 1);
  assert.equal(all[0]?.gameId, definitions[0]?.slug);

  // A real official-game slug this particular registry was never given is NOT_FOUND, exactly
  // like an unknown one — GameSettingsUseCases must not fall back to any other source.
  const otherSlug = TEST_GAMES[1]?.slug;
  assert.ok(otherSlug);
  const result = await useCases.setEnabled(otherSlug, false, null, 1);
  assert.deepEqual(result, { ok: false, code: "GAME_NOT_FOUND" });
});

test("a broken canonical source cannot block the D1-only kill switch", async () => {
  const repo = new FakeGameSettingsRepository();
  const sources = genericSources(TEST_GAMES.slice(0, 1));
  const brokenCanonicals: GameCanonicalRepository = {
    async findBySlug() {
      throw new Error("B2 unavailable");
    },
    async save() {
      throw new Error("not used");
    },
  };
  const useCases = new GameSettingsUseCases(repo, sources.identities, brokenCanonicals);
  const knownSlug = TEST_GAMES[0]?.slug;
  assert.ok(knownSlug);

  const listed = await useCases.listAll();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.title, knownSlug);

  const result = await useCases.setEnabled(knownSlug, false, "maintenance", 9);
  assert.equal(result.ok, true);
  assert.deepEqual(await useCases.getDisabledGameIds(), [knownSlug]);
});

test("listPage preserves server upload timestamps, role filter, and pagination metadata", async () => {
  const repo = new FakeGameSettingsRepository();
  const sources = genericSources(TEST_GAMES.slice(0, 2));
  const identities = await sources.identities.listAll();
  const calls: Array<{
    publisherType: "OWOGG" | "USER";
    catalogRole: "GAME" | "INTERNAL_TOOL";
    limit: number;
    offset: number;
  }> = [];
  const adminCatalog: AdminGameCatalogRepository = {
    async listPage(input) {
      calls.push(input);
      return {
        items: [
          {
            identity: identities[1]!,
            latestUploadedAt: "2026-08-25T09:30:00.000Z",
            setting: null,
          },
        ],
        total: 21,
      };
    },
  };
  const useCases = new GameSettingsUseCases(
    repo,
    sources.identities,
    sources.canonicals,
    adminCatalog,
  );

  const result = await useCases.listPage({
    publisherType: "OWOGG",
    catalogRole: "GAME",
    page: 2,
    pageSize: 10,
  });

  assert.deepEqual(calls, [{ publisherType: "OWOGG", catalogRole: "GAME", limit: 10, offset: 10 }]);
  assert.equal(result.games[0]?.latestUploadedAt, "2026-08-25T09:30:00.000Z");
  assert.equal(result.games[0]?.title, TEST_GAMES[1]?.title);
  assert.deepEqual(
    {
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    },
    { total: 21, page: 2, pageSize: 10, totalPages: 3 },
  );
});

test("setCatalogRole moves a known identity without changing its safety switch", async () => {
  const { useCases } = newUseCases();
  await useCases.setEnabled("aim-test", false, "maintenance", 3);

  const result = await useCases.setCatalogRole("aim-test", "INTERNAL_TOOL", 9);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.record.catalogRole, "INTERNAL_TOOL");
  assert.equal(result.record.enabled, false);
  assert.equal(result.record.disabledReason, "maintenance");
});
