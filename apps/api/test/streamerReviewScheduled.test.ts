import test from "node:test";
import assert from "node:assert/strict";
import { scheduledHandler } from "../src/app.js";

function createCaptureDb(preparedSql: string[]) {
  return {
    prepare(sql: string) {
      preparedSql.push(sql);
      return {
        bind() {
          return this;
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { success: true, meta: { changes: 0 } };
        },
      };
    },
  };
}

test("scheduled handler leaves Streamer reviews to the manual admin workflow", async () => {
  const preparedSql: string[] = [];
  const controller = {} as ScheduledController;
  let pending: Promise<unknown> | null = null;
  const ctx: ExecutionContext = {
    waitUntil(promise) {
      pending = promise;
    },
    passThroughOnException() {},
  };

  await scheduledHandler(controller, { DB: createCaptureDb(preparedSql) } as any, ctx);
  if (pending) await pending;

  assert.equal(
    preparedSql.some((sql) => sql.includes("streamer_")),
    false,
    "the scheduled handler must not read or mutate Streamer review state",
  );
  assert.equal(
    preparedSql.some(
      (sql) => sql.includes("UPDATE multiplayer_instances") && sql.includes("lease.expires_at"),
    ),
    true,
    "the shared Cron must still run bounded stale multiplayer instance cleanup",
  );
  assert.equal(
    preparedSql.some((sql) => sql.includes("admin_step_up_challenges")),
    true,
    "the shared Cron must still clean expired admin authentication state",
  );
});
