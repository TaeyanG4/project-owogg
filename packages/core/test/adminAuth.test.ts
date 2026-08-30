import test from "node:test";
import assert from "node:assert/strict";
import {
  isAdminGoogleSub,
  evaluateLoginRateLimit,
  ADMIN_AUTH_POLICY,
  resolveAdminSessionTtlMs,
} from "../src/domain/adminAuth.js";

test("resolveAdminSessionTtlMs keeps the 30-minute default when unset", () => {
  assert.equal(resolveAdminSessionTtlMs(undefined), ADMIN_AUTH_POLICY.ADMIN_SESSION_TTL_MS);
});

test("resolveAdminSessionTtlMs accepts the Staging 12-hour policy at the maximum boundary", () => {
  assert.equal(resolveAdminSessionTtlMs("43200"), 12 * 60 * 60 * 1000);
});

test("resolveAdminSessionTtlMs fails closed for malformed, zero, or over-limit values", () => {
  for (const value of ["", "0", "12h", "43201", "9007199254740991"]) {
    assert.equal(resolveAdminSessionTtlMs(value), ADMIN_AUTH_POLICY.ADMIN_SESSION_TTL_MS);
  }
});

test("isAdminGoogleSub matches only an explicitly allowlisted canonical sub", () => {
  assert.equal(isAdminGoogleSub("sub-a", "sub-a,sub-b"), true);
  assert.equal(isAdminGoogleSub("sub-c", "sub-a,sub-b"), false);
  assert.equal(isAdminGoogleSub("sub-a", undefined), false);
  assert.equal(isAdminGoogleSub("sub-a", ""), false);
  assert.equal(isAdminGoogleSub("", "sub-a"), false);
});

test("evaluateLoginRateLimit: below threshold is never locked", () => {
  const now = Date.parse("2026-08-13T00:10:00.000Z");
  const attempts = [now - 60_000, now - 30_000];
  assert.deepEqual(evaluateLoginRateLimit(attempts, now), { locked: false, retryAfterSeconds: 0 });
});

test("evaluateLoginRateLimit: exactly at threshold locks until the oldest attempt ages out", () => {
  const now = Date.parse("2026-08-13T00:10:00.000Z");
  const attempts = [
    now - 14 * 60 * 1000, // 14 min ago — still inside the 15 min window
    now - 10 * 60 * 1000,
    now - 8 * 60 * 1000,
    now - 5 * 60 * 1000,
    now - 1 * 60 * 1000,
  ];
  assert.equal(attempts.length, ADMIN_AUTH_POLICY.LOGIN_RATE_LIMIT_MAX_ATTEMPTS);
  const decision = evaluateLoginRateLimit(attempts, now);
  assert.equal(decision.locked, true);
  // oldest (14 min ago) unlocks at 15 min mark -> 1 minute (60s) remaining
  assert.equal(decision.retryAfterSeconds, 60);
});

test("evaluateLoginRateLimit: unlocks once the oldest counted failure exits the window", () => {
  const now = Date.parse("2026-08-13T00:10:00.000Z");
  const attempts = [
    now - 20 * 60 * 1000, // outside the 15 min window already
    now - 10 * 60 * 1000,
    now - 8 * 60 * 1000,
    now - 5 * 60 * 1000,
    now - 1 * 60 * 1000,
  ];
  // Only 4 of these 5 are inside the window in a real caller (the DB query filters by
  // `created_at >= sinceIso`), but evaluateLoginRateLimit itself only reasons about what it's
  // given — verify the boundary math independently with a window-filtered list:
  const inWindow = attempts.filter(
    (ts) => ts >= now - ADMIN_AUTH_POLICY.LOGIN_RATE_LIMIT_WINDOW_MS,
  );
  assert.equal(inWindow.length, 4);
  assert.equal(evaluateLoginRateLimit(inWindow, now).locked, false);
});
