import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { AdminGameListResponse, GameAvailabilityDto } from "@owogg/contracts";
import {
  adminGameCatalogBadge,
  hideDeletedAdminGames,
} from "../components/admin/OfficialGameManagement";

const managementSource = readFileSync(
  fileURLToPath(new URL("../components/admin/OfficialGameManagement.tsx", import.meta.url)),
  "utf8",
);
const relayControlSource = readFileSync(
  fileURLToPath(new URL("../components/admin/ManagedRelayProfileControl.tsx", import.meta.url)),
  "utf8",
);

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
    catalogRole: "GAME",
    catalogState: "READY",
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

test("admin catalog badges do not call an incomplete identity public", () => {
  assert.equal(adminGameCatalogBadge(game("ready")).label, "공개 중");
  assert.equal(
    adminGameCatalogBadge({ ...game("tool"), catalogRole: "INTERNAL_TOOL" }).label,
    "테스트 가능",
  );
  assert.deepEqual(adminGameCatalogBadge({ ...game("orphan"), catalogState: "NO_LIVE_VERSION" }), {
    label: "라이브 버전 없음",
    className: "bg-surface-overlay text-text-secondary",
    hint: "삭제되지 않은 identity만 남아 있습니다. 새 규격 ZIP을 재등록하거나 삭제할 수 있습니다.",
  });
  assert.equal(
    adminGameCatalogBadge({ ...game("blocked"), enabled: false, disabledReason: "maintenance" })
      .label,
    "안전 차단",
  );
});

test("Relay operations stay per-game while the removed global review panel stays absent", () => {
  assert.doesNotMatch(managementSource, /일반 Multiplayer Relay 심사/);
  assert.doesNotMatch(managementSource, /ManagedMultiplayerRelayControl/);
  assert.match(managementSource, /내부 테스트 도구/);
  assert.match(managementSource, /ManagedRelayProfileControl/);
  assert.doesNotMatch(relayControlSource, /일반 Multiplayer Relay 심사/);
  assert.match(relayControlSource, /온라인 Relay 운영/);
  assert.match(relayControlSource, /Relay 요청 승인/);
  assert.match(relayControlSource, /Relay 활성화/);
  assert.match(relayControlSource, /테스터 열기/);
  assert.match(relayControlSource, /allowDocumentScrolling/);
});
