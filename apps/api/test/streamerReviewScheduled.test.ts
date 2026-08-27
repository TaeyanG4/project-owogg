import test from "node:test";
import assert from "node:assert/strict";
import { scheduledHandler } from "../src/app.js";

function createReviewDb() {
  const accountRow = {
    id: 11,
    streamer_id: 1,
    platform: "YOUTUBE",
    platform_user_id: "UC123",
    channel_name: "Test Channel",
    channel_handle: null,
    channel_url: "https://youtube.com/@test",
    avatar_url: null,
    verification_status: "VERIFIED",
    verified_at: "2026-01-01T00:00:00.000Z",
    audience_count: 15000,
    channel_created_at: "2023-01-01T00:00:00.000Z",
    metrics_synced_at: "2026-06-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
  };

  const profileRow = {
    id: 1,
    user_id: 7,
    status: "VERIFIED",
    featured_status: "NONE",
    featured_reason: null,
    featured_since: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  const jobRow = {
    id: 21,
    streamer_platform_account_id: 11,
    status: "AUTO_REVIEW_PENDING",
    initial_audience: 15000,
    initial_channel_created_at: "2023-01-01T00:00:00.000Z",
    next_check_at: "2026-01-01T00:00:00.000Z",
    attempt_count: 0,
    last_error: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    completed_at: null,
  };

  return {
    prepare(sql: string) {
      if (
        sql.includes("streamer_review_jobs") &&
        sql.includes("next_check_at <=") &&
        sql.includes("review_type = 'ACQUISITION'")
      ) {
        return {
          bind() {
            return {
              async all() {
                return { results: [jobRow] };
              },
            };
          },
        };
      }
      if (sql.includes("streamer_platform_accounts WHERE id =")) {
        return {
          bind() {
            return {
              async first() {
                return accountRow;
              },
            };
          },
        };
      }
      if (sql.includes("streamer_profiles WHERE id =")) {
        return {
          bind() {
            return {
              async first() {
                return profileRow;
              },
            };
          },
        };
      }
      if (
        sql.includes("streamer_review_jobs") &&
        sql.includes("next_check_at <=") &&
        sql.includes("review_type = 'REVALIDATION'")
      ) {
        return {
          bind() {
            return {
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
      if (sql.includes("UPDATE streamer_platform_accounts")) {
        return {
          bind() {
            return {
              async run() {
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      }
      if (sql.includes("UPDATE streamer_review_jobs")) {
        return {
          bind() {
            return {
              async run() {
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      }
      if (sql.includes("streamer_profiles WHERE user_id =")) {
        return {
          bind() {
            return {
              async first() {
                return profileRow;
              },
              async all() {
                return { results: [] };
              },
            };
          },
        };
      }
      if (sql.includes("UPDATE streamer_profiles")) {
        return {
          bind() {
            return {
              async run() {
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      }
      if (sql.includes("streamer_platform_accounts WHERE streamer_id =")) {
        return {
          bind() {
            return {
              async all() {
                return { results: [accountRow] };
              },
            };
          },
        };
      }
      return {
        bind() {
          return {
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
    },
  };
}

test("scheduled handler — processes a due Featured review end-to-end (mock providers)", async () => {
  const env = {
    DB: createReviewDb(),
    USE_MOCK_STREAMER_PROVIDERS: "true",
  };
  const controller = {} as ScheduledController;
  let pending: Promise<void> | null = null;
  const ctx: ExecutionContext = {
    waitUntil(promise) {
      pending = promise;
      return promise;
    },
    passThroughOnException() {},
  };

  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  try {
    await scheduledHandler(controller, env as any, ctx);
    if (pending) await pending;
  } finally {
    console.log = origLog;
  }

  const summaryLog = logs.find((l) => l.includes("[streamer-review] scheduled run done"));
  assert.ok(summaryLog, "scheduled run must log a summary");
  assert.match(summaryLog, /acquisitionProcessed=1/);
  assert.match(summaryLog, /acquisitionFeatured=1/);
});

test("scheduled handler — no-op when no jobs are due", async () => {
  const preparedSql: string[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        preparedSql.push(sql);
        return {
          bind() {
            return {
              async all() {
                return { results: [] };
              },
              async run() {
                return { success: true, meta: { changes: 0 } };
              },
            };
          },
        };
      },
    },
    USE_MOCK_STREAMER_PROVIDERS: "true",
  };
  const controller = {} as ScheduledController;
  let pending: Promise<void> | null = null;
  const ctx: ExecutionContext = {
    waitUntil(promise) {
      pending = promise;
      return promise;
    },
    passThroughOnException() {},
  };

  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  try {
    await scheduledHandler(controller, env as any, ctx);
    if (pending) await pending;
  } finally {
    console.log = origLog;
  }

  const summaryLog = logs.find((l) => l.includes("[streamer-review] scheduled run done"));
  assert.ok(summaryLog);
  assert.match(summaryLog, /acquisitionProcessed=0/);
  assert.equal(
    preparedSql.some(
      (sql) => sql.includes("UPDATE multiplayer_instances") && sql.includes("lease.expires_at"),
    ),
    true,
    "the shared Cron must run bounded stale multiplayer instance cleanup",
  );
});
