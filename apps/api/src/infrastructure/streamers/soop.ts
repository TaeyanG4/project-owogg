import type { StreamerProviderAdapter, StreamerChannelMetrics } from "@owogg/core";

export class SoopStreamerProvider implements StreamerProviderAdapter {
  public platform = "SOOP" as const;
  public verificationMethod = "UNAVAILABLE" as const;

  constructor(
    private clientId?: string,
    private clientSecret?: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  getAuthorizeUrl(state: string, redirectUri: string): string {
    void state;
    void redirectUri;
    throw new Error("SOOP browser ownership verification is not safely supported");
  }

  async verifyOwnershipCode(): Promise<never> {
    throw new Error(
      "SOOP browser ownership verification is deferred until callback binding is safe",
    );
  }

  /**
   * SOOP 공식 Open API는 방송국 정보(user/stationinfo) 조회에 사용자 access_token을
   * 요구하며 공개(app-level) 지표 조회를 제공하지 않습니다. 사용자 OAuth 토큰을
   * 영속하지 않으므로 운영자의 별도 지표 갱신도 지원하지 않습니다.
   */
  supportsMetricRefresh(): boolean {
    return false;
  }

  async fetchChannelMetrics(): Promise<StreamerChannelMetrics> {
    throw new Error("SOOP metric refresh is unsupported without user token");
  }
}
