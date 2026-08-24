import type { StreamerChannelState } from "../domain/featuredPolicy.js";
import type { StreamerPlatformType } from "./repositories.js";

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

/**
 * 6시간 자동 재심사용 공식 지표.
 * 플랫폼이 제공하지 않는 필드는 null(UNKNOWN)로 명시하고, 절대 추정값을 만들어 내지 않습니다.
 */
export interface StreamerChannelMetrics {
  /** 공식 구독자/팔로워 수. 공식 지표를 얻을 수 없으면 null */
  audienceCount: number | null;
  /** 공식 채널/계정 생성 타임스탬프. 플랫폼이 미제공이면 null */
  channelCreatedAt: string | null;
  /** 공식 API가 채널의 삭제/철회를 확정한 경우에만 ACTIVE 이외의 값을 사용합니다. */
  channelState?: StreamerChannelState;
}

export interface StreamerProviderAdapter {
  platform: StreamerPlatformType;
  isConfigured(): boolean;
  getAuthorizeUrl(state: string, redirectUri: string): string;
  verifyOwnershipCode(code: string, redirectUri: string): Promise<StreamerChannelInfo>;
  /**
   * 사용자 OAuth 토큰을 영속하지 않고 공식 app-level / 공개 API만으로
   * 신선한 지표를 재조회할 수 있는지 여부.
   * false이면 자동 재심사 대신 MANUAL_REVIEW로 안전하게 라우팅합니다.
   */
  supportsAutomaticMetricRefresh(): boolean;
  /** canonical platformUserId로 신선한 공식 지표를 조회합니다. (사용자 토큰 저장 없음) */
  fetchChannelMetrics(platformUserId: string): Promise<StreamerChannelMetrics>;
}
