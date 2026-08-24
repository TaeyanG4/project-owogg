import type {
  StreamerProviderAdapter,
  StreamerChannelInfo,
  StreamerChannelMetrics,
  StreamerPlatformType,
} from "@owogg/core";

export class MockStreamerProvider implements StreamerProviderAdapter {
  constructor(
    public platform: StreamerPlatformType,
    private configured = true,
    private mockResult?: StreamerChannelInfo,
    private mockError?: string,
    private metricsOverride?: StreamerChannelMetrics,
  ) {}

  isConfigured(): boolean {
    return this.configured;
  }

  /** 테스트 전용: 자동 재심사 지원 여부를 오버라이드합니다. */
  setMetricsRefreshSupported(supported: boolean): void {
    this.metricsRefreshSupported = supported;
  }

  private metricsRefreshSupported = true;

  getAuthorizeUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams();
    params.set("state", state);
    params.set("redirect_uri", redirectUri);
    params.set("platform", this.platform);
    return `https://mock.owogg.dev/auth/${this.platform}?${params.toString()}`;
  }

  async verifyOwnershipCode(code: string, _redirectUri: string): Promise<StreamerChannelInfo> {
    if (this.mockError) {
      throw new Error(this.mockError);
    }
    if (this.mockResult) {
      return this.mockResult;
    }
    if (code === "invalid_code") {
      throw new Error("Invalid authorization code");
    }

    return {
      platform: this.platform,
      platformUserId: `mock_${this.platform.toLowerCase()}_${code}`,
      channelName: `Mock ${this.platform} Channel (${code})`,
      channelHandle: `@mock_${code}`,
      channelUrl: `https://${this.platform.toLowerCase()}.com/mock_${code}`,
      avatarUrl: `https://mock.owogg.dev/avatars/${code}.png`,
      audienceCount: 15000,
      channelCreatedAt: "2023-01-01T00:00:00Z",
    };
  }

  supportsAutomaticMetricRefresh(): boolean {
    return this.configured && this.metricsRefreshSupported;
  }

  async fetchChannelMetrics(_platformUserId: string): Promise<StreamerChannelMetrics> {
    if (this.metricsOverride) {
      return this.metricsOverride;
    }
    return {
      audienceCount: 15000,
      channelCreatedAt: "2023-01-01T00:00:00Z",
      channelState: "ACTIVE",
    };
  }
}
