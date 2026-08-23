import test from "node:test";
import assert from "node:assert/strict";
import { createGameResultFlow } from "../features/game/gameResultFlow";

test("result flow keeps the signed token in the host and submits accumulated event counts once", async () => {
  const submissions: unknown[] = [];
  const states: string[] = [];
  const flow = createGameResultFlow(
    {
      slug: "creator-game",
      fetchGameSession: async () => ({ token: "secret", expiresAt: "later" }),
      acceptResult: async (_slug, input) => {
        submissions.push(input);
        return { success: true };
      },
    },
    { onStatusChange: (state) => states.push(state) },
  );

  await flow.startAttempt(true, "hard");
  flow.recordEvent("boss_defeated");
  flow.recordEvent("boss_defeated");
  await flow.handleComplete(true, { outcome: "success", score: 10 });
  await flow.handleComplete(true, { score: 20 });

  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0], {
    token: "secret",
    outcome: "success",
    score: 10,
    events: { boss_defeated: 2 },
    difficulty: "hard",
  });
  assert.deepEqual(states, ["idle", "submitting", "success"]);
});

test("guest completion never fetches or submits a token", async () => {
  let calls = 0;
  const states: string[] = [];
  const flow = createGameResultFlow(
    {
      slug: "creator-game",
      fetchGameSession: async () => {
        calls += 1;
        return { token: "secret", expiresAt: "later" };
      },
      acceptResult: async () => {
        calls += 1;
        return { success: true };
      },
    },
    { onStatusChange: (state) => states.push(state) },
  );
  await flow.startAttempt(false);
  await flow.handleComplete(false, {});
  assert.equal(calls, 0);
  assert.deepEqual(states, ["idle", "guest"]);
});
