import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authRouter } from "./routes/auth.js";
import { scoresRouter } from "./routes/scores.js";
import { personalizationRouter } from "./routes/personalization.js";
import { progressionRouter } from "./routes/progression.js";
import { profileRouter } from "./routes/profile.js";
import { discordRouter } from "./routes/discordInteractions.js";
import { discordLinkRouter } from "./routes/discordLink.js";
import { discordGuildsRouter } from "./routes/discordGuilds.js";
import { streamersRouter } from "./routes/streamers.js";
import { rankingsRouter } from "./routes/rankings.js";
import { adminRouter } from "./routes/admin.js";
import { adminAuthRouter } from "./routes/adminAuth.js";
import { adminAccountsRouter } from "./routes/adminAccounts.js";
import { adminStreamersRouter } from "./routes/adminStreamers.js";
import { adminGamesRouter } from "./routes/adminGames.js";
import { adminUsersRouter } from "./routes/adminUsers.js";
import { adminGameCreatorsRouter } from "./routes/adminGameCreators.js";
import { adminSandboxGamesRouter } from "./routes/adminSandboxGames.js";
import { devGamesRouter } from "./routes/devGames.js";
import { myAccessRouter } from "./routes/myAccess.js";
import { gameServingRouter, publishedGameAssetsRouter } from "./routes/gameServing.js";
import { gamesRouter } from "./routes/games.js";
import { renderRouter } from "./routes/render.js";
import { multiplayerRouter } from "./routes/multiplayer.js";
import { createContainer } from "./container.js";
import type { ApiEnv } from "./routes/auth.js";

/**
 * Wrangler replaces this identifier at bundle time in CI. Keeping the repository SHA in the
 * bundle as well as the runtime binding makes every release produce a distinct Worker script,
 * including Web-only repository commits where the API source itself did not change.
 *
 * `typeof` keeps local tests and development safe when no Wrangler `--define` was supplied.
 */
declare const __OWOGG_BUILD_COMMIT_SHA__: string | undefined;

export function resolveCommitSha(runtimeCommitSha?: string): string {
  const bundledCommitSha =
    typeof __OWOGG_BUILD_COMMIT_SHA__ === "string" ? __OWOGG_BUILD_COMMIT_SHA__ : undefined;
  return (
    bundledCommitSha ||
    runtimeCommitSha ||
    (globalThis as unknown as { process?: { env?: { COMMIT_SHA?: string } } }).process?.env
      ?.COMMIT_SHA ||
    "dev"
  );
}

const app = new Hono<ApiEnv>();

// Middleware
function redactLogMessage(message: string): string {
  return message.replace(
    /([?&](?:token|register_token|play_token|challenge|code|state)=)[^&\s]*/gi,
    "$1[redacted]",
  );
}

app.use(
  "*",
  logger((message) => console.log(redactLogMessage(message))),
);

const DEFAULT_FRONTEND_URL = "https://owogg.com";

function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isLocalhostOrigin(value: string): boolean {
  const normalized = safeOrigin(value);
  if (!normalized) return false;
  const hostname = new URL(normalized).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isAllowedOrigin(origin: string | undefined, frontendUrl?: string): boolean {
  if (!origin) return true;
  const configured = safeOrigin(frontendUrl || DEFAULT_FRONTEND_URL);
  const requestOrigin = safeOrigin(origin);
  if (!configured || !requestOrigin) return false;
  if (requestOrigin === configured) return true;

  // Preserve the existing top-level Production/default localhost behavior used by local API
  // development. A non-Production remote frontend (notably Staging) does not inherit it; local
  // origins are accepted there only when FRONTEND_URL itself is local.
  return (
    (configured === DEFAULT_FRONTEND_URL || isLocalhostOrigin(configured)) &&
    isLocalhostOrigin(requestOrigin)
  );
}

// Scoped to /api/* only — NOT global. This is the credentialed, cookie-aware CORS policy for the
// JSON API; it must never apply to /play/* or /games/* (gameServing.ts's public bundle-asset
// routers), which serve plain files to a sandboxed game iframe rather than authenticated JSON.
// Those two get their own, deliberately different CORS treatment (see fileResponse in
// gameServing.ts) — a wildcard Access-Control-Allow-Origin with no credentials, appropriate for
// already-public, cookie-free bytes but never appropriate for an endpoint that reads a session.
//
// 2026-08-18 production bug: a sandboxed iframe (no allow-same-origin, by design — see
// GameFrame.tsx) sends `Origin: null` on its own same-document requests, including
// `<script type="module">` fetches (module scripts are always CORS-checked, unlike classic
// scripts). When this middleware was global, that request got THIS credentialed policy — which
// echoes back a specific allowed origin, never "*", once `credentials: true` is set — and the
// browser rejected the response because the echoed origin ("https://owogg.com") didn't match the
// request's actual origin ("null"). The fix is not to widen this policy to accept "null" (that
// would mean any sandboxed origin, including someone else's, gets credentialed access to the
// API); it's that game assets were never API requests and should never have shared this
// middleware with API's `credentials: true` policy in the first place.
app.use(
  "/api/*",
  cors({
    origin: (origin, c) => {
      const allowedFrontend = c.env?.FRONTEND_URL || DEFAULT_FRONTEND_URL;
      if (!origin) return allowedFrontend;
      if (isAllowedOrigin(origin, allowedFrontend)) return origin;
      return allowedFrontend;
    },
    credentials: true,
    // PATCH was missing here — every PATCH route in the API (admin sandbox-game visibility/
    // metadata, admin account role/permission edits, Discord guild settings, profile nickname/
    // country) would fail CORS preflight from a real browser and surface as an opaque "Failed to
    // fetch", never reaching the server at all (so no amount of server-side logging could have
    // caught it — this is purely a browser-enforced preflight rejection). 2026-08-18 production
    // bug report: the sandbox-game visibility toggle was the first PATCH call anyone actually
    // clicked through a real browser since this cors() config was written.
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // X-Requested-With makes the Google popup authorization-code POST non-simple, so browsers
    // must complete this exact-origin credentialed preflight before the API exchanges a code.
    allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }),
);

// CSRF / Origin Guard for state-changing HTTP requests
app.use("*", async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    const origin = c.req.header("Origin");
    const allowedFrontend = c.env?.FRONTEND_URL || DEFAULT_FRONTEND_URL;

    if (origin && !isAllowedOrigin(origin, allowedFrontend)) {
      return c.json({ error: "Forbidden: Origin verification failed" }, 403);
    }
  }
  await next();
});

// Health check
app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "owogg-hono-api",
    runtime: "Cloudflare Workers",
  });
});

app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    commit: resolveCommitSha(c.env?.COMMIT_SHA),
  });
});

// Route modules
app.route("/api/auth", authRouter);
app.route("/api/scores", scoresRouter);
app.route("/api/personalization", personalizationRouter);
app.route("/api/progression", progressionRouter);
app.route("/api/profile", profileRouter);
app.route("/api/discord", discordRouter);
app.route("/api/discord", discordLinkRouter);
app.route("/api/discord/guilds", discordGuildsRouter);
app.route("/api/streamers", streamersRouter);
app.route("/api/rankings", rankingsRouter);
// One-release rolling-deploy alias for the immediately previous Web revision. New code and docs
// must use `/api/streamers`; remove this alias only after the rollback window closes.
app.route("/api/creators", streamersRouter);
app.route("/api/admin", adminRouter);
app.route("/api/admin", adminAuthRouter);
app.route("/api/admin", adminAccountsRouter);
app.route("/api/admin/streamers", adminStreamersRouter);
app.route("/api/admin/creators", adminStreamersRouter);
app.route("/api/admin/games", adminGamesRouter);
app.route("/api/admin/users", adminUsersRouter);
app.route("/api/admin/game-creators", adminGameCreatorsRouter);
app.route("/api/admin/sandbox-games", adminSandboxGamesRouter);
app.route("/api/dev", devGamesRouter);
app.route("/api/me", myAccessRouter);
// Not under /api on purpose — these serve actual game files (HTML/JS/WASM/...), not JSON, and are
// meant to be reached through their own hostname (GAME_ORIGIN, e.g. play.owogg.com) so the iframe
// running third-party game code is a real origin boundary. Same Worker for now; only the DNS/route
// config that points that hostname here changes later. See docs/GAME_CREATION_GUIDE.md §3.8.
app.route("/play", gameServingRouter);
app.route("/games", publishedGameAssetsRouter);
app.route("/api/games", gamesRouter);
app.route("/api/render", renderRouter);
app.route("/api/multiplayer", multiplayerRouter);

// 404 Handler
app.notFound((c) => {
  return c.json({ error: "Not Found" }, 404);
});

// Error Handler
app.onError((err, c) => {
  console.error("Unhandled Hono Error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

/** Streamer 심사는 관리자 수동 작업으로만 진행하며, 이 Cron은 기존 정리 작업만 수행합니다. */
export async function scheduledHandler(
  _controller: ScheduledController,
  env: ApiEnv["Bindings"],
  ctx: ExecutionContext,
): Promise<void> {
  const { adminAuthUseCases, multiplayerInstanceRepo } = createContainer(env.DB);
  const scheduledAt = new Date();

  // Bounded, opportunistic cleanup of expired admin step-up challenges/sessions/login-attempt
  // rows — reuses this existing 6-hour Cron instead of a new background service.
  const adminCleanupTask = adminAuthUseCases
    .cleanupExpired(scheduledAt)
    .catch((err) => console.error("[admin-auth] cleanup crashed:", err));

  // Waiting rooms remain entirely in D1 and never create a Durable Object. Reuse the existing
  // six-hour Cron to expire abandoned rows and release version leases in bounded batches; active
  // gameplay still owns its precise disconnect/finalization alarms inside the authority object.
  const multiplayerCleanupTask = multiplayerInstanceRepo
    .expireDueInstances(scheduledAt.toISOString(), 100)
    .then((expiredIds) => {
      if (expiredIds.length > 0) {
        console.log(`[multiplayer] expired stale instances: count=${expiredIds.length}`);
      }
    })
    .catch((err) => console.error("[multiplayer] expiry cleanup crashed:", err));

  ctx.waitUntil(Promise.all([adminCleanupTask, multiplayerCleanupTask]));
}

export { app };
