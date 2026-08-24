import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createContainer } from "../container.js";
import type { ApiEnv } from "./auth.js";
import { StreamerRankingQuerySchema, type StreamerPlatform } from "@owogg/contracts";
import type { StreamerPlatformType } from "@owogg/core";
import { getStreamerProviderAdapters } from "../infrastructure/streamers/index.js";
import { readB2Config } from "./devGames.js";

function isLocalhost(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

async function requireAuth(
  c: Context<ApiEnv>,
): Promise<{ userId: number; user: { id: number; nickname: string } } | null> {
  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) return null;
  const { sessionRepo } = createContainer(c.env.DB);
  const result = await sessionRepo.findSession(sessionId);
  if (!result) return null;
  return { userId: result.user.id, user: { id: result.user.id, nickname: result.user.nickname } };
}

function getStreamerRedirectUri(c: Context<ApiEnv>, platform: StreamerPlatformType): string {
  const envKey = `${platform}_REDIRECT_URI` as keyof ApiEnv["Bindings"];
  const custom = c.env[envKey] as string | undefined;
  if (custom) return custom;
  return `${new URL(c.req.url).origin}/api/streamers/verify/${platform.toLowerCase()}/callback`;
}

export const streamersRouter = new Hono<ApiEnv>();

function getPublicFeaturedReviewReason(status: string): string | null {
  switch (status) {
    case "AUTO_REVIEW_PENDING":
    case "REVALIDATION_PENDING":
      return "공식 지표 자동 심사를 기다리는 중입니다.";
    case "FAILED_RETRYABLE":
    case "REVALIDATION_FAILED_RETRYABLE":
      return "공식 지표를 다시 확인하는 중입니다.";
    case "MANUAL_REVIEW":
      return "추가 확인이 필요한 상태입니다.";
    case "FEATURED":
      return "Featured Streamer 상태입니다.";
    case "NOT_ELIGIBLE":
      return "현재 Featured 기준을 충족하지 않습니다.";
    default:
      return null;
  }
}

// GET /api/streamers/providers — returns non-secret readiness check for streamer verification
streamersRouter.get("/providers", (c) => {
  const adapters = getStreamerProviderAdapters(c.env);
  return c.json({
    YOUTUBE: { configured: adapters.YOUTUBE.isConfigured() },
    TWITCH: { configured: adapters.TWITCH.isConfigured() },
    CHZZK: { configured: adapters.CHZZK.isConfigured() },
    SOOP: { configured: adapters.SOOP.isConfigured() },
  });
});

// GET /api/streamers/rankings
streamersRouter.get("/rankings", async (c) => {
  const queryParse = StreamerRankingQuerySchema.safeParse({
    mode: c.req.query("mode"),
    gameId: c.req.query("gameId"),
    platform: c.req.query("platform"),
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });

  if (!queryParse.success) {
    return c.json(
      { error: { code: "INVALID_QUERY", message: "Streamer 랭킹 검색 조건이 올바르지 않습니다." } },
      400,
    );
  }

  const { mode, gameId, platform, limit, offset } = queryParse.data;
  if (gameId && gameId !== "all" && !c.env?.DB) {
    return c.json(
      { error: { code: "INVALID_GAME_ID", message: "존재하지 않는 게임 ID입니다." } },
      400,
    );
  }
  const container = createContainer(c.env.DB, readB2Config(c.env));
  if (gameId && gameId !== "all" && !(await container.publicGameCatalog.findBySlug(gameId))) {
    return c.json(
      { error: { code: "INVALID_GAME_ID", message: "존재하지 않는 게임 ID입니다." } },
      400,
    );
  }

  const { streamerUseCases } = container;

  const queryOpts: {
    mode: "score" | "xp";
    gameId?: string;
    platform?: StreamerPlatform;
    limit?: number;
    offset?: number;
  } = {
    mode,
    limit,
    offset,
  };
  if (gameId !== undefined) queryOpts.gameId = gameId;
  if (platform !== undefined) queryOpts.platform = platform;

  const result = await streamerUseCases.getStreamerRankings(queryOpts);

  return c.json({
    entries: result.entries,
    total: result.total,
    mode,
    gameId,
    platform,
    limit,
    offset,
  });
});

// GET /api/streamers/me
streamersRouter.get("/me", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
  }

  const { streamerUseCases } = createContainer(c.env.DB);
  const [profile, featuredReview] = await Promise.all([
    streamerUseCases.getStreamerProfileByUserId(auth.userId),
    streamerUseCases.getFeaturedReviewState(auth.userId),
  ]);

  return c.json({
    profile: profile
      ? {
          id: profile.id,
          userId: profile.userId,
          status: profile.status,
          featuredStatus: profile.featuredStatus,
          featuredReason: profile.featuredReason,
          featuredSince: profile.featuredSince,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
          platformAccounts: profile.platformAccounts,
          featuredReview: featuredReview
            ? {
                status: featuredReview.status,
                reason: getPublicFeaturedReviewReason(featuredReview.status),
                nextCheckAt: featuredReview.nextCheckAt,
                attemptCount: featuredReview.attemptCount,
              }
            : null,
        }
      : null,
  });
});

// GET /api/streamers/verify/:platform — initiate OAuth ownership verification
streamersRouter.get("/verify/:platform", async (c) => {
  const auth = await requireAuth(c);
  const frontendUrl = c.env.FRONTEND_URL || `${new URL(c.req.url).origin}`;
  const rawPlatform = c.req.param("platform").toUpperCase();

  const validPlatforms: StreamerPlatformType[] = ["YOUTUBE", "TWITCH", "CHZZK", "SOOP"];
  if (!validPlatforms.includes(rawPlatform as StreamerPlatformType)) {
    return c.redirect(`${frontendUrl}/settings?streamer_verify=error&reason=invalid_platform`);
  }

  const platform = rawPlatform as StreamerPlatformType;
  if (!auth) {
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=unauthorized&platform=${platform.toLowerCase()}`,
    );
  }

  const adapters = getStreamerProviderAdapters(c.env);
  const adapter = adapters[platform];
  if (!adapter || !adapter.isConfigured()) {
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=unconfigured&platform=${platform.toLowerCase()}`,
    );
  }

  const state = crypto.randomUUID();
  const redirectUri = getStreamerRedirectUri(c, platform);

  const payload = JSON.stringify({ state, userId: auth.userId, platform });
  setCookie(c, "streamer_verify_state", payload, {
    httpOnly: true,
    secure: !isLocalhost(c.req.url),
    sameSite: "Lax",
    maxAge: 600,
    path: "/",
  });

  const authorizeUrl = adapter.getAuthorizeUrl(state, redirectUri);
  return c.redirect(authorizeUrl);
});

// GET /api/streamers/verify/:platform/callback — handle OAuth callback and verify channel ownership
streamersRouter.get("/verify/:platform/callback", async (c) => {
  const rawPlatform = c.req.param("platform").toUpperCase() as StreamerPlatformType;
  const code = c.req.query("code");
  const state = c.req.query("state");
  const frontendUrl = c.env.FRONTEND_URL || `${new URL(c.req.url).origin}`;

  const cookieState = getCookie(c, "streamer_verify_state");
  deleteCookie(c, "streamer_verify_state", { path: "/" });

  let intent: { state: string; userId: number; platform: StreamerPlatformType } | null = null;
  if (cookieState) {
    try {
      const parsed = JSON.parse(cookieState) as {
        state?: string;
        userId?: number;
        platform?: StreamerPlatformType;
      };
      if (
        typeof parsed.state === "string" &&
        typeof parsed.userId === "number" &&
        typeof parsed.platform === "string"
      ) {
        intent = { state: parsed.state, userId: parsed.userId, platform: parsed.platform };
      }
    } catch {
      intent = null;
    }
  }

  if (!code || !state || !intent || intent.state !== state || intent.platform !== rawPlatform) {
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=error&reason=state_mismatch&platform=${rawPlatform.toLowerCase()}`,
    );
  }

  const auth = await requireAuth(c);
  if (!auth || auth.userId !== intent.userId) {
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=unauthorized&platform=${rawPlatform.toLowerCase()}`,
    );
  }

  const adapters = getStreamerProviderAdapters(c.env);
  const adapter = adapters[rawPlatform];
  if (!adapter || !adapter.isConfigured()) {
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=unconfigured&platform=${rawPlatform.toLowerCase()}`,
    );
  }

  const redirectUri = getStreamerRedirectUri(c, rawPlatform);

  try {
    const channelInfo = await adapter.verifyOwnershipCode(code, redirectUri);
    const { streamerUseCases } = createContainer(c.env.DB);
    const result = await streamerUseCases.verifyChannelOwnership(auth.userId, channelInfo);

    if (!result.ok) {
      if (result.code === "CHANNEL_ALREADY_VERIFIED") {
        return c.redirect(
          `${frontendUrl}/settings?streamer_verify=conflict&platform=${rawPlatform.toLowerCase()}`,
        );
      }
      return c.redirect(
        `${frontendUrl}/settings?streamer_verify=error&platform=${rawPlatform.toLowerCase()}`,
      );
    }

    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=success&platform=${rawPlatform.toLowerCase()}&channel=${encodeURIComponent(
        channelInfo.channelName,
      )}`,
    );
  } catch (err) {
    console.error(`Streamer verification error for ${rawPlatform}:`, err);
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=error&platform=${rawPlatform.toLowerCase()}`,
    );
  }
});
