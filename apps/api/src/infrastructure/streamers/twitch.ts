import type {
  StreamerProviderAdapter,
  StreamerChannelInfo,
  StreamerChannelMetrics,
} from "@owogg/core";

interface TwitchAppTokenCache {
  token: string;
  expiresAt: number;
}

export class TwitchStreamerProvider implements StreamerProviderAdapter {
  public platform = "TWITCH" as const;

  private appTokenCache: TwitchAppTokenCache | null = null;

  constructor(
    private clientId?: string,
    private clientSecret?: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  getAuthorizeUrl(state: string, redirectUri: string): string {
    if (!this.clientId) throw new Error("TWITCH_CLIENT_ID not configured");
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "user:read:email",
      state,
    });
    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  async verifyOwnershipCode(code: string, redirectUri: string): Promise<StreamerChannelInfo> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("Twitch OAuth credentials not configured");
    }

    const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`Twitch token exchange failed: ${tokenRes.status} ${errText}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new Error("No access token returned from Twitch");
    }

    const userRes = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": this.clientId,
      },
    });

    if (!userRes.ok) {
      const errText = await userRes.text();
      throw new Error(`Twitch Helix API call failed: ${userRes.status} ${errText}`);
    }

    const userData = (await userRes.json()) as {
      data?: Array<{
        id: string;
        login: string;
        display_name: string;
        profile_image_url?: string;
        created_at?: string;
      }>;
    };

    const users = userData.data || [];
    const user = users[0];
    if (!user || !user.id) {
      throw new Error("No Twitch user profile found");
    }

    const canonicalId = user.id;

    const result: StreamerChannelInfo = {
      platform: "TWITCH",
      platformUserId: canonicalId,
      channelName: user.display_name,
      channelHandle: `@${user.login}`,
      channelUrl: `https://www.twitch.tv/${user.login}`,
      avatarUrl: user.profile_image_url || null,
    };

    if (user.created_at) {
      result.channelCreatedAt = user.created_at;
    }

    return result;
  }

  /**
   * App Access Token(Client Credentials Grant, 사용자 토큰 아님)으로 공식 지표를 재조회합니다.
   * - 계정 생성일: GET /helix/users?id=...
   * - 팔로워 수: GET /helix/channels/followers?broadcaster_id=... (app token은 total만 반환,
   *   전체 목록은 broadcaster/moderator 사용자 스코프 필요 — 우리는 total만 사용)
   */
  supportsAutomaticMetricRefresh(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private async getAppAccessToken(): Promise<string> {
    if (this.appTokenCache && this.appTokenCache.expiresAt > Date.now()) {
      return this.appTokenCache.token;
    }
    if (!this.clientId || !this.clientSecret) {
      throw new Error("Twitch OAuth credentials not configured");
    }

    const res = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "client_credentials",
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Twitch app token exchange failed: ${res.status} ${errText}`);
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      throw new Error("No app access token returned from Twitch");
    }

    const expiresInMs = (data.expires_in ?? 3600) * 1000;
    this.appTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + Math.max(expiresInMs - 60_000, 60_000),
    };
    return data.access_token;
  }

  private helixHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": this.clientId ?? "",
    };
  }

  async fetchChannelMetrics(platformUserId: string): Promise<StreamerChannelMetrics> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("Twitch OAuth credentials not configured");
    }

    const appToken = await this.getAppAccessToken();

    const userRes = await fetch(
      `https://api.twitch.tv/helix/users?id=${encodeURIComponent(platformUserId)}`,
      { headers: this.helixHeaders(appToken) },
    );
    if (!userRes.ok) {
      if (userRes.status === 404) {
        return { audienceCount: null, channelCreatedAt: null, channelState: "NOT_FOUND" };
      }
      const errText = await userRes.text();
      throw new Error(`Twitch users API (metric refresh) failed: ${userRes.status} ${errText}`);
    }
    const userData = (await userRes.json()) as {
      data?: Array<{ created_at?: string }>;
    };
    const user = userData.data?.[0];
    if (!user) {
      return { audienceCount: null, channelCreatedAt: null, channelState: "NOT_FOUND" };
    }
    const channelCreatedAt = user?.created_at ?? null;

    const followersRes = await fetch(
      `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${encodeURIComponent(
        platformUserId,
      )}&first=1`,
      { headers: this.helixHeaders(appToken) },
    );
    if (!followersRes.ok) {
      if (followersRes.status === 404) {
        return { audienceCount: null, channelCreatedAt, channelState: "NOT_FOUND" };
      }
      const errText = await followersRes.text();
      throw new Error(
        `Twitch channels/followers API (metric refresh) failed: ${followersRes.status} ${errText}`,
      );
    }
    const followersData = (await followersRes.json()) as { total?: number };
    const audienceCount = typeof followersData.total === "number" ? followersData.total : null;

    return { audienceCount, channelCreatedAt, channelState: "ACTIVE" };
  }
}
