import assert from "node:assert/strict";
import test from "node:test";
import type { AdminGameListResponse, GameAvailabilityDto } from "@owogg/contracts";
import { hideDeletedAdminGames } from "../components/admin/OfficialGameManagement";

function game(gameId: string): GameAvailabilityDto {
  return {
    gameId,
    title: gameId,
    shortDescription: null,
    description: null,
    genre: null,
    mode: "single",
    latestUploadedAt: "2026-08-27T00:00:00.000Z",
    publisherType: "OWOGG",
    status: "PUBLISHED",
    enabled: true,
    disabledReason: null,
    updatedByAdminId: null,
    updatedAt: null,
  };
}

test("a confirmed official game deletion removes the row and updates pagination immediately", () => {
  const page: AdminGameListResponse = {
    games: [game("keep"), game("deleted")],
    total: 2,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  };

  assert.deepEqual(hideDeletedAdminGames(page, new Set(["deleted"])), {
    ...page,
    games: [game("keep")],
    total: 1,
  });
});

test("deleting the last row on the last page clamps the visible page without a reload", () => {
  const page: AdminGameListResponse = {
    games: [game("deleted")],
    total: 11,
    page: 2,
    pageSize: 10,
    totalPages: 2,
  };

  assert.deepEqual(hideDeletedAdminGames(page, new Set(["deleted"])), {
    ...page,
    games: [],
    total: 10,
    page: 1,
    totalPages: 1,
  });
});

test("an already-fresh server page is not decremented again", () => {
  const fresh: AdminGameListResponse = {
    games: [game("keep")],
    total: 1,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  };

  assert.equal(hideDeletedAdminGames(fresh, new Set(["deleted"])), fresh);
});
