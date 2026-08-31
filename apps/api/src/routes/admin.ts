import { Hono } from "hono";
import {
  AdminOverviewResponseSchema,
  AdminMonitoringResponseSchema,
  DEFAULT_STREAMER_ADMIN_WORKSPACE_QUERY,
} from "@owogg/contracts";
import { createContainer } from "../container.js";
import { getStreamerProviderAdapters } from "../infrastructure/streamers/index.js";
import { isTrustedAdminOrigin } from "../auth/admin.js";
import {
  requireElevatedAdmin,
  isElevatedAdminResponse,
  requirePermission,
} from "../auth/adminSession.js";
import { DISCORD_SUBCOMMANDS } from "../infrastructure/discord/commands.js";
import type { ApiEnv } from "./auth.js";

export const adminRouter = new Hono<ApiEnv>();

adminRouter.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method.toUpperCase())) {
    if (!isTrustedAdminOrigin(c.req.header("Origin"), c.env.FRONTEND_URL)) {
      return c.json(
        { error: { code: "FORBIDDEN", message: "요청 출처를 확인할 수 없습니다." } },
        403,
      );
    }
  }
  await next();
});

// GET /api/admin/me lives in adminAuth.ts (mounted at the same /api/admin base path) — it
// reports step-up/login state and is intentionally reachable before an elevated session exists.

// GET /api/admin/overview — sensitive review/audit summary; requires a full elevated admin
// session (ADMIN_USER_IDS alone is no longer sufficient, GET included).
adminRouter.get("/overview", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "admin.center.access");
  if (denied) return denied;

  const container = createContainer(c.env.DB);
  const [streamerWorkspace, activeGuildCount] = await Promise.all([
    container.streamerAdminRepo.getWorkspace(DEFAULT_STREAMER_ADMIN_WORKSPACE_QUERY, admin.userId),
    container.discordGuildRepo.getActiveGuildCount(),
  ]);
  const adapters = getStreamerProviderAdapters(c.env);

  const response = AdminOverviewResponseSchema.parse({
    pendingStreamerReviews: streamerWorkspace.overview.pendingPlatformReviews,
    recentAudits: streamerWorkspace.audits.items.slice(0, 5).map((audit) => ({
      action: audit.action,
      platform: null,
      createdAt: audit.createdAt,
    })),
    discord: {
      interactionsConfigured: Boolean(c.env.DISCORD_PUBLIC_KEY),
      activeGuildCount,
      oauthConfigured: Boolean(c.env.DISCORD_CLIENT_ID && c.env.DISCORD_CLIENT_SECRET),
      installUrlConfigured: Boolean(c.env.DISCORD_INSTALL_URL),
      commandSyncEnabled: c.env.DISCORD_COMMAND_SYNC_ENABLED === "true",
      expectedInteractionsEndpoint: `${new URL(c.req.url).origin}/api/discord/interactions`,
      localSubcommands: Object.values(DISCORD_SUBCOMMANDS),
    },
    streamerProviders: {
      YOUTUBE: adapters.YOUTUBE.isConfigured(),
      TWITCH: adapters.TWITCH.isConfigured(),
      CHZZK: adapters.CHZZK.isConfigured(),
      SOOP: adapters.SOOP.isConfigured(),
    },
  });
  return c.json(response);
});

// 7 days keeps the "recent activity" read close to the WAU window above it, without a query
// param to plumb through yet — extend this to an optional `?days=` if that's ever needed.
const GAME_PLAY_COUNTS_WINDOW_DAYS = 7;

// GET /api/admin/monitoring — read-only operational snapshot (DAU/WAU, per-game play counts
// over the last week, D1 reachability). No write paths, so unlike most admin.ts endpoints this
// doesn't go through a UseCases layer — see AdminMonitoringRepository's doc comment.
adminRouter.get("/monitoring", async (c) => {
  const admin = await requireElevatedAdmin(c);
  if (isElevatedAdminResponse(admin)) return admin;
  const denied = requirePermission(admin, "system.monitor");
  if (denied) return denied;

  const container = createContainer(c.env.DB);
  const [activeUsers, gamePlayCounts, d1] = await Promise.all([
    container.adminMonitoringRepo.getActiveUserCounts(),
    container.adminMonitoringRepo.getGamePlayCounts(GAME_PLAY_COUNTS_WINDOW_DAYS),
    container.adminMonitoringRepo.checkD1Health(),
  ]);

  const response = AdminMonitoringResponseSchema.parse({
    activeUsers,
    gamePlayCounts,
    gamePlayCountsWindowDays: GAME_PLAY_COUNTS_WINDOW_DAYS,
    d1,
  });
  return c.json(response);
});
