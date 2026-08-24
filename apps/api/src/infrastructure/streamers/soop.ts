import type {
  StreamerProviderAdapter,
  StreamerChannelInfo,
  StreamerChannelMetrics,
} from "@owogg/core";

export class SoopStreamerProvider implements StreamerProviderAdapter {
  public platform = "SOOP" as const;

  constructor(
    private clientId?: string,
    private clientSecret?: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  getAuthorizeUrl(state: string, redirectUri: string): string {
    if (!this.clientId) throw new Error("SOOP_CLIENT_ID not configured");
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
    });
    return `https://openapi.sooplive.co.kr/auth/authorize?${params.toString()}`;
  }

  async verifyOwnershipCode(code: string, redirectUri: string): Promise<StreamerChannelInfo> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("SOOP OAuth credentials not configured");
    }

    const tokenRes = await fetch("https://openapi.sooplive.co.kr/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`SOOP token exchange failed: ${tokenRes.status} ${errText}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new Error("No access token returned from SOOP");
    }

    const userRes = await fetch("https://openapi.sooplive.co.kr/user/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      const errText = await userRes.text();
      throw new Error(`SOOP API call failed: ${userRes.status} ${errText}`);
    }

    const userData = (await userRes.json()) as {
      user_id?: string;
      user_nick?: string;
      profile_image?: string;
      fan_count?: number;
    };

    if (!userData.user_id) {
      throw new Error("No SOOP channel profile found for this account");
    }

    const userId = userData.user_id;

    return {
      platform: "SOOP",
      platformUserId: userId,
      channelName: userData.user_nick || userId,
      channelHandle: `@${userId}`,
      channelUrl: `https://www.sooplive.co.kr/${userId}`,
      avatarUrl: userData.profile_image || null,
      // Absent/non-numeric fan_count must persist as UNKNOWN, not a known zero.
      ...(typeof userData.fan_count === "number" && !Number.isNaN(userData.fan_count)
        ? { audienceCount: userData.fan_count }
        : {}),
    };
  }

  /**
   * SOOP 공식 Open API는 방송국 정보(user/stationinfo) 조회에 사용자 access_token을
   * 요구하며 공개(app-level) 지표 조회를 제공하지 않습니다. E1 원칙에 따라 사용자
   * OAuth 토큰을 영속하지 않으므로 자동 재심사를 지원하지 않습니다.
   * → 상위 정책이 MANUAL_REVIEW로 안전하게 라우팅합니다.
   */
  supportsAutomaticMetricRefresh(): boolean {
    return false;
  }

  async fetchChannelMetrics(_platformUserId: string): Promise<StreamerChannelMetrics> {
    throw new Error("SOOP automatic metric refresh is unsupported without user token");
  }
}
