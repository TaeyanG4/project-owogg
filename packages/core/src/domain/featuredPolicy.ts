/**
 * Featured Streamer qualification policy (Phase E2A).
 * Pure domain logic: no D1, Hono, HTTP, or browser dependencies.
 *
 * 개념 구분:
 * - Streamer        = OwOGG 공식 API로 검증된 채널 소유권 (streamer_profiles.status)
 * - Featured       = OwOGG 기준(공개 채널 지표) 기반 자격 심사 결과 (presentation/filtering only)
 * - OwOGG Partner = 향후 직접 파트너십 (이번 단계 범위 밖)
 *
 * Featured 상태는 절대 게임 점수(Score)/XP/랭킹 순위를 변경하지 않습니다.
 */

export type FeaturedReviewStatus =
  "AUTO_REVIEW_PENDING" | "FEATURED" | "NOT_ELIGIBLE" | "MANUAL_REVIEW" | "FAILED_RETRYABLE";

export type InitialFeaturedDecision = "AUTO_REVIEW_PENDING" | "NOT_ELIGIBLE" | "MANUAL_REVIEW";
export type RecheckFeaturedDecision = "FEATURED" | "NOT_ELIGIBLE" | "MANUAL_REVIEW";
export type FeaturedRevalidationDecision = "RETAIN_FEATURED" | "REVOKE_FEATURED" | "MANUAL_REVIEW";
export type StreamerChannelState = "ACTIVE" | "NOT_FOUND" | "REVOKED";

export const FEATURED_POLICY = {
  /**
   * 자격 미달 기준 (audience < 이 값 → NOT_ELIGIBLE).
   *
   * TEMPORARY (운영자 지시, 2026-08-14): 실사용 검증 단계 — 운영자 본인의 소규모
   * YouTube/CHZZK/SOOP/Twitch 테스트 계정으로 소유권 인증 → 관리자 수동 심사(승인/미승인)
   * 전체 플로우를 끝까지 검증하기 위해 0으로 낮췄습니다. 정상 값은 10,000이며, 실사용자
   * 트래픽이 늘어나면 10_000으로 복원해야 합니다. `ACQUISITION_AUDIENCE_AUTO`(자동 승인
   * 후보 기준)는 그대로 유지되므로 — 이 값을 0으로 낮춰도 소규모 계정이 자동으로
   * FEATURED가 되지는 않고, 여전히 관리자 수동 심사 큐로만 들어갑니다.
   */
  ACQUISITION_AUDIENCE_MIN: 0,
  /** 자동 심사 후보 기준 (audience >= 이 값 → AUTO_REVIEW_PENDING 후보) */
  ACQUISITION_AUDIENCE_AUTO: 12_000,
  /**
   * 자격 미달 기준 (채널 나이 < 이 값(일) → NOT_ELIGIBLE).
   * TEMPORARY (운영자 지시, 2026-08-14) — 위 `ACQUISITION_AUDIENCE_MIN`과 동일한 사유로 0.
   * 정상 값은 90일.
   */
  ACQUISITION_CHANNEL_AGE_MIN_DAYS: 0,
  /** 자동 심사 후보 기준 (채널 나이 >= 이 값(일)) */
  ACQUISITION_CHANNEL_AGE_AUTO_DAYS: 120,
  /**
   * 향후 E2B 재검증(revalidation) 하이스테리시스 기반:
   * - 획득 기준(acquisition baseline): 10,000 (현재 임시로 0)
   * - 유지 기준(suggested retention audience): 8,000
   * 이번 단계(E2A)에서는 배지 제거(aggressive badge removal)를 수행하지 않습니다.
   *
   * TEMPORARY (운영자 지시, 2026-08-14) — 관리자가 수동 승인한 소규모 테스트 계정이
   * 14일 재검증 때 구독자 수만으로 자동 철회되지 않도록 0으로 낮췄습니다. 정상 값은 8,000.
   */
  RETENTION_AUDIENCE_FLOOR: 0,
  /** AUTO_REVIEW_PENDING 1차 심사 주기 (약 6시간) */
  REVIEW_INTERVAL_MS: 6 * 60 * 60 * 1000,
  /** FAILED_RETRYABLE 재시도 주기 (약 6시간) */
  RETRY_INTERVAL_MS: 6 * 60 * 60 * 1000,
  /** 재시도 상한 (초과 시 MANUAL_REVIEW로 종결) */
  MAX_ATTEMPTS: 5,
  /** 스케줄 배치 크기 상한 (unbounded scan 금지) */
  MAX_BATCH_SIZE: 50,
  /** 기본 스케줄 배치 크기 */
  DEFAULT_BATCH_SIZE: 20,
  /** 기존 Featured Streamer의 보수적 재검증 주기 (E2B v1: 14일) */
  REVALIDATION_INTERVAL_MS: 14 * 24 * 60 * 60 * 1000,
  /** 재검증 일시 실패 재시도 주기 */
  REVALIDATION_RETRY_INTERVAL_MS: 6 * 60 * 60 * 1000,
  /**
   * 향후 E2B: 기존 Featured Streamer 재검증 주기는 6시간이 아니라 7~30일 수준이어야 합니다.
   * 이 값은 해당 단계에서 사용할 문서화된 기준입니다.
   */
  FUTURE_REVALIDATION_INTERVAL_DAYS_MIN: 7,
  FUTURE_REVALIDATION_INTERVAL_DAYS_MAX: 30,
} as const;

/** ISO 문자열 채널 생성일 기준 경과 일수. 유효하지 않은 값이면 null (모호 → MANUAL_REVIEW). */
export function channelAgeDays(
  channelCreatedAt: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (!channelCreatedAt) return null;
  const createdMs = new Date(channelCreatedAt).getTime();
  if (Number.isNaN(createdMs)) return null;
  const diffMs = nowMs - createdMs;
  if (diffMs < 0) return null;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

export interface FeaturedQualificationInput {
  /** 소유권이 공식 API로 VERIFIED 상태인지 여부 */
  ownershipVerified: boolean;
  /** 공식 채널 지표의 구독자/팔로워 수. 알 수 없으면 null */
  audienceCount: number | null | undefined;
  /** 공식 채널/계정 생성 타임스탬프. 플랫폼이 미제공이면 null */
  channelCreatedAt: string | null | undefined;
  nowMs?: number;
}

/**
 * 초기 심사 (소유권 OAuth 콜백 스냅샷 기준).
 * 콜백 스냅샷만으로 FEATURED로 승인하지 않습니다 — 항상 AUTO_REVIEW_PENDING 이상만 부여.
 */
export function evaluateFeaturedInitial(input: FeaturedQualificationInput): {
  status: InitialFeaturedDecision;
  reason: string;
} {
  const nowMs = input.nowMs ?? Date.now();

  if (!input.ownershipVerified) {
    return {
      status: "NOT_ELIGIBLE",
      reason: "채널 소유권이 검증되지 않아 Featured 자격을 부여할 수 없습니다.",
    };
  }

  if (input.audienceCount === null || input.audienceCount === undefined) {
    return {
      status: "MANUAL_REVIEW",
      reason: "공식 구독자/팔로워 지표를 확인할 수 없어 추가 확인이 필요합니다.",
    };
  }

  if (input.channelCreatedAt === null || input.channelCreatedAt === undefined) {
    return {
      status: "MANUAL_REVIEW",
      reason: "공식 채널 생성일을 확인할 수 없어 추가 확인이 필요합니다.",
    };
  }

  const ageDays = channelAgeDays(input.channelCreatedAt, nowMs);
  if (ageDays === null) {
    return {
      status: "MANUAL_REVIEW",
      reason: "채널 생성일이 유효하지 않아 추가 확인이 필요합니다.",
    };
  }

  if (
    input.audienceCount < FEATURED_POLICY.ACQUISITION_AUDIENCE_MIN ||
    ageDays < FEATURED_POLICY.ACQUISITION_CHANNEL_AGE_MIN_DAYS
  ) {
    return {
      status: "NOT_ELIGIBLE",
      reason: `기준 미달 (구독자/팔로워 ${input.audienceCount.toLocaleString()}명 · 채널 ${ageDays}일)`,
    };
  }

  if (
    input.audienceCount >= FEATURED_POLICY.ACQUISITION_AUDIENCE_AUTO &&
    ageDays >= FEATURED_POLICY.ACQUISITION_CHANNEL_AGE_AUTO_DAYS
  ) {
    return {
      status: "AUTO_REVIEW_PENDING",
      reason: "자동 심사 대기 (약 6시간 후 공식 지표로 재확인)",
    };
  }

  return {
    status: "MANUAL_REVIEW",
    reason: `추가 확인 필요 (구독자/팔로워 ${input.audienceCount.toLocaleString()}명 · 채널 ${ageDays}일)`,
  };
}

/**
 * 6시간 후 신선한(fresh) 공식 지표 기반 재심사.
 * - 명확히 상회 → FEATURED
 * - 명확히 하회 → NOT_ELIGIBLE
 * - 지표 누락/모호 → MANUAL_REVIEW
 */
export function evaluateFeaturedRecheck(
  input: Omit<FeaturedQualificationInput, "ownershipVerified">,
): { status: RecheckFeaturedDecision; reason: string } {
  const nowMs = input.nowMs ?? Date.now();

  if (input.audienceCount === null || input.audienceCount === undefined) {
    return {
      status: "MANUAL_REVIEW",
      reason: "신선한 구독자/팔로워 지표를 확인할 수 없어 추가 확인이 필요합니다.",
    };
  }

  if (input.channelCreatedAt === null || input.channelCreatedAt === undefined) {
    return {
      status: "MANUAL_REVIEW",
      reason: "신선한 채널 생성일을 확인할 수 없어 추가 확인이 필요합니다.",
    };
  }

  const ageDays = channelAgeDays(input.channelCreatedAt, nowMs);
  if (ageDays === null) {
    return {
      status: "MANUAL_REVIEW",
      reason: "채널 생성일이 유효하지 않아 추가 확인이 필요합니다.",
    };
  }

  if (
    input.audienceCount < FEATURED_POLICY.ACQUISITION_AUDIENCE_MIN ||
    ageDays < FEATURED_POLICY.ACQUISITION_CHANNEL_AGE_MIN_DAYS
  ) {
    return {
      status: "NOT_ELIGIBLE",
      reason: `기준 미달 (구독자/팔로워 ${input.audienceCount.toLocaleString()}명 · 채널 ${ageDays}일)`,
    };
  }

  if (
    input.audienceCount >= FEATURED_POLICY.ACQUISITION_AUDIENCE_AUTO &&
    ageDays >= FEATURED_POLICY.ACQUISITION_CHANNEL_AGE_AUTO_DAYS
  ) {
    return {
      status: "FEATURED",
      reason: "Featured Streamer",
    };
  }

  return {
    status: "MANUAL_REVIEW",
    reason: `추가 확인 필요 (구독자/팔로워 ${input.audienceCount.toLocaleString()}명 · 채널 ${ageDays}일)`,
  };
}

/**
 * 기존 Featured Streamer의 보수적 재검증 정책.
 * - 8,000 이상이면 Featured 유지
 * - 8,000 미만이면 Featured 자격 철회
 * - 지표 누락/일시 오류는 배지를 자동 제거하지 않고 수동 심사로 보냅니다.
 * - NOT_FOUND/REVOKED는 공식 API가 채널 무효를 확정한 경우에만 철회합니다.
 */
export function evaluateFeaturedRevalidation(input: {
  audienceCount: number | null | undefined;
  channelState?: StreamerChannelState | undefined;
}): { status: FeaturedRevalidationDecision; reason: string } {
  if (input.channelState === "NOT_FOUND" || input.channelState === "REVOKED") {
    return {
      status: "REVOKE_FEATURED",
      reason: "공식 API에서 채널이 삭제되었거나 접근 권한이 철회된 것으로 확인되었습니다.",
    };
  }

  if (input.audienceCount === null || input.audienceCount === undefined) {
    return {
      status: "MANUAL_REVIEW",
      reason: "신선한 공식 구독자/팔로워 지표를 확인할 수 없어 Featured를 자동 변경하지 않습니다.",
    };
  }

  if (input.audienceCount < FEATURED_POLICY.RETENTION_AUDIENCE_FLOOR) {
    return {
      status: "REVOKE_FEATURED",
      reason: `유지 기준 미달 (구독자/팔로워 ${input.audienceCount.toLocaleString()}명 · 유지 기준 ${FEATURED_POLICY.RETENTION_AUDIENCE_FLOOR.toLocaleString()}명)`,
    };
  }

  return {
    status: "RETAIN_FEATURED",
    reason: `Featured 유지 (공식 구독자/팔로워 ${input.audienceCount.toLocaleString()}명)`,
  };
}
