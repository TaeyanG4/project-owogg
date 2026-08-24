import type {
  StreamerProviderAdapter,
  StreamerChannelInfo,
  StreamerChannelMetrics,
} from "@owogg/core";

export class YouTubeStreamerProvider implements StreamerProviderAdapter {
  public platform = "YOUTUBE" as const;

  constructor(
    private clientId?: string,
    private clientSecret?: string,
    private apiKey?: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  getAuthorizeUrl(state: string, redirectUri: string): string {
    if (!this.clientId) throw new Error("YOUTUBE_CLIENT_ID not configured");
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/youtube.readonly",
      access_type: "online",
      state,
      prompt: "consent",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async verifyOwnershipCode(code: string, redirectUri: string): Promise<StreamerChannelInfo> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("YouTube OAuth credentials not configured");
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`YouTube token exchange failed: ${tokenRes.status} ${errText}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new Error("No access token returned from YouTube");
    }

    const channelRes = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!channelRes.ok) {
      const errText = await channelRes.text();
      throw new Error(`YouTube channels API call failed: ${channelRes.status} ${errText}`);
    }

    const channelData = (await channelRes.json()) as {
      items?: Array<{
        id: string;
        snippet?: {
          title?: string;
          customUrl?: string;
          thumbnails?: { default?: { url?: string } };
          publishedAt?: string;
        };
        statistics?: {
          subscriberCount?: string;
        };
      }>;
    };

    const items = channelData.items || [];
    const item = items[0];
    if (!item || !item.id) {
      throw new Error("No YouTube channel found for this account");
    }

    const channelId = item.id;
    const title = item.snippet?.title || "YouTube Channel";
    const customUrl = item.snippet?.customUrl || null;
    const avatarUrl = item.snippet?.thumbnails?.default?.url || null;
    // YouTube omits `statistics.subscriberCount` entirely when the channel owner hides its
    // subscriber count — that must be persisted as UNKNOWN, never coerced to a known zero.
    const subCount =
      item.statistics?.subscriberCount !== undefined
        ? Number(item.statistics.subscriberCount)
        : undefined;

    const result: StreamerChannelInfo = {
      platform: "YOUTUBE",
      platformUserId: channelId,
      channelName: title,
      channelHandle: customUrl,
      channelUrl: customUrl
        ? `https://www.youtube.com/${customUrl}`
        : `https://www.youtube.com/channel/${channelId}`,
      avatarUrl,
      ...(subCount !== undefined && !Number.isNaN(subCount) ? { audienceCount: subCount } : {}),
    };

    if (item.snippet?.publishedAt) {
      result.channelCreatedAt = item.snippet.publishedAt;
    }

    return result;
  }

  /**
   * 공식 공개 데이터 API(API Key 기반)로 채널 지표를 재조회합니다.
   * 사용자 OAuth 토큰 없이 canonical channel ID만으로 동작합니다.
   * API Key 미설정 시 자동 재심사 미지원 → MANUAL_REVIEW 라우팅.
   */
  supportsAutomaticMetricRefresh(): boolean {
    return Boolean(this.apiKey);
  }

  async fetchChannelMetrics(platformUserId: string): Promise<StreamerChannelMetrics> {
    if (!this.apiKey) {
      throw new Error("YOUTUBE_API_KEY not configured for automatic metric refresh");
    }

    const params = new URLSearchParams({
      part: "snippet,statistics",
      id: platformUserId,
      key: this.apiKey,
    });

    const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params.toString()}`);

    if (!res.ok) {
      if (res.status === 404) {
        return { audienceCount: null, channelCreatedAt: null, channelState: "NOT_FOUND" };
      }
      const errText = await res.text();
      throw new Error(`YouTube channels API (metric refresh) failed: ${res.status} ${errText}`);
    }

    const data = (await res.json()) as {
      items?: Array<{
        snippet?: { publishedAt?: string };
        statistics?: { subscriberCount?: string };
      }>;
    };

    const item = data.items?.[0];
    if (!item) {
      return { audienceCount: null, channelCreatedAt: null, channelState: "NOT_FOUND" };
    }

    const subscriberCount = item.statistics?.subscriberCount
      ? Number(item.statistics.subscriberCount)
      : null;

    return {
      audienceCount:
        subscriberCount !== null && !Number.isNaN(subscriberCount) ? subscriberCount : null,
      channelCreatedAt: item.snippet?.publishedAt ?? null,
      channelState: "ACTIVE",
    };
  }
}
