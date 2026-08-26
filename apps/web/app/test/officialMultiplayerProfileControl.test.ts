import assert from "node:assert/strict";
import test from "node:test";
import type { GameAvailabilityDto } from "@owogg/contracts";
import { supportsOfficialOmokProfileControl } from "../components/admin/OfficialGameManagement";

function game(overrides: Partial<GameAvailabilityDto> = {}): GameAvailabilityDto {
  return {
    gameId: "official-omok",
    title: "온라인 오목",
    publisherType: "OWOGG",
    publisherName: "OWOGG",
    enabled: true,
    disabledReason: null,
    latestUploadedAt: "2026-08-26T00:00:00.000Z",
    shortDescription: null,
    description: null,
    genre: "board",
    mode: "multi",
    ...overrides,
  } as GameAvailabilityDto;
}

test("only the allowlisted official Omok multiplayer row exposes the OMOK_V1 control", () => {
  assert.equal(supportsOfficialOmokProfileControl(game()), true);
  assert.equal(supportsOfficialOmokProfileControl(game({ gameId: "official-chess" })), false);
  assert.equal(supportsOfficialOmokProfileControl(game({ publisherType: "USER" })), false);
  assert.equal(supportsOfficialOmokProfileControl(game({ mode: "single" })), false);
});
