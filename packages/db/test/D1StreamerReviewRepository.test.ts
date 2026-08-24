import test from "node:test";
import assert from "node:assert/strict";
import { D1StreamerReviewRepository } from "../src/d1/D1StreamerReviewRepository.js";

function createDb() {
  const queries: string[] = [];
  const manualRow = {
    id: 21,
    streamer_platform_account_id: 11,
    review_type: "ACQUISITION",
    status: "MANUAL_REVIEW",
    initial_audience: 11500,
    initial_channel_created_at: "2024-01-01T00:00:00.000Z",
    next_check_at: "2026-08-01T00:00:00.000Z",
    attempt_count: 0,
    last_error: null,
    review_reason: "공식 지표의 추가 확인이 필요합니다.",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    completed_at: null,
    review_user_id: 7,
    review_nickname: "StreamerUser",
    review_streamer_id: 1,
    review_streamer_status: "VERIFIED",
    review_featured_status: "NONE",
    review_account_id: 11,
    review_account_streamer_id: 1,
    review_platform: "YOUTUBE",
    review_platform_user_id: "UC123",
    review_channel_name: "Test Channel",
    review_channel_handle: "@test",
    review_channel_url: "https://youtube.com/@test",
    review_avatar_url: null,
    review_verification_status: "VERIFIED",
    review_verified_at: "2026-01-01T00:00:00.000Z",
    review_audience_count: 11500,
    review_channel_created_at: "2024-01-01T00:00:00.000Z",
    review_metrics_synced_at: "2026-08-01T00:00:00.000Z",
    review_account_created_at: "2026-01-01T00:00:00.000Z",
    review_account_updated_at: "2026-08-01T00:00:00.000Z",
  };

  const db = {
    prepare(query: string) {
      queries.push(query);
      return {
        bind() {
          return this;
        },
        async first<T>() {
          if (query.includes("FROM streamer_review_jobs rj")) return manualRow as T;
          return null;
        },
        async all<T>() {
          return { results: [] as T[] };
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        },
      };
    },
    async batch(statements: Array<{ query?: string }>) {
      return statements.map((statement, index) => ({
        success: true,
        meta: { changes: index === 0 ? 1 : 1 },
        query: statement.query,
      }));
    },
  };

  return { db, queries };
}

test("D1StreamerReviewRepository — manual approval writes an immutable audit insert and revalidation job", async () => {
  const { db, queries } = createDb();
  const repository = new D1StreamerReviewRepository(db as any);
  const result = await repository.applyManualReviewDecision({
    jobId: 21,
    reviewerUserId: 1,
    action: "APPROVE_FEATURED",
    reason: "공식 소유권과 최신 지표를 확인했습니다.",
    publicProfileReason: "운영진 심사 승인",
    nextRevalidationAt: "2026-08-15T00:00:00.000Z",
    nowIso: "2026-08-01T00:00:00.000Z",
  });

  assert.equal(result.applied, true);
  assert.ok(queries.some((query) => query.includes("INSERT INTO streamer_review_audit_log")));
  assert.ok(queries.some((query) => query.includes("'REVALIDATION'")));
});
