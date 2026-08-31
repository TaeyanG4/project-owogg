import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_STREAMER_ADMIN_WORKSPACE_QUERY,
  StreamerAdminActionRequestSchema,
  StreamerAdminPageSizeSchema,
  StreamerAdminWorkspaceQuerySchema,
  StreamerPolicyValuesSchema,
} from "@owogg/contracts";
import {
  canPerformStreamerAdminAction,
  canViewStreamerAdminSection,
} from "../features/streamers/adminStreamerViewModel";

const policyValues = {
  minimumAudience: 1_000,
  minimumChannelAgeDays: 30,
  ownershipValidityDays: 365,
  reverificationNoticeDays: 30,
  verificationIntentTtlMinutes: 10,
  claimLeaseMinutes: 30,
  reviewSlaHours: 24,
  holdDefaultHours: 24,
  reconsiderationCooldownDays: 7,
  providerTimeoutSeconds: 10,
} as const;

test("all admin lists accept only the supported 10/20/30/50 page sizes", () => {
  for (const pageSize of [10, 20, 30, 50]) {
    assert.equal(StreamerAdminPageSizeSchema.parse(pageSize), pageSize);
    const query = StreamerAdminWorkspaceQuerySchema.parse({
      overviewPageSize: pageSize,
      rosterPageSize: pageSize,
      reviewPageSize: pageSize,
      policyPageSize: pageSize,
      auditPageSize: pageSize,
    });
    assert.equal(query.overviewPageSize, pageSize);
    assert.equal(query.rosterPageSize, pageSize);
    assert.equal(query.reviewPageSize, pageSize);
    assert.equal(query.policyPageSize, pageSize);
    assert.equal(query.auditPageSize, pageSize);
  }
  assert.equal(StreamerAdminPageSizeSchema.safeParse(25).success, false);
});

test("workspace query defaults are server pagination inputs", () => {
  assert.deepEqual(
    StreamerAdminWorkspaceQuerySchema.parse({}),
    DEFAULT_STREAMER_ADMIN_WORKSPACE_QUERY,
  );
  assert.equal(DEFAULT_STREAMER_ADMIN_WORKSPACE_QUERY.overviewPage, 1);
  assert.equal(DEFAULT_STREAMER_ADMIN_WORKSPACE_QUERY.rosterPageSize, 20);
  assert.equal(DEFAULT_STREAMER_ADMIN_WORKSPACE_QUERY.reviewPageSize, 20);
});

test("manual policy values are typed and enforce ownership notice ordering", () => {
  assert.equal(StreamerPolicyValuesSchema.safeParse(policyValues).success, true);
  assert.equal(
    StreamerPolicyValuesSchema.safeParse({
      ...policyValues,
      reverificationNoticeDays: policyValues.ownershipValidityDays,
    }).success,
    false,
  );
});

test("saving policy requires the complete typed values and no scheduling fields", () => {
  const base = {
    action: "SAVE_POLICY" as const,
    targetId: "7",
    expectedVersion: 7,
    reason: "수동 심사 기준 변경",
    internalNote: null,
    effectiveAt: null,
  };
  assert.equal(StreamerAdminActionRequestSchema.safeParse({ ...base, policyValues }).success, true);
  assert.equal(
    StreamerAdminActionRequestSchema.safeParse({ ...base, policyValues: null }).success,
    false,
  );
});

test("review, management, policy, and provider actions keep separate permissions", () => {
  assert.equal(canPerformStreamerAdminAction(["streamers.review"], "APPROVE_STREAMER"), true);
  assert.equal(canPerformStreamerAdminAction(["streamers.review"], "SUSPEND_STREAMER"), false);
  assert.equal(canPerformStreamerAdminAction(["streamers.manage"], "SUSPEND_STREAMER"), true);
  assert.equal(canPerformStreamerAdminAction(["streamers.policy.manage"], "SAVE_POLICY"), true);
  assert.equal(
    canPerformStreamerAdminAction(["streamers.operations.manage"], "PAUSE_PROVIDER_CONNECTIONS"),
    true,
  );
  assert.equal(canViewStreamerAdminSection(["streamers.view"], "REVIEWS"), true);
  assert.equal(canViewStreamerAdminSection([], "OVERVIEW"), false);
});
