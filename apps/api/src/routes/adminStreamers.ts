import { Hono } from "hono";
import {
  StreamerManualReviewActionRequestSchema,
  AdminPaginationQuerySchema,
  type StreamerManualReviewAction,
} from "@owogg/contracts";
import type { StreamerManualReviewItem, StreamerReviewAuditLog } from "@owogg/core";
import { createContainer } from "../container.js";
import { isTrustedAdminOrigin } from "../auth/admin.js";
import {
  requireElevatedAdmin,
  isElevatedAdminResponse,
  requirePermission,
} from "../auth/adminSession.js";
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

function mapReviewItem(item: StreamerManualReviewItem) {
  return {
    job: {
      id: item.job.id,
      streamerPlatformAccountId: item.job.streamerPlatformAccountId,
      reviewType: item.job.reviewType,
      status: item.job.status,
      initialAudience: item.job.initialAudience,
      initialChannelCreatedAt: item.job.initialChannelCreatedAt,
      nextCheckAt: item.job.nextCheckAt,
      attemptCount: item.job.attemptCount,
      reviewReason: item.job.reviewReason,
      createdAt: item.job.createdAt,
      updatedAt: item.job.updatedAt,
      completedAt: item.job.completedAt,
    },
    userId: item.userId,
    nickname: item.nickname,
    streamerId: item.streamerId,
    streamerStatus: item.streamerStatus,
    featuredStatus: item.featuredStatus,
    platformAccount: item.platformAccount,
  };
}

function mapAudit(audit: StreamerReviewAuditLog) {
  return {
    ...audit,
    platform: audit.platform ?? null,
    channelName: audit.channelName ?? null,
  };
}

adminStreamersRouter.get("/reviews", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "streamers.review");
  if (denied) return denied;

  const pagination = AdminPaginationQuerySchema.safeParse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  if (!pagination.success) {
    return c.json(
      { error: { code: "INVALID_QUERY", message: "limit과 offset은 올바른 정수여야 합니다." } },
      400,
    );
  }
  const { limit, offset } = pagination.data;
  const { streamerUseCases } = createContainer(c.env.DB);
  const result = await streamerUseCases.listManualStreamerReviews({ limit, offset });

  return c.json({
    items: result.items.map(mapReviewItem),
    total: result.total,
    audits: {
      entries: result.audits.entries.map(mapAudit),
      total: result.audits.total,
    },
  });
});

adminStreamersRouter.post("/reviews/:jobId/action", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "streamers.review");
  if (denied) return denied;

  const jobId = Number(c.req.param("jobId"));
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    return c.json(
      { error: { code: "INVALID_JOB_ID", message: "심사 ID가 올바르지 않습니다." } },
      400,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "요청 본문이 올바르지 않습니다." } },
      400,
    );
  }
  const parsed = StreamerManualReviewActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "명시적인 심사 사유가 필요합니다." } },
      400,
    );
  }

  const { streamerUseCases } = createContainer(c.env.DB);
  const result = await streamerUseCases.applyManualStreamerReview({
    jobId,
    reviewerUserId: admin.userId,
    action: parsed.data.action as StreamerManualReviewAction,
    reason: parsed.data.reason,
  });

  if (!result.applied && result.code === "NOT_FOUND") {
    return c.json({ error: { code: result.code, message: "심사 항목을 찾을 수 없습니다." } }, 404);
  }
  if (!result.applied && result.code === "OWNERSHIP_NOT_VERIFIED") {
    return c.json(
      {
        error: {
          code: result.code,
          message: "소유권이 검증된 Streamer만 Featured로 승인할 수 있습니다.",
        },
      },
      409,
    );
  }
  if (!result.applied && result.code === "INVALID_REASON") {
    return c.json(
      { error: { code: result.code, message: "심사 사유는 3자 이상 입력해야 합니다." } },
      400,
    );
  }

  return c.json({
    applied: result.applied,
    action: parsed.data.action,
    previousStatus: result.previousStatus,
    newStatus: result.newStatus,
  });
});
