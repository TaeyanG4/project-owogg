import test from "node:test";
import assert from "node:assert/strict";
import {
  validateNickname,
  validateCountry,
  checkCooldown,
  NICKNAME_MIN_LENGTH,
  NICKNAME_MAX_LENGTH,
  NICKNAME_COOLDOWN_DAYS,
  COUNTRY_COOLDOWN_DAYS,
  formatPublicUserTag,
} from "../src/domain/profilePolicy.js";

test("validateNickname trims surrounding whitespace", () => {
  const result = validateNickname("  Taeyang  ");
  assert.equal(result.valid, true);
  if (result.valid) assert.equal(result.nickname, "Taeyang");
});

test("validateNickname rejects empty/whitespace-only input", () => {
  assert.equal(validateNickname("").valid, false);
  assert.equal(validateNickname("   ").valid, false);
});

test("validateNickname rejects control characters", () => {
  const withControlChar = "Taeyang" + String.fromCharCode(7) + "Gamer"; // BEL, U+0007
  const result = validateNickname(withControlChar);
  assert.equal(result.valid, false);
});

test("validateNickname enforces min/max length by Unicode codepoint, not UTF-16 units", () => {
  assert.equal(validateNickname("a").valid, false); // below min
  assert.equal(validateNickname("a".repeat(NICKNAME_MAX_LENGTH + 1)).valid, false); // above max
  assert.equal(validateNickname("a".repeat(NICKNAME_MIN_LENGTH)).valid, true);
  assert.equal(validateNickname("a".repeat(NICKNAME_MAX_LENGTH)).valid, true);

  // Korean nickname within bounds must be accepted.
  assert.equal(validateNickname("태양게이머").valid, true);
});

test("validateCountry accepts an ISO 3166-1 alpha-2 code, case-insensitively", () => {
  const result = validateCountry("kr");
  assert.equal(result.valid, true);
  if (result.valid) assert.equal(result.country, "KR");
});

test("validateCountry treats null/empty/UNSET as unset", () => {
  for (const input of [null, undefined, "", "unset", "UNSET"]) {
    const result = validateCountry(input as string | null | undefined);
    assert.equal(result.valid, true);
    if (result.valid) assert.equal(result.country, null);
  }
});

test("validateCountry rejects malformed codes", () => {
  assert.equal(validateCountry("korea").valid, false);
  assert.equal(validateCountry("1").valid, false);
  assert.equal(validateCountry("K").valid, false);
});

test("checkCooldown allows the first-ever change (null lastChangedAt)", () => {
  const result = checkCooldown(null, NICKNAME_COOLDOWN_DAYS);
  assert.equal(result.allowed, true);
});

test("checkCooldown blocks a change within the cooldown window", () => {
  const now = new Date("2026-01-10T00:00:00.000Z");
  const lastChangedAt = "2026-01-08T00:00:00.000Z"; // 2 days ago
  const result = checkCooldown(lastChangedAt, NICKNAME_COOLDOWN_DAYS, now);
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.equal(result.nextAllowedAt, "2026-02-07T00:00:00.000Z");
  }
});

test("checkCooldown allows a change exactly at the cooldown boundary", () => {
  const lastChangedAt = "2026-01-01T00:00:00.000Z";
  const exactlyAtBoundary = new Date("2026-01-31T00:00:00.000Z"); // +30 days
  const result = checkCooldown(lastChangedAt, NICKNAME_COOLDOWN_DAYS, exactlyAtBoundary);
  assert.equal(result.allowed, true);
});

test("country cooldown uses its own, longer window", () => {
  assert.equal(COUNTRY_COOLDOWN_DAYS, 30);
  const now = new Date("2026-01-20T00:00:00.000Z");
  const lastChangedAt = "2026-01-01T00:00:00.000Z"; // 19 days ago, below 30
  const result = checkCooldown(lastChangedAt, COUNTRY_COOLDOWN_DAYS, now);
  assert.equal(result.allowed, false);
});

test("nickname cooldown is 30 days", () => {
  assert.equal(NICKNAME_COOLDOWN_DAYS, 30);
});

test("formatPublicUserTag combines a duplicate-safe nickname and stable user number", () => {
  assert.equal(formatPublicUserTag("Taeyang", 123), "Taeyang #123");
});
