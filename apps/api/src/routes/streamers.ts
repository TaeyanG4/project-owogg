import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createContainer } from "../container.js";
import type { ApiEnv } from "./auth.js";
import {
  StreamerDisconnectResponseSchema,
  StreamerPlatformSchema,
  StreamerRankingQuerySchema,
  type StreamerPlatform,
} from "@owogg/contracts";
import type { StreamerPlatformType } from "@owogg/core";
import { getStreamerProviderAdapters } from "../infrastructure/streamers/index.js";
import { readB2Config } from "./devGames.js";

async function requireAuth(c: Context<ApiEnv>): Promise<{
  userId: number;
  sessionToken: string;
  user: { id: number; nickname: string };
} | null> {
  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) return null;
  const { sessionRepo } = createContainer(c.env.DB);
  const result = await sessionRepo.findSession(sessionId);
  if (!result) return null;
  return {
    userId: result.user.id,
    sessionToken: sessionId,
    user: { id: result.user.id, nickname: result.user.nickname },
  };
}

function getStreamerRedirectUri(c: Context<ApiEnv>, platform: StreamerPlatformType): string {
  const envKey = `${platform}_REDIRECT_URI` as keyof ApiEnv["Bindings"];
  const custom = c.env[envKey] as string | undefined;
  if (custom) return custom;
  return `${new URL(c.req.url).origin}/api/streamers/verify/${platform.toLowerCase()}/callback`;
}

export const streamersRouter = new Hono<ApiEnv>();

// GET /api/streamers/providers — returns non-secret readiness check for streamer verification
streamersRouter.get("/providers", async (c) => {
  const adapters = getStreamerProviderAdapters(c.env);
  const { streamerAdminRepo } = createContainer(c.env.DB);
  const paused = await Promise.all(
    (["YOUTUBE", "TWITCH", "CHZZK", "SOOP"] as const).map((platform) =>
      streamerAdminRepo.isProviderConnectionPaused(platform),
    ),
  );
  return c.json({
    YOUTUBE: {
      configured: adapters.YOUTUBE.isConfigured(),
      paused: paused[0],
      verificationMethod: adapters.YOUTUBE.verificationMethod,
      unavailableReason: null,
    },
    TWITCH: {
      configured: adapters.TWITCH.isConfigured(),
      paused: paused[1],
      verificationMethod: adapters.TWITCH.verificationMethod,
      unavailableReason: null,
    },
    CHZZK: {
      configured: adapters.CHZZK.isConfigured(),
      paused: paused[2],
      verificationMethod: adapters.CHZZK.verificationMethod,
      unavailableReason: null,
    },
    SOOP: {
      configured: adapters.SOOP.isConfigured(),
      paused: paused[3],
      verificationMethod: adapters.SOOP.verificationMethod,
      unavailableReason: "SECURE_OAUTH_CALLBACK_BINDING_UNAVAILABLE",
    },
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
  const profile = await streamerUseCases.getStreamerProfileByUserId(auth.userId);

  return c.json({
    profile: profile
      ? {
          id: profile.id,
          userId: profile.userId,
          status: profile.status,
          suspendedUntil: profile.suspendedUntil,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
          platformAccounts: profile.platformAccounts,
        }
      : null,
  });
});

// DELETE /api/streamers/connections/:platform — release the current user's active provider
// identity. The repository snapshots ownership/review history and never touches `scores`, while
// current Streamer ranking eligibility disappears as soon as the last approved connection is
// gone.
streamersRouter.delete("/connections/:platform", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
  }

  const parsedPlatform = StreamerPlatformSchema.safeParse(c.req.param("platform").toUpperCase());
  if (!parsedPlatform.success || parsedPlatform.data === "SOOP") {
    return c.json(
      { error: { code: "INVALID_PLATFORM", message: "지원하지 않는 스트리머 플랫폼입니다." } },
      400,
    );
  }

  const { streamerUseCases } = createContainer(c.env.DB);
  const result = await streamerUseCases.disconnectPlatform(auth.userId, parsedPlatform.data);
  if (!result.ok) {
    return c.json(
      { error: { code: result.code, message: "연결된 스트리머 채널을 찾을 수 없습니다." } },
      result.code === "CONNECTION_NOT_FOUND" ? 404 : 400,
    );
  }

  return c.json(
    StreamerDisconnectResponseSchema.parse({
      disconnected: true,
      platform: parsedPlatform.data,
      remainingConnections: result.remainingConnections,
    }),
    200,
  );
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
  if (adapter.verificationMethod !== "OAUTH_REDIRECT") {
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=deferred&reason=secure_oauth_unavailable&platform=${platform.toLowerCase()}`,
    );
  }
  if (!adapter.isConfigured()) {
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=unconfigured&platform=${platform.toLowerCase()}`,
    );
  }

  const { streamerAdminRepo, streamerVerificationIntentRepo } = createContainer(c.env.DB);
  const [paused, policy] = await Promise.all([
    streamerAdminRepo.isProviderConnectionPaused(platform),
    streamerAdminRepo.getActivePolicy(),
  ]);
  if (paused) {
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=paused&platform=${platform.toLowerCase()}`,
    );
  }
  if (!policy) {
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=error&reason=policy_unavailable&platform=${platform.toLowerCase()}`,
    );
  }

  const state = crypto.randomUUID();
  const redirectUri = getStreamerRedirectUri(c, platform);
  const createdAt = new Date();
  const expiresAt = new Date(
    createdAt.getTime() + policy.values.verificationIntentTtlMinutes * 60_000,
  );
  await streamerVerificationIntentRepo.create({
    state,
    userId: auth.userId,
    sessionToken: auth.sessionToken,
    platform,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  const authorizeUrl = adapter.getAuthorizeUrl(state, redirectUri);
  return c.redirect(authorizeUrl);
});

// GET /api/streamers/verify/:platform/callback — handle OAuth callback and verify channel ownership
streamersRouter.get("/verify/:platform/callback", async (c) => {
  const rawPlatform = c.req.param("platform").toUpperCase();
  const code = c.req.query("code");
  const state = c.req.query("state");
  const frontendUrl = c.env.FRONTEND_URL || `${new URL(c.req.url).origin}`;

  const validPlatforms: StreamerPlatformType[] = ["YOUTUBE", "TWITCH", "CHZZK", "SOOP"];
  if (!validPlatforms.includes(rawPlatform as StreamerPlatformType)) {
    return c.redirect(`${frontendUrl}/settings?streamer_verify=error&reason=invalid_platform`);
  }
  const platform = rawPlatform as StreamerPlatformType;
  if (!code || !state) {
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=error&reason=state_mismatch&platform=${platform.toLowerCase()}`,
    );
  }

  const auth = await requireAuth(c);
  if (!auth) {
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=unauthorized&platform=${platform.toLowerCase()}`,
    );
  }

  const adapters = getStreamerProviderAdapters(c.env);
  const adapter = adapters[platform];
  if (adapter.verificationMethod !== "OAUTH_REDIRECT") {
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=deferred&reason=secure_oauth_unavailable&platform=${platform.toLowerCase()}`,
    );
  }
  if (!adapter.isConfigured()) {
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=unconfigured&platform=${platform.toLowerCase()}`,
    );
  }

  const container = createContainer(c.env.DB);
  const consumed = await container.streamerVerificationIntentRepo.consume({
    state,
    userId: auth.userId,
    sessionToken: auth.sessionToken,
    platform,
    consumedAt: new Date().toISOString(),
  });
  if (!consumed) {
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=error&reason=state_mismatch&platform=${platform.toLowerCase()}`,
    );
  }

  const [paused, policy] = await Promise.all([
    container.streamerAdminRepo.isProviderConnectionPaused(platform),
    container.streamerAdminRepo.getActivePolicy(),
  ]);
  if (paused) {
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=paused&platform=${platform.toLowerCase()}`,
    );
  }
  if (!policy) {
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=error&reason=policy_unavailable&platform=${platform.toLowerCase()}`,
    );
  }

  const redirectUri = getStreamerRedirectUri(c, platform);

  try {
    const channelInfo = await adapter.verifyOwnershipCode(code, redirectUri, {
      state,
      signal: AbortSignal.timeout(policy.values.providerTimeoutSeconds * 1_000),
    });
    const result = await container.streamerUseCases.verifyChannelOwnership(
      auth.userId,
      channelInfo,
    );

    if (!result.ok) {
      if (result.code === "CHANNEL_ALREADY_VERIFIED") {
        return c.redirect(
          `${frontendUrl}/settings?streamer_verify=conflict&platform=${rawPlatform.toLowerCase()}`,
        );
      }
      if (result.code === "PLATFORM_ALREADY_CONNECTED") {
        return c.redirect(
          `${frontendUrl}/settings?streamer_verify=platform_conflict&platform=${rawPlatform.toLowerCase()}`,
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
    console.error(`Streamer verification error for ${platform}:`, err);
    return c.redirect(
      `${frontendUrl}/settings?streamer_verify=error&platform=${rawPlatform.toLowerCase()}`,
    );
  }
});
