import type {
  StreamerProviderAdapter,
  StreamerChannelInfo,
  StreamerChannelMetrics,
} from "@owogg/core";

export class ChzzkStreamerProvider implements StreamerProviderAdapter {
  public platform = "CHZZK" as const;

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
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
    });
    return `https://nid.naver.com/oauth2.0/authorize?${params.toString()}`;
  }

  async verifyOwnershipCode(code: string, redirectUri: string): Promise<StreamerChannelInfo> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("CHZZK OAuth credentials not configured");
    }

    const tokenRes = await fetch("https://nid.naver.com/oauth2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        state: "chzzk",
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`CHZZK token exchange failed: ${tokenRes.status} ${errText}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new Error("No access token returned from CHZZK");
    }

    const channelRes = await fetch("https://openapi.chzzk.naver.com/open/v1/users/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!channelRes.ok) {
      const errText = await channelRes.text();
      throw new Error(`CHZZK API call failed: ${channelRes.status} ${errText}`);
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
   * fetchChannelMetrics는 channelCreatedAt=null을 반환하며, 이 경우 상위 정책이
   * MANUAL_REVIEW로 안전하게 라우팅합니다.
   */
  supportsAutomaticMetricRefresh(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  async fetchChannelMetrics(platformUserId: string): Promise<StreamerChannelMetrics> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("CHZZK OAuth credentials not configured");
    }

    const params = new URLSearchParams({ channelIds: platformUserId });
    const res = await fetch(
      `https://openapi.chzzk.naver.com/open/v1/channels?${params.toString()}`,
      {
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
      const errText = await res.text();
      throw new Error(`CHZZK channels API (metric refresh) failed: ${res.status} ${errText}`);
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
