import { Hono, type Context } from "hono";
import {
  StreamerAdminActionRequestSchema,
  StreamerAdminActionResponseSchema,
  StreamerAdminWorkspaceDataSchema,
  StreamerAdminWorkspaceQuerySchema,
  type PermissionValue,
  type StreamerAdminAction,
  type StreamerProviderOperation,
} from "@owogg/contracts";
import { effectivePermissions, type Permission, type StreamerPlatformType } from "@owogg/core";
import { createContainer } from "../container.js";
import { isTrustedAdminOrigin } from "../auth/admin.js";
import {
  isElevatedAdminResponse,
  requireElevatedAdmin,
  requirePermission,
  type ElevatedAdmin,
} from "../auth/adminSession.js";
import { getStreamerProviderAdapters } from "../infrastructure/streamers/index.js";
import type { ApiEnv } from "./auth.js";

export const adminStreamersRouter = new Hono<ApiEnv>();

adminStreamersRouter.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method.toUpperCase())) {
    if (!isTrustedAdminOrigin(c.req.header("Origin"), c.env.FRONTEND_URL)) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "요청 출처를 확인할 수 없습니다." } },
        403,
      );
    }
  }
  await next();
});

const ACTION_PERMISSION: Record<StreamerAdminAction, Permission> = {
  CREATE_REVIEW: "streamers.review",
  CANCEL_REVIEW: "streamers.review",
  CLAIM_REVIEW: "streamers.review",
  RELEASE_REVIEW: "streamers.review",
  HOLD_REVIEW: "streamers.review",
  APPROVE_STREAMER: "streamers.review",
  REJECT_STREAMER: "streamers.review",
  REQUEST_REAUTH: "streamers.review",
  REFRESH_METRICS: "streamers.review",
  CREATE_RECONSIDERATION: "streamers.review",
  REVOKE_STREAMER_APPROVAL: "streamers.manage",
  INVALIDATE_OWNERSHIP: "streamers.manage",
  SUSPEND_STREAMER: "streamers.manage",
  RESTORE_STREAMER: "streamers.manage",
  SAVE_POLICY: "streamers.policy.manage",
  PAUSE_PROVIDER_CONNECTIONS: "streamers.operations.manage",
  RESUME_PROVIDER_CONNECTIONS: "streamers.operations.manage",
};

function queryInput(query: (name: string) => string | undefined) {
  return {
    overviewPage: query("overviewPage"),
    overviewPageSize: query("overviewPageSize") ? Number(query("overviewPageSize")) : undefined,
    rosterPage: query("rosterPage"),
    rosterPageSize: query("rosterPageSize") ? Number(query("rosterPageSize")) : undefined,
    rosterQuery: query("rosterQuery"),
    rosterPlatform: query("rosterPlatform"),
    rosterApproval: query("rosterApproval"),
    reviewPage: query("reviewPage"),
    reviewPageSize: query("reviewPageSize") ? Number(query("reviewPageSize")) : undefined,
    reviewQuery: query("reviewQuery"),
    reviewAssignment: query("reviewAssignment"),
    reviewState: query("reviewState"),
    policyPage: query("policyPage"),
    policyPageSize: query("policyPageSize") ? Number(query("policyPageSize")) : undefined,
    auditPage: query("auditPage"),
    auditPageSize: query("auditPageSize") ? Number(query("auditPageSize")) : undefined,
    auditQuery: query("auditQuery"),
    auditTarget: query("auditTarget"),
  };
}

function credentialState(
  env: ApiEnv["Bindings"],
  platform: StreamerPlatformType,
): StreamerProviderOperation["credentialState"] {
  const values =
    platform === "YOUTUBE"
      ? [env.YOUTUBE_CLIENT_ID, env.YOUTUBE_CLIENT_SECRET]
      : platform === "TWITCH"
        ? [env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET]
        : platform === "CHZZK"
          ? [env.CHZZK_CLIENT_ID, env.CHZZK_CLIENT_SECRET]
          : [env.SOOP_CLIENT_ID, env.SOOP_CLIENT_SECRET];
  const count = values.filter(Boolean).length;
  return count === values.length ? "COMPLETE" : count === 0 ? "MISSING" : "PARTIAL";
}

function providerOperations(
  env: ApiEnv["Bindings"],
  settings: Array<{
    platform: StreamerPlatformType;
    newConnectionsPaused: boolean;
    pendingReviews: number;
    lastSuccessfulConnectionAt: string | null;
    rowVersion: number;
  }>,
): StreamerProviderOperation[] {
  const adapters = getStreamerProviderAdapters(env);
  return settings.map((setting) => {
    const credentials = credentialState(env, setting.platform);
    const adapter = adapters[setting.platform];
    const configured = adapter.isConfigured();
    const oauthAvailable = adapter.verificationMethod === "OAUTH_REDIRECT";
    const reasonCode = !oauthAvailable
      ? "CONTRACT_UNVERIFIED"
      : setting.newConnectionsPaused
        ? "PAUSED"
        : configured
          ? "READY"
          : credentials === "PARTIAL"
            ? "PARTIAL_CONFIG"
            : "MISSING_CONFIG";
    return {
      platform: setting.platform,
      displayName: {
        YOUTUBE: "YouTube",
        TWITCH: "Twitch",
        CHZZK: "CHZZK",
        SOOP: "SOOP",
      }[setting.platform],
      ownership:
        oauthAvailable && configured && !setting.newConnectionsPaused ? "READY" : "UNAVAILABLE",
      metricRefresh: adapter.supportsMetricRefresh() ? "READY" : "UNAVAILABLE",
      reasonCode,
      credentialState: credentials,
      newConnectionsPaused: setting.newConnectionsPaused,
      pendingReviews: setting.pendingReviews,
      lastSuccessfulConnectionAt: setting.lastSuccessfulConnectionAt,
      rowVersion: setting.rowVersion,
    };
  });
}

function permissionsFor(admin: ElevatedAdmin): PermissionValue[] {
  return effectivePermissions(
    admin.role,
    admin.rolePermissions,
    admin.individualPermissions,
  ) as PermissionValue[];
}

adminStreamersRouter.get("/workspace", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "streamers.view");
  if (denied) return denied;

  const query = StreamerAdminWorkspaceQuerySchema.safeParse(
    queryInput((name) => c.req.query(name)),
  );
  if (!query.success) {
    return c.json(
      { error: { code: "INVALID_QUERY", message: "스트리머 관리 검색 조건이 올바르지 않습니다." } },
      400,
    );
  }

  const { streamerAdminRepo } = createContainer(c.env.DB);
  const snapshot = await streamerAdminRepo.getWorkspace(query.data, admin.userId);
  const response = StreamerAdminWorkspaceDataSchema.parse({
    generatedAt: snapshot.generatedAt,
    permissions: permissionsFor(admin),
    sectionSources: {
      OVERVIEW: "LIVE",
      STREAMERS: "LIVE",
      REVIEWS: "LIVE",
      POLICY: "LIVE",
      PROVIDERS: "LIVE",
      AUDIT: "LIVE",
    },
    overview: snapshot.overview,
    overviewQueue: snapshot.overviewQueue,
    roster: snapshot.roster,
    reviews: snapshot.reviews,
    policy: snapshot.policy,
    providers: providerOperations(c.env, snapshot.providerSettings),
    audits: snapshot.audits,
  });
  return c.json(response);
});

async function readActionBody(c: Context<ApiEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

adminStreamersRouter.post("/actions", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;

  const body = await readActionBody(c);
  const parsed = StreamerAdminActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: { code: "INVALID_REQUEST", message: "작업 대상과 3자 이상의 사유를 확인해주세요." },
      },
      400,
    );
  }
  const denied = requirePermission(admin, ACTION_PERMISSION[parsed.data.action]);
  if (denied) return denied;

  const container = createContainer(c.env.DB);
  const correlationId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  let result;

  if (parsed.data.action === "REFRESH_METRICS") {
    const accountId = Number(parsed.data.targetId);
    const account = Number.isSafeInteger(accountId)
      ? await container.streamerRepo.findPlatformAccountById(accountId)
      : null;
    if (!account) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "플랫폼 계정을 찾을 수 없습니다." } },
        404,
      );
    }
    if (parsed.data.expectedVersion !== account.rowVersion) {
      return c.json(
        {
          error: {
            code: "CONFLICT",
            message: "다른 작업자가 먼저 변경했습니다. 새로고침해주세요.",
          },
        },
        409,
      );
    }
    const adapter = getStreamerProviderAdapters(c.env)[account.platform];
    if (!adapter.isConfigured() || !adapter.supportsMetricRefresh()) {
      return c.json(
        {
          error: {
            code: "METRIC_REFRESH_UNAVAILABLE",
            message: "이 플랫폼은 수동 지표 갱신을 지원하지 않습니다.",
          },
        },
        409,
      );
    }
    const policy = await container.streamerAdminRepo.getActivePolicy();
    if (!policy) {
      return c.json(
        { error: { code: "POLICY_UNAVAILABLE", message: "활성 심사 정책을 불러올 수 없습니다." } },
        409,
      );
    }
    let metrics;
    try {
      metrics = await adapter.fetchChannelMetrics(account.platformUserId, {
        signal: AbortSignal.timeout(policy.values.providerTimeoutSeconds * 1_000),
      });
    } catch (caught) {
      const timedOut =
        caught instanceof Error && (caught.name === "TimeoutError" || caught.name === "AbortError");
      return c.json(
        {
          error: {
            code: timedOut ? "METRIC_REFRESH_TIMEOUT" : "METRIC_REFRESH_FAILED",
            message: timedOut
              ? "정책에 설정된 제한 시간 안에 플랫폼이 응답하지 않았습니다."
              : "공식 플랫폼 지표를 가져오지 못했습니다.",
          },
        },
        timedOut ? 504 : 502,
      );
    }
    if (metrics.channelState && metrics.channelState !== "ACTIVE") {
      return c.json(
        {
          error: {
            code: "CHANNEL_UNAVAILABLE",
            message: "공식 API에서 활성 채널을 확인하지 못했습니다.",
          },
        },
        409,
      );
    }
    result = await container.streamerAdminRepo.recordMetricRefresh({
      platformAccount: account,
      expectedVersion: parsed.data.expectedVersion,
      audienceCount: metrics.audienceCount,
      channelCreatedAt: metrics.channelCreatedAt,
      actorUserId: admin.userId,
      reason: parsed.data.reason,
      internalNote: parsed.data.internalNote,
      correlationId,
      nowIso,
    });
  } else {
    result = await container.streamerAdminRepo.applyAction({
      action: parsed.data.action,
      targetId: parsed.data.targetId,
      expectedVersion: parsed.data.expectedVersion,
      actorUserId: admin.userId,
      reason: parsed.data.reason,
      internalNote: parsed.data.internalNote,
      effectiveAt: parsed.data.effectiveAt,
      policyValues: parsed.data.policyValues,
      correlationId,
      nowIso,
    });
  }

  if (!result.applied) {
    const status = result.code === "NOT_FOUND" ? 404 : 409;
    return c.json(
      {
        error: {
          code: result.code ?? "CONFLICT",
          message:
            result.code === "OWNERSHIP_NOT_VERIFIED"
              ? "소유권이 유효한 플랫폼 계정만 승인할 수 있습니다."
              : result.code === "ACTIVE_REVIEW_EXISTS"
                ? "이 플랫폼에는 이미 진행 중인 심사가 있습니다."
                : "다른 작업자가 먼저 변경했거나 현재 상태에서 수행할 수 없는 작업입니다.",
        },
      },
      status,
    );
  }

  return c.json(
    StreamerAdminActionResponseSchema.parse({
      applied: true,
      action: parsed.data.action,
      correlationId,
      rowVersion: result.rowVersion,
    }),
  );
});
