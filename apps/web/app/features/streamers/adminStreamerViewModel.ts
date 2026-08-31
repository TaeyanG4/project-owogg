import type {
  PermissionValue,
  StreamerAdminAction,
  StreamerAdminSection,
  StreamerOwnershipStatus,
  StreamerPlatform,
  StreamerPlatformApprovalStatus,
  StreamerPolicyField,
  StreamerPolicyUnit,
  StreamerReviewWorkState,
} from "@owogg/contracts";
import { isStreamerUiPlatform, STREAMER_UI_PLATFORM_LABELS } from "./streamerPlatforms";

export const STREAMER_ADMIN_SECTION_LABELS: Record<StreamerAdminSection, string> = {
  OVERVIEW: "운영 개요",
  STREAMERS: "스트리머 목록",
  REVIEWS: "심사 작업함",
  POLICY: "정책 설정",
  PROVIDERS: "플랫폼 연결",
  AUDIT: "감사 이력",
};

export const STREAMER_PLATFORM_LABELS = STREAMER_UI_PLATFORM_LABELS;

export function formatStreamerPlatform(platform: StreamerPlatform) {
  return isStreamerUiPlatform(platform) ? STREAMER_UI_PLATFORM_LABELS[platform] : null;
}

export const STREAMER_OWNERSHIP_LABELS: Record<StreamerOwnershipStatus, string> = {
  UNVERIFIED: "미확인",
  VERIFIED: "확인됨",
  DISCONNECTED: "연결 해제",
  INVALIDATED: "무효화",
  EXPIRED: "만료",
};

export const STREAMER_APPROVAL_LABELS: Record<StreamerPlatformApprovalStatus, string> = {
  PENDING: "심사 대기",
  APPROVED: "승인",
  REJECTED: "거절",
};

export const STREAMER_REVIEW_STATE_LABELS: Record<StreamerReviewWorkState, string> = {
  QUEUED: "대기",
  ON_HOLD: "보류",
  APPROVED: "승인",
  REJECTED: "거절",
  CANCELLED: "취소",
};

export const STREAMER_POLICY_FIELD_LABELS: Record<StreamerPolicyField, string> = {
  minimumAudience: "최소 구독자·팔로워",
  minimumChannelAgeDays: "최소 채널 운영 기간",
  ownershipValidityDays: "소유권 유효 기간",
  reverificationNoticeDays: "재인증 사전 알림",
  verificationIntentTtlMinutes: "OAuth 인증 유효 시간",
  claimLeaseMinutes: "심사 담당 유지 시간",
  reviewSlaHours: "심사 처리 목표",
  holdDefaultHours: "기본 보류 시간",
  reconsiderationCooldownDays: "재심 신청 대기 기간",
  providerTimeoutSeconds: "플랫폼 API 제한 시간",
};

export const STREAMER_POLICY_UNIT_LABELS: Record<StreamerPolicyUnit, string> = {
  PEOPLE: "명",
  DAYS: "일",
  HOURS: "시간",
  MINUTES: "분",
  SECONDS: "초",
};

const ACTION_PERMISSION: Record<StreamerAdminAction, PermissionValue> = {
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

export function canPerformStreamerAdminAction(
  permissions: readonly PermissionValue[],
  action: StreamerAdminAction,
) {
  return permissions.includes(ACTION_PERMISSION[action]);
}

export function canViewStreamerAdminSection(
  permissions: readonly PermissionValue[],
  section: StreamerAdminSection,
) {
  if (!permissions.includes("streamers.view")) return false;
  if (section === "POLICY") {
    return (
      permissions.includes("streamers.policy.manage") || permissions.includes("streamers.view")
    );
  }
  return true;
}

export function formatStreamerDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatStreamerAudience(value: number | null) {
  return value === null ? "확인 불가" : `${value.toLocaleString("ko-KR")}명`;
}
