import type { StreamerPlatformType } from "./repositories.js";

export type StreamerChannelState = "ACTIVE" | "NOT_FOUND" | "REVOKED";

export interface StreamerChannelInfo {
  platform: StreamerPlatformType;
  platformUserId: string; // Canonical Identity: YouTube UC..., Twitch ID, CHZZK 32-char Hash, SOOP User ID
  channelName: string;
  channelHandle: string | null;
  channelUrl: string;
  avatarUrl: string | null;
  audienceCount?: number;
  channelCreatedAt?: string;
}

/** 수동 운영자가 새로고침할 때 사용하는 공식 지표 스냅샷입니다. */
export interface StreamerChannelMetrics {
  /** 공식 구독자/팔로워 수. 공식 지표를 얻을 수 없으면 null */
  audienceCount: number | null;
  /** 공식 채널/계정 생성 타임스탬프. 플랫폼이 미제공이면 null */
  channelCreatedAt: string | null;
  /** 공식 API가 확정한 채널 상태입니다. 수동 심사 증거로만 사용합니다. */
  channelState?: StreamerChannelState;
}

/**
 * OAuth redirect providers and SOOP's official mobile certification-number flow have different
 * trust boundaries. Callers must never guess which flow a provider supports.
 */
export type StreamerOwnershipVerificationMethod = "OAUTH_REDIRECT" | "UNAVAILABLE";

export interface StreamerVerificationIntentRepository {
  /** Store only hashes of the browser-visible state and OwOGG session token. */
  create(input: {
    state: string;
    userId: number;
    sessionToken: string;
    platform: StreamerPlatformType;
    createdAt: string;
    expiresAt: string;
  }): Promise<void>;
  /** Atomically consumes one matching, unexpired intent. A failed match remains unconsumed. */
  consume(input: {
    state: string;
    userId: number;
    sessionToken: string;
    platform: StreamerPlatformType;
    consumedAt: string;
  }): Promise<boolean>;
}

export interface StreamerProviderAdapter {
  platform: StreamerPlatformType;
  verificationMethod: StreamerOwnershipVerificationMethod;
  isConfigured(): boolean;
  getAuthorizeUrl(state: string, redirectUri: string): string;
  verifyOwnershipCode(
    code: string,
    redirectUri: string,
    options?: { state?: string; signal?: AbortSignal },
  ): Promise<StreamerChannelInfo>;
  /** 공식 app-level/public API로 운영자 요청 시 지표를 새로고침할 수 있는지 여부. */
  supportsMetricRefresh(): boolean;
  /** canonical platformUserId로 운영자 요청 시 공식 지표를 조회합니다. */
  fetchChannelMetrics(
    platformUserId: string,
    options?: { signal?: AbortSignal },
  ): Promise<StreamerChannelMetrics>;
}
