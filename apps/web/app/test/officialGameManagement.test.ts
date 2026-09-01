import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { AdminGameListResponse, GameAvailabilityDto } from "@owogg/contracts";
import {
  adminGameCatalogBadge,
  hideDeletedAdminGames,
  uploadOfficialGameBatch,
} from "../components/admin/OfficialGameManagement";
import { createOfficialGameUploadQueue } from "../components/admin/officialGameUploadQueue";
import { ApiClientError } from "../lib/api";

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
    tags: [],
    defaultScreenMode: "default",
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

test("platform switches publish their confirmed value to the current SPA after the server accepts it", () => {
  assert.match(managementSource, /publishPlatformFeatureSettings\(updated\)/);
  assert.match(managementSource, /이미 열린 연결은 자연 종료/);
});

test("admin batch upload publishes ZIPs serially and isolates a failed file", async () => {
  const order: string[] = [];
  let active = 0;
  let maxActive = 0;
  const progress: string[][] = [];
  const results = await uploadOfficialGameBatch(
    [{ name: "aim.zip" }, { name: "broken.zip" }, { name: "omok.zip" }],
    async (file) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(file.name);
      await Promise.resolve();
      active -= 1;
      if (file.name === "broken.zip") throw new Error("manifest invalid");
      return { slug: file.name.replace(".zip", ""), title: file.name };
    },
    (next) => progress.push(next.map((result) => result.status)),
  );

  assert.deepEqual(order, ["aim.zip", "broken.zip", "omok.zip"]);
  assert.equal(maxActive, 1);
  assert.deepEqual(
    results.map((result) => result.status),
    ["SUCCESS", "FAILED", "SUCCESS"],
  );
  assert.equal(results[1]?.message, "manifest invalid");
  assert.deepEqual(progress.at(-1), ["SUCCESS", "FAILED", "SUCCESS"]);
});

test("the shared admin dropzone enables multi-file selection without changing creator uploads", () => {
  assert.match(managementSource, /multiple/);
  assert.match(managementSource, /acceptWhileBusy/);
  assert.match(managementSource, /onFiles=\{handleOfficialUploads\}/);
  assert.match(managementSource, /slug별로 등록·업데이트/);
});

test("admin upload queue accepts another drop while the first file is still publishing", async () => {
  let releaseFirst: (() => void) | undefined;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const order: string[] = [];
  const queue = createOfficialGameUploadQueue({
    publish: async (file: { name: string }) => {
      order.push(file.name);
      if (file.name === "first.zip") await firstBlocked;
      return { slug: file.name, title: file.name };
    },
  });

  queue.enqueue([{ name: "first.zip" }]);
  await Promise.resolve();
  queue.enqueue([{ name: "second.zip" }, { name: "third.zip" }]);
  assert.deepEqual(
    queue.results().map((result) => result.fileName),
    ["first.zip", "second.zip", "third.zip"],
  );
  releaseFirst?.();
  const results = await queue.waitForIdle();

  assert.deepEqual(order, ["first.zip", "second.zip", "third.zip"]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["SUCCESS", "SUCCESS", "SUCCESS"],
  );
});

test("admin upload queue waits and retries only a rate-limited file", async () => {
  let calls = 0;
  const waits: number[] = [];
  const progress: string[] = [];
  const results = await uploadOfficialGameBatch(
    [{ name: "typing.zip" }],
    async () => {
      calls += 1;
      if (calls === 1) {
        throw new ApiClientError("HttpError", "rate limited", {
          status: 429,
          retryAfterSeconds: 7,
        });
      }
      return { slug: "typing-test", title: "타자 속도 테스트" };
    },
    (next) => progress.push(next[0]?.status ?? "missing"),
    { sleep: async (milliseconds) => void waits.push(milliseconds) },
  );

  assert.equal(calls, 2);
  assert.deepEqual(waits, [7_000]);
  assert.ok(progress.includes("RETRY_WAIT"));
  assert.equal(results[0]?.status, "SUCCESS");
});

test("admin upload queue replaces an invalid retry hint with the bounded default", async () => {
  const waits: number[] = [];
  let calls = 0;
  const results = await uploadOfficialGameBatch(
    [{ name: "reaction.zip" }],
    async () => {
      calls += 1;
      if (calls === 1) {
        throw new ApiClientError("HttpError", "rate limited", {
          status: 429,
          retryAfterSeconds: Number.NaN,
        });
      }
      return { slug: "reaction-time", title: "반응속도 테스트" };
    },
    undefined,
    { sleep: async (milliseconds) => void waits.push(milliseconds) },
  );

  assert.deepEqual(waits, [60_000]);
  assert.equal(results[0]?.status, "SUCCESS");
});
