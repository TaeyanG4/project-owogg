import type {
  StreamerProviderAdapter,
  StreamerChannelInfo,
  StreamerChannelMetrics,
} from "@owogg/core";

export class ChzzkStreamerProvider implements StreamerProviderAdapter {
  public platform = "CHZZK" as const;
  public verificationMethod = "OAUTH_REDIRECT" as const;

  constructor(
    private clientId?: string,
    private clientSecret?: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  getAuthorizeUrl(state: string, redirectUri: string): string {
    if (!this.clientId) throw new Error("CHZZK_CLIENT_ID not configured");
    const params = new URLSearchParams({
      clientId: this.clientId,
      redirectUri,
      state,
    });
    return `https://chzzk.naver.com/account-interlock?${params.toString()}`;
  }

  async verifyOwnershipCode(
    code: string,
    _redirectUri: string,
    options?: { state?: string; signal?: AbortSignal },
  ): Promise<StreamerChannelInfo> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("CHZZK OAuth credentials not configured");
    }
    if (!options?.state) {
      throw new Error("CHZZK OAuth state is required for token exchange");
    }

    const tokenRes = await fetch("https://openapi.chzzk.naver.com/auth/v1/token", {
      method: "POST",
      ...(options.signal ? { signal: options.signal } : {}),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grantType: "authorization_code",
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        code,
        state: options.state,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`CHZZK token exchange failed with HTTP ${tokenRes.status}`);
    }

    const tokenData = (await tokenRes.json()) as {
      accessToken?: string;
      content?: { accessToken?: string };
    };
    const accessToken = tokenData.content?.accessToken ?? tokenData.accessToken;
    if (!accessToken) {
      throw new Error("No access token returned from CHZZK");
    }

    const channelRes = await fetch("https://openapi.chzzk.naver.com/open/v1/users/me", {
      ...(options.signal ? { signal: options.signal } : {}),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!channelRes.ok) {
      throw new Error(`CHZZK API call failed with HTTP ${channelRes.status}`);
    }

    const channelData = (await channelRes.json()) as {
      content?: {
        channelId?: string;
        channelName?: string;
        channelImageUrl?: string;
        followerCount?: number;
      };
    };

    const content = channelData.content;
    if (!content || !content.channelId) {
      throw new Error("No CHZZK channel profile found for this account");
    }

    const channelId = content.channelId;

    return {
      platform: "CHZZK",
      platformUserId: channelId,
      channelName: content.channelName || "CHZZK Channel",
      channelHandle: null,
      channelUrl: `https://chzzk.naver.com/${channelId}`,
      avatarUrl: content.channelImageUrl || null,
      // Absent/non-numeric followerCount must persist as UNKNOWN, not a known zero.
      ...(typeof content.followerCount === "number" && !Number.isNaN(content.followerCount)
        ? { audienceCount: content.followerCount }
        : {}),
    };
  }

  /**
   * CHZZK 공식 Open API의 채널 정보 조회(GET /open/v1/channels?channelIds=)는
   * Client 인증(Client-Id/Client-Secret 헤더)만으로 동작하여 사용자 토큰 없이 팔로워 수를
   * 재조회할 수 있습니다. 단, 공식 API는 채널 생성일을 제공하지 않으므로
   * fetchChannelMetrics는 channelCreatedAt=null을 반환하며 운영자가 이 UNKNOWN 증거를
   * 직접 판단합니다.
   */
  supportsMetricRefresh(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  async fetchChannelMetrics(
    platformUserId: string,
    options?: { signal?: AbortSignal },
  ): Promise<StreamerChannelMetrics> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("CHZZK OAuth credentials not configured");
    }

    const params = new URLSearchParams({ channelIds: platformUserId });
    const res = await fetch(
      `https://openapi.chzzk.naver.com/open/v1/channels?${params.toString()}`,
      {
        ...(options?.signal ? { signal: options.signal } : {}),
        headers: {
          "Client-Id": this.clientId,
          "Client-Secret": this.clientSecret,
        },
      },
    );

    if (!res.ok) {
      if (res.status === 404) {
        return { audienceCount: null, channelCreatedAt: null, channelState: "NOT_FOUND" };
      }
      throw new Error(`CHZZK channels API (metric refresh) failed with HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      content?: {
        data?: Array<{ followerCount?: number }>;
      };
    };

    const first = data.content?.data?.[0];
    const followerCount =
      first?.followerCount !== undefined && first.followerCount !== null
        ? Number(first.followerCount)
        : null;

    // 공식 API가 채널 생성일을 제공하지 않음 → UNKNOWN으로 명시 (추정 금지)
    if (!first) {
      return { audienceCount: null, channelCreatedAt: null, channelState: "NOT_FOUND" };
    }

    return {
      audienceCount: followerCount !== null && !Number.isNaN(followerCount) ? followerCount : null,
      channelCreatedAt: null,
      channelState: "ACTIVE",
    };
  }
}
