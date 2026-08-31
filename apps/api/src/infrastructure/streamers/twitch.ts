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
  public verificationMethod = "OAUTH_REDIRECT" as const;

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
      // GET /helix/users needs no user permission scope for the token owner. Keep the required
      // OAuth parameter empty rather than requesting the unrelated verified-email field.
      scope: "",
      state,
    });
    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  async verifyOwnershipCode(
    code: string,
    redirectUri: string,
    options?: { signal?: AbortSignal },
  ): Promise<StreamerChannelInfo> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("Twitch OAuth credentials not configured");
    }

    const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      ...(options?.signal ? { signal: options.signal } : {}),
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
      throw new Error(`Twitch token exchange failed with HTTP ${tokenRes.status}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new Error("No access token returned from Twitch");
    }

    const userRes = await fetch("https://api.twitch.tv/helix/users", {
      ...(options?.signal ? { signal: options.signal } : {}),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": this.clientId,
      },
    });

    if (!userRes.ok) {
      throw new Error(`Twitch Helix API call failed with HTTP ${userRes.status}`);
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
  supportsMetricRefresh(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private async getAppAccessToken(signal?: AbortSignal): Promise<string> {
    if (this.appTokenCache && this.appTokenCache.expiresAt > Date.now()) {
      return this.appTokenCache.token;
    }
    if (!this.clientId || !this.clientSecret) {
      throw new Error("Twitch OAuth credentials not configured");
    }

    const res = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      ...(signal ? { signal } : {}),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "client_credentials",
      }),
    });

    if (!res.ok) {
      throw new Error(`Twitch app token exchange failed with HTTP ${res.status}`);
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

  async fetchChannelMetrics(
    platformUserId: string,
    options?: { signal?: AbortSignal },
  ): Promise<StreamerChannelMetrics> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("Twitch OAuth credentials not configured");
    }

    const appToken = await this.getAppAccessToken(options?.signal);

    const userRes = await fetch(
      `https://api.twitch.tv/helix/users?id=${encodeURIComponent(platformUserId)}`,
      {
        headers: this.helixHeaders(appToken),
        ...(options?.signal ? { signal: options.signal } : {}),
      },
    );
    if (!userRes.ok) {
      if (userRes.status === 404) {
        return { audienceCount: null, channelCreatedAt: null, channelState: "NOT_FOUND" };
      }
      throw new Error(`Twitch users API (metric refresh) failed with HTTP ${userRes.status}`);
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
      {
        headers: this.helixHeaders(appToken),
        ...(options?.signal ? { signal: options.signal } : {}),
      },
    );
    if (!followersRes.ok) {
      if (followersRes.status === 404) {
        return { audienceCount: null, channelCreatedAt, channelState: "NOT_FOUND" };
      }
      throw new Error(
        `Twitch channels/followers API (metric refresh) failed with HTTP ${followersRes.status}`,
      );
    }
    const followersData = (await followersRes.json()) as { total?: number };
    const audienceCount = typeof followersData.total === "number" ? followersData.total : null;

    return { audienceCount, channelCreatedAt, channelState: "ACTIVE" };
  }
}
