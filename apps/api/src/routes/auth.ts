import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createContainer } from "../container.js";
import type { D1Database } from "@cloudflare/workers-types";
import {
  exchangeGoogleAuthorizationCode,
  verifyGoogleToken,
  type GoogleUserProfile,
} from "../infrastructure/oauth/google.js";
import {
  buildDiscordAuthorizeUrl,
  exchangeDiscordCode,
  fetchUserManageableGuilds,
} from "../infrastructure/oauth/discord.js";
import {
  ConnectedProvidersResponseSchema,
  LinkProviderRequestSchema,
  LinkProviderResponseSchema,
  UnlinkProviderResponseSchema,
  MergePreviewPairSchema,
  CreateMergeChallengeResponseSchema,
  ConfirmAccountMergeRequestSchema,
  ConfirmAccountMergeResponseSchema,
  MergeChallengeResolveRequestSchema,
  MergePreviewQuerySchema,
  GoogleAuthorizationCodeLoginRequestSchema,
} from "@owogg/contracts";
import type { SocialProvider } from "@owogg/contracts";
import { OAuthIdentityConflictError } from "@owogg/core";

const KNOWN_PROVIDERS: SocialProvider[] = ["google", "discord"];

function isKnownProvider(value: string): value is SocialProvider {
  return (KNOWN_PROVIDERS as string[]).includes(value);
}

function accountError(
  c: Context<ApiEnv>,
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 500,
  extra?: Record<string, unknown>,
) {
  return c.json({ error: { code, message }, ...(extra ?? {}) }, status);
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

export type ApiEnv = {
  Bindings: {
    DB: D1Database;
    /** Backblaze B2 (S3-compatible) storage for sandbox game bundles (migration 0024) — all four
     * optional so an environment that hasn't set them up yet still boots; upload routes 503
     * cleanly instead (see devGames.ts's `readB2Config`). Plain `wrangler secret put` values, not
     * a Cloudflare binding — no wrangler.jsonc entry required. See
     * docs/GAME_CREATION_GUIDE.md §3.2/§3.8, docs/GAME_UPLOAD_GUIDE.md. */
    B2_ENDPOINT?: string;
    B2_REGION?: string;
    B2_BUCKET_NAME?: string;
    B2_KEY_ID?: string;
    B2_APPLICATION_KEY?: string;
    /** Hostname sandbox game bundles are allowed to be served from in production (e.g.
     * `https://play.owogg.com`) — see routes/gameServing.ts's host guard. Absent means "no
     * dedicated domain connected yet", which fails CLOSED for anything but localhost: sandbox UGC
     * must never be reachable via api.owogg.com (2026-08-17 beta hardening). Set with a plain
     * `wrangler secret put GAME_ORIGIN` once play.owogg.com is connected — not a binding, no
     * wrangler.jsonc entry required, same reasoning as the B2_* values above. */
    GAME_ORIGIN?: string;
    /** HMAC secret for signing/verifying Game Session tokens (packages/core/src/domain/
     * gameSession.ts) — the generic GameHost result flow depends on it
     * (apps/web/app/features/game/gameResultFlow.ts). Plain `wrangler secret put
     * GAME_SESSION_SECRET`, not a Cloudflare binding — no wrangler.jsonc entry required, same
     * reasoning as the B2_* and GAME_ORIGIN values above. Optional here at the type level so a
     * local/preview environment without it still boots (POST /api/games/:slug/session fails
     * closed with 503 rather than signing with an empty/predictable secret) — but Production is
     * NOT allowed to run without it: .github/workflows/deploy.yml lists it as a required Worker
     * secret (`secrets:` on the Deploy API Worker step), which hard-fails the deploy rather than
     * shipping a Production Worker that would 503 on every Game Creator result-submission attempt. See
     * docs/PRODUCTION_INTEGRATIONS.md §5 for the operator-facing setup steps. */
    GAME_SESSION_SECRET?: string;
    /** Master kill switch. Only the exact string "true" opens multiplayer admission. */
    MULTIPLAYER_ENABLED?: string;
    /** Dedicated HMAC key material for short-lived WebSocket join tickets. */
    MULTIPLAYER_TICKET_KEY_ID?: string;
    MULTIPLAYER_TICKET_SECRET?: string;
    /** Optional one-key verification overlap for rotation; both values must be present together. */
    MULTIPLAYER_TICKET_PREVIOUS_KEY_ID?: string;
    MULTIPLAYER_TICKET_PREVIOUS_SECRET?: string;
    /** Exact API Worker origin used for the multiplayer WebSocket handshake. */
    MULTIPLAYER_SOCKET_ORIGIN?: string;
    /** Environment-local self binding. Optional in types so disabled/unconfigured previews boot. */
    MULTIPLAYER_INSTANCES?: DurableObjectNamespace;
    /** Hibernatable waiting-room invalidation fan-out; it owns no game or roster state. */
    MULTIPLAYER_LOBBY_SIGNALS?: DurableObjectNamespace;
    /** Multiplayer state-changing operation abuse limiter. Required whenever multiplayer is enabled. */
    MULTIPLAYER_RATE_LIMITER?: {
      limit(options: { key: string }): Promise<{ success: boolean }>;
    };
    /** Higher-capacity, separately metered limiter for authenticated roster recovery and socket
     * reconnection. Keeping this separate prevents transport recovery from exhausting action
     * capacity while still failing closed against reconnect floods. */
    MULTIPLAYER_RECOVERY_RATE_LIMITER?: {
      limit(options: { key: string }): Promise<{ success: boolean }>;
    };
    GOOGLE_CLIENT_ID?: string;
    /** Server-only credential for the Google authorization-code exchange. Never expose to Web. */
    GOOGLE_CLIENT_SECRET?: string;
    DISCORD_CLIENT_ID?: string;
    DISCORD_CLIENT_SECRET?: string;
    DISCORD_REDIRECT_URI?: string;
    /** Discord application's public key (non-secret), used to verify Interaction signatures. */
    DISCORD_PUBLIC_KEY?: string;
    /** Developer Portal에서 명시적으로 구성한 공개 Discord 설치 링크(선택). */
    DISCORD_INSTALL_URL?: string;
    /** "true"일 때만 배포 CI/CD가 배포 후 전역 Discord 명령어를 자동 동기화합니다(선택). Admin
     * Center 진단 표시 전용 — 실제 동기화는 GitHub Actions에서 Bot Token으로 수행되며 이 값
     * 자체는 Worker 런타임에 Bot Token을 노출하지 않습니다. */
    DISCORD_COMMAND_SYNC_ENABLED?: string;
    FRONTEND_URL?: string;
    COMMIT_SHA?: string;
    /** 쉼표로 구분한 명시적 OwOGG 사용자 ID. 미설정 시 관리자 권한 없음 (ROOT eligibility). */
    ADMIN_USER_IDS?: string;
    /** 쉼표로 구분한, 관리자 Google 계정 step-up에 허용된 Google canonical OIDC subject(sub) 목록. */
    ADMIN_GOOGLE_SUBS?: string;
    /** 관리자 2차 로그인 사용자명 (평문 저장 금지 대상은 비밀번호만 — 이 값 자체는 식별자). */
    ADMIN_LOGIN_USERNAME?: string;
    /** PBKDF2-HMAC-SHA256 파생 레코드 (`pbkdf2_sha256$iterations$salt$hash`). 평문 비밀번호는 어디에도 저장하지 않음. */
    ADMIN_PASSWORD_PBKDF2?: string;
    /** Optional elevated-admin session lifetime in seconds. Invalid or over-12-hour values fall
     * back to the 30-minute default. Staging injects 43200; Production leaves it unset. */
    ADMIN_SESSION_TTL_SECONDS?: string;
    YOUTUBE_CLIENT_ID?: string;
    YOUTUBE_CLIENT_SECRET?: string;
    /** YouTube Data API key (public data) — 운영자가 요청한 수동 공식 지표 갱신에만 사용. */
    YOUTUBE_API_KEY?: string;
    YOUTUBE_REDIRECT_URI?: string;
    TWITCH_CLIENT_ID?: string;
    TWITCH_CLIENT_SECRET?: string;
    TWITCH_REDIRECT_URI?: string;
    CHZZK_CLIENT_ID?: string;
    CHZZK_CLIENT_SECRET?: string;
    CHZZK_REDIRECT_URI?: string;
    SOOP_CLIENT_ID?: string;
    SOOP_CLIENT_SECRET?: string;
    SOOP_REDIRECT_URI?: string;
    USE_MOCK_STREAMER_PROVIDERS?: string;
    /** 쉼표로 구분한, 이 배포에서 필수로 기대하는 Streamer provider 목록 (예: "YOUTUBE,TWITCH").
     * 배포 readiness 게이트(scripts/verify-production.ts)가 사용하며 미설정 시 필수 provider가 없음을 의미. */
    STREAMER_ENABLED_PROVIDERS?: string;
  };
};

export const authRouter = new Hono<ApiEnv>();

// Helper to check if request is localhost
export function isLocalhost(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function resolveGooglePopupRedirectUri(frontendUrl?: string): string | null {
  if (!frontendUrl) return null;
  try {
    const url = new URL(frontendUrl);
    if (url.username || url.password) return null;
    if (url.protocol !== "https:" && !isLocalhost(url.toString())) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function establishGoogleSession(c: Context<ApiEnv>, profile: GoogleUserProfile) {
  const { userRepo, sessionRepo } = createContainer(c.env.DB);
  const user = await userRepo.findOrCreateUser({
    provider: "google",
    providerUserId: profile.sub,
    email: profile.email,
    nickname: profile.name,
    avatarUrl: profile.picture,
  });

  const session = await sessionRepo.createSession(user.id);
  const secure = !isLocalhost(c.req.url);
  setCookie(c, "owogg_session", session.id, {
    httpOnly: true,
    secure,
    sameSite: secure ? "None" : "Lax",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });

  return c.json({ authenticated: true, user });
}

// Discord only has ONE redirect_uri registered in its Developer Portal (DISCORD_REDIRECT_URI,
// pointing at /api/auth/discord/callback). Both the LOGIN flow and the LINK flow must send
// this exact same redirect_uri to the authorize endpoint AND the token exchange, or Discord
// rejects the request with "잘못된 OAuth2 redirect_uri" before the user ever sees a prompt.
// LOGIN vs LINK intent is distinguished by which state cookie is present, not by the path.
export function getDiscordRedirectUri(c: Context<ApiEnv>): string {
  return c.env.DISCORD_REDIRECT_URI || `${new URL(c.req.url).origin}/api/auth/discord/callback`;
}

// GET /api/auth/providers (non-secret readiness check)
authRouter.get("/providers", (c) => {
  const googleConfigured = Boolean(
    c.env?.GOOGLE_CLIENT_ID &&
    c.env?.GOOGLE_CLIENT_SECRET &&
    resolveGooglePopupRedirectUri(c.env?.FRONTEND_URL),
  );
  const discordConfigured = Boolean(
    c.env?.DISCORD_CLIENT_ID &&
    c.env?.DISCORD_CLIENT_SECRET &&
    c.env?.DISCORD_REDIRECT_URI &&
    c.env?.FRONTEND_URL,
  );

  return c.json({
    google: {
      configured: googleConfigured,
      ...(googleConfigured ? { clientId: c.env.GOOGLE_CLIENT_ID } : {}),
    },
    discord: {
      configured: discordConfigured,
    },
  });
});

// POST /api/auth/google
authRouter.post("/google", async (c) => {
  try {
    const body = (await c.req.json<{ credential?: string }>().catch(() => ({}))) as {
      credential?: string;
    };
    const credential = body.credential;

    if (!credential) {
      return c.json({ error: "Credential is required" }, 400);
    }

    const verifyResult = await verifyGoogleToken(credential, c.env.GOOGLE_CLIENT_ID);
    if (!verifyResult.valid || !verifyResult.profile) {
      return c.json({ error: verifyResult.reason || "Invalid Google token" }, 401);
    }

    return await establishGoogleSession(c, verifyResult.profile);
  } catch (err) {
    if (err instanceof OAuthIdentityConflictError && err.code === "ACCOUNT_PREVIOUSLY_REGISTERED") {
      return accountError(
        c,
        "ACCOUNT_PREVIOUSLY_REGISTERED",
        "이 Google 계정은 이전에 OwOGG에 등록되어 새 계정으로 다시 가입할 수 없습니다.",
        409,
      );
    }
    console.error("Google Auth Error:", err);
    return c.json({ error: "Internal server error during Google login" }, 500);
  }
});

// POST /api/auth/google/code — popup Authorization Code login used by OwOGG's own full-width
// button. The previous credential route remains during the rolling-deploy window for older Web
// revisions and for the separate account-link/admin step-up flows.
authRouter.post("/google/code", async (c) => {
  c.header("Cache-Control", "no-store");

  // Google recommends this non-simple header for popup code delivery. Together with credentialed
  // CORS and app.ts's exact Origin guard, it forces a browser preflight and rejects cross-site
  // form posts before a one-time code can be exchanged.
  if (c.req.header("X-Requested-With")?.toLowerCase() !== "xmlhttprequest") {
    return c.json({ error: "Invalid Google authorization request" }, 403);
  }

  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = resolveGooglePopupRedirectUri(c.env.FRONTEND_URL);
  if (!clientId || !clientSecret || !redirectUri) {
    return c.json({ error: "Google authorization-code login is not configured" }, 503);
  }

  const body = await c.req.json<unknown>().catch(() => null);
  const parsed = GoogleAuthorizationCodeLoginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "A valid Google authorization code is required" }, 400);
  }

  const exchanged = await exchangeGoogleAuthorizationCode({
    code: parsed.data.code,
    clientId,
    clientSecret,
    redirectUri,
  });
  if (!exchanged.valid || !exchanged.idToken) {
    return c.json({ error: exchanged.reason || "Google authorization code was rejected" }, 401);
  }

  const verified = await verifyGoogleToken(exchanged.idToken, clientId);
  if (!verified.valid || !verified.profile) {
    return c.json({ error: verified.reason || "Invalid Google ID token" }, 401);
  }

  try {
    return await establishGoogleSession(c, verified.profile);
  } catch (err) {
    if (err instanceof OAuthIdentityConflictError && err.code === "ACCOUNT_PREVIOUSLY_REGISTERED") {
      return accountError(
        c,
        "ACCOUNT_PREVIOUSLY_REGISTERED",
        "이 Google 계정은 이전에 OwOGG에 등록되어 새 계정으로 다시 가입할 수 없습니다.",
        409,
      );
    }
    console.error("Google authorization-code login error:", err);
    return c.json({ error: "Internal server error during Google login" }, 500);
  }
});

// GET /api/auth/discord
authRouter.get("/discord", async (c) => {
  const clientId = c.env.DISCORD_CLIENT_ID;
  const redirectUri = getDiscordRedirectUri(c);

  if (!clientId) {
    return c.text("DISCORD_CLIENT_ID is not configured", 500);
  }

  const state = crypto.randomUUID();

  setCookie(c, "discord_oauth_state", state, {
    httpOnly: true,
    secure: !isLocalhost(c.req.url),
    sameSite: "Lax",
    maxAge: 600,
    path: "/",
  });

  const discordUrl = buildDiscordAuthorizeUrl({
    clientId,
    redirectUri,
    state,
  });

  return c.redirect(discordUrl);
});

// GET /api/auth/discord/register-server — starts 1-time Discord OAuth for guild registration
authRouter.get("/discord/register-server", async (c) => {
  const auth = await requireAuth(c);
  const frontendUrl = c.env.FRONTEND_URL || `${new URL(c.req.url).origin}`;
  if (!auth) {
    return c.redirect(`${frontendUrl}/discord/servers?register_status=unauthorized`);
  }

  const clientId = c.env.DISCORD_CLIENT_ID;
  const redirectUri = getDiscordRedirectUri(c);

  if (!clientId) {
    return c.text("DISCORD_CLIENT_ID is not configured", 500);
  }

  const state = crypto.randomUUID();
  const payload = JSON.stringify({ state, userId: auth.userId });

  setCookie(c, "discord_register_server_state", payload, {
    httpOnly: true,
    secure: !isLocalhost(c.req.url),
    sameSite: "Lax",
    maxAge: 600,
    path: "/",
  });

  const discordUrl = buildDiscordAuthorizeUrl({
    clientId,
    redirectUri,
    state,
    scope: "identify guilds",
  });

  return c.redirect(discordUrl);
});

// GET /api/auth/discord/callback — handles LOGIN, LINK, and SERVER_REGISTRATION flows, since
// all share the single redirect_uri registered with Discord.
authRouter.get("/discord/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const frontendUrl = c.env.FRONTEND_URL || `${new URL(c.req.url).origin}`;

  // Check for Server Registration intent
  const registerServerStateCookie = getCookie(c, "discord_register_server_state");
  if (registerServerStateCookie) {
    deleteCookie(c, "discord_register_server_state", { path: "/" });

    let registerIntent: { state: string; userId: number } | null = null;
    try {
      const parsed = JSON.parse(registerServerStateCookie) as { state?: string; userId?: number };
      if (typeof parsed.state === "string" && typeof parsed.userId === "number") {
        registerIntent = { state: parsed.state, userId: parsed.userId };
      }
    } catch {
      registerIntent = null;
    }

    if (!code || !state || !registerIntent || registerIntent.state !== state) {
      return c.redirect(`${frontendUrl}/discord/servers?register_status=error`);
    }

    const auth = await requireAuth(c);
    if (!auth || auth.userId !== registerIntent.userId) {
      return c.redirect(`${frontendUrl}/discord/servers?register_status=unauthorized`);
    }

    const clientId = c.env.DISCORD_CLIENT_ID;
    const clientSecret = c.env.DISCORD_CLIENT_SECRET;
    const redirectUri = getDiscordRedirectUri(c);

    if (!clientId || !clientSecret) {
      return c.redirect(`${frontendUrl}/discord/servers?register_status=error`);
    }

    const exchangeResult = await exchangeDiscordCode({ code, clientId, clientSecret, redirectUri });
    if (!exchangeResult.valid || !exchangeResult.accessToken) {
      return c.redirect(`${frontendUrl}/discord/servers?register_status=error`);
    }

    const guildsResult = await fetchUserManageableGuilds(exchangeResult.accessToken);
    if (!guildsResult.valid || !guildsResult.guilds || guildsResult.guilds.length === 0) {
      return c.redirect(`${frontendUrl}/discord/servers?register_status=no_guilds`);
    }

    const { discordGuildRepo } = createContainer(c.env.DB);
    const challenge = await discordGuildRepo.createRegistrationChallenge({
      userId: auth.userId,
      manageableGuilds: guildsResult.guilds,
      ttlSeconds: 900,
    });

    return c.redirect(
      `${frontendUrl}/discord/servers?register_token=${encodeURIComponent(challenge.token)}`,
    );
  }

  const linkStateCookie = getCookie(c, "discord_link_state");

  if (linkStateCookie) {
    deleteCookie(c, "discord_link_state", { path: "/" });

    let linkIntent: { state: string; userId: number } | null = null;
    try {
      const parsed = JSON.parse(linkStateCookie) as { state?: string; userId?: number };
      if (typeof parsed.state === "string" && typeof parsed.userId === "number") {
        linkIntent = { state: parsed.state, userId: parsed.userId };
      }
    } catch {
      linkIntent = null;
    }

    if (!code || !state || !linkIntent || linkIntent.state !== state) {
      return c.redirect(`${frontendUrl}/settings?link_status=error`);
    }

    // Re-validate the current authenticated session belongs to the same user that started the link.
    const auth = await requireAuth(c);
    if (!auth || auth.userId !== linkIntent.userId) {
      return c.redirect(`${frontendUrl}/settings?link_status=error`);
    }

    const clientId = c.env.DISCORD_CLIENT_ID;
    const clientSecret = c.env.DISCORD_CLIENT_SECRET;
    const redirectUri = getDiscordRedirectUri(c);

    if (!clientId || !clientSecret) {
      return c.redirect(`${frontendUrl}/settings?link_status=error`);
    }
    const exchangeResult = await exchangeDiscordCode({ code, clientId, clientSecret, redirectUri });
    if (!exchangeResult.valid || !exchangeResult.profile) {
      return c.redirect(`${frontendUrl}/settings?link_status=error`);
    }

    const profile = exchangeResult.profile;
    const { identityUseCases } = createContainer(c.env.DB);
    const result = await identityUseCases.linkProvider(
      auth.userId,
      "discord",
      profile.id,
      profile.email,
      profile.avatarUrl,
    );

    if (!result.ok) {
      if (
        result.code === "ACCOUNT_ALREADY_LINKED" ||
        result.code === "ACCOUNT_PREVIOUSLY_REGISTERED"
      ) {
        return c.redirect(`${frontendUrl}/settings?link_status=registered&provider=discord`);
      }
      return c.redirect(`${frontendUrl}/settings?link_status=already&provider=discord`);
    }

    return c.redirect(`${frontendUrl}/settings?link_status=success&provider=discord`);
  }

  // ---- Normal LOGIN callback ----
  const cookieState = getCookie(c, "discord_oauth_state");

  if (!code || !state || !cookieState || cookieState !== state) {
    deleteCookie(c, "discord_oauth_state", { path: "/" });
    return c.text("Invalid state or missing code", 400);
  }

  deleteCookie(c, "discord_oauth_state", { path: "/" });

  const clientId = c.env.DISCORD_CLIENT_ID;
  const clientSecret = c.env.DISCORD_CLIENT_SECRET;
  const redirectUri = getDiscordRedirectUri(c);

  if (!clientId || !clientSecret) {
    return c.text("Discord client secret not configured", 500);
  }

  const exchangeResult = await exchangeDiscordCode({
    code,
    clientId,
    clientSecret,
    redirectUri,
  });

  if (!exchangeResult.valid || !exchangeResult.profile) {
    return c.text(exchangeResult.reason || "Failed to exchange Discord code", 400);
  }

  const profile = exchangeResult.profile;
  const { userRepo, sessionRepo } = createContainer(c.env.DB);

  let user;
  try {
    user = await userRepo.findOrCreateUser({
      provider: "discord",
      providerUserId: profile.id,
      email: profile.email,
      nickname: profile.username,
      avatarUrl: profile.avatarUrl,
    });
  } catch (error) {
    if (
      error instanceof OAuthIdentityConflictError &&
      error.code === "ACCOUNT_PREVIOUSLY_REGISTERED"
    ) {
      return c.redirect(`${frontendUrl}/?auth_error=account_previously_registered`);
    }
    throw error;
  }

  const session = await sessionRepo.createSession(user.id);
  const secure = !isLocalhost(c.req.url);

  setCookie(c, "owogg_session", session.id, {
    httpOnly: true,
    secure,
    sameSite: secure ? "None" : "Lax",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });

  return c.redirect(frontendUrl);
});

// GET /api/auth/me
authRouter.get("/me", async (c) => {
  const sessionId = getCookie(c, "owogg_session");
  if (!sessionId) {
    return c.json({ authenticated: false }, 401);
  }

  try {
    const { sessionRepo } = createContainer(c.env.DB);
    const result = await sessionRepo.findSession(sessionId);

    if (!result) {
      deleteCookie(c, "owogg_session", { path: "/" });
      return c.json({ authenticated: false }, 401);
    }

    return c.json({
      authenticated: true,
      user: result.user,
    });
  } catch (err) {
    console.error("/me Error:", err);
    return c.json({ authenticated: false }, 401);
  }
});

// POST /api/auth/logout
authRouter.post("/logout", async (c) => {
  const sessionId = getCookie(c, "owogg_session");
  if (sessionId) {
    try {
      const { sessionRepo, adminAuthUseCases } = createContainer(c.env.DB);
      await sessionRepo.deleteSession(sessionId);
      // A normal OwOGG logout must never leave an elevated admin session alive on top of a
      // now-dead underlying session.
      await adminAuthUseCases.logoutAllForSession(sessionId);
    } catch {
      // Ignore DB error during logout
    }
  }

  deleteCookie(c, "owogg_session", { path: "/" });
  deleteCookie(c, "owogg_admin_session", { path: "/" });
  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// Account Identity: connected providers, linking and unlinking
// ---------------------------------------------------------------------------

// GET /api/auth/accounts — list the connected OAuth providers for the current user
authRouter.get("/accounts", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthenticated" } }, 401);
  }

  if (!c.env?.DB) {
    return c.json({ error: "Database unavailable" }, 500);
  }

  const { identityUseCases } = createContainer(c.env.DB);
  const providers = await identityUseCases.getConnectedProviders(auth.userId);
  const validated = ConnectedProvidersResponseSchema.parse({ providers });
  return c.json(validated, 200);
});

// POST /api/auth/link/google — attach a Google identity to the current account
authRouter.post("/link/google", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthenticated" } }, 401);
  }

  if (!c.env?.DB) {
    return c.json({ error: "Database unavailable" }, 500);
  }

  const body = (await c.req.json<{ credential?: string }>().catch(() => ({}))) as {
    credential?: string;
  };
  const parsed = LinkProviderRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Credential is required" }, 400);
  }

  const verifyResult = await verifyGoogleToken(parsed.data.credential, c.env.GOOGLE_CLIENT_ID);
  if (!verifyResult.valid || !verifyResult.profile) {
    return c.json({ error: verifyResult.reason || "Invalid Google token" }, 401);
  }

  const profile = verifyResult.profile;
  const { identityUseCases } = createContainer(c.env.DB);
  const result = await identityUseCases.linkProvider(
    auth.userId,
    "google",
    profile.sub,
    profile.email,
    profile.picture,
  );

  if (!result.ok) {
    if (
      result.code === "ACCOUNT_ALREADY_LINKED" ||
      result.code === "ACCOUNT_PREVIOUSLY_REGISTERED"
    ) {
      return accountError(
        c,
        "ACCOUNT_PREVIOUSLY_REGISTERED",
        "이 Google 계정은 이전에 OwOGG에 등록되어 다른 계정에 다시 연결할 수 없습니다.",
        409,
      );
    }
    return accountError(
      c,
      "PROVIDER_ALREADY_LINKED",
      "이 계정에는 이미 Google 로그인이 연결되어 있습니다.",
      409,
    );
  }

  const validated = LinkProviderResponseSchema.parse({
    linked: true,
    provider: "google",
    alreadyLinked: result.alreadyLinked,
  });
  return c.json(validated, 200);
});

// GET /api/auth/link/discord — begin Discord OAuth LINK flow
authRouter.get("/link/discord", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.text("Authentication required to link a provider", 401);
  }

  const clientId = c.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    return c.text("DISCORD_CLIENT_ID is not configured", 500);
  }
  const redirectUri = getDiscordRedirectUri(c);

  const state = crypto.randomUUID();
  const statePayload = JSON.stringify({ state, userId: auth.userId });
  setCookie(c, "discord_link_state", statePayload, {
    httpOnly: true,
    secure: !isLocalhost(c.req.url),
    sameSite: "Lax",
    maxAge: 600,
    path: "/",
  });

  const discordUrl = buildDiscordAuthorizeUrl({ clientId, redirectUri, state });
  return c.redirect(discordUrl);
});

// DELETE /api/auth/link/:provider — detach a provider from the current account
authRouter.delete("/link/:provider", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthenticated" } }, 401);
  }

  if (!c.env?.DB) {
    return c.json({ error: "Database unavailable" }, 500);
  }

  const provider = c.req.param("provider");
  if (!isKnownProvider(provider)) {
    return c.json({ error: "Unknown provider" }, 400);
  }

  const { identityUseCases } = createContainer(c.env.DB);
  const result = await identityUseCases.unlinkProvider(auth.userId, provider);

  if (!result.ok) {
    return accountError(
      c,
      "LAST_AUTH_PROVIDER",
      "마지막 로그인 수단은 해제할 수 없습니다. 최소 한 개의 로그인 계정이 필요합니다.",
      400,
    );
  }

  const validated = UnlinkProviderResponseSchema.parse({
    unlinked: true,
    provider: result.provider,
  });
  return c.json(validated, 200);
});

// ---------------------------------------------------------------------------
// Account merge workflow (Primary Account Wins)
// ---------------------------------------------------------------------------

// POST /api/auth/merge/challenge — resolve an existing fresh merge challenge for a conflict
authRouter.post("/merge/challenge", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthenticated" } }, 401);
  }
  if (!c.env?.DB) {
    return c.json({ error: "Database unavailable" }, 500);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsedBody = MergeChallengeResolveRequestSchema.safeParse(body);
  if (!parsedBody.success || parsedBody.data.conflictUserId === auth.userId) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "통합 대상 계정과 provider를 확인해주세요." } },
      400,
    );
  }

  const { accountMergeUseCases } = createContainer(c.env.DB);
  const existing = await accountMergeUseCases.findPendingMergeChallenge(
    auth.userId,
    parsedBody.data.conflictUserId,
  );
  if (!existing || new Date(existing.expiresAt) <= new Date()) {
    return c.json(
      {
        error: {
          code: "MERGE_CHALLENGE_EXPIRED",
          message:
            "유효한 계정 통합 세션이 없습니다. 로그인 수단 연결을 다시 시도해 새 인증을 진행해주세요.",
        },
      },
      404,
    );
  }

  const validated = CreateMergeChallengeResponseSchema.parse({
    challengeId: existing.id,
    expiresAt: existing.expiresAt,
    conflictUserId: parsedBody.data.conflictUserId,
    provider: parsedBody.data.provider,
  });
  return c.json(validated, 200);
});

// GET /api/auth/merge/preview?challenge=<id> — safe summaries of both candidate accounts
authRouter.get("/merge/preview", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthenticated" } }, 401);
  }
  if (!c.env?.DB) {
    return c.json({ error: "Database unavailable" }, 500);
  }

  const challengeQuery = MergePreviewQuerySchema.safeParse({ challenge: c.req.query("challenge") });
  if (!challengeQuery.success) {
    return c.json(
      { error: { code: "INVALID_QUERY", message: "challenge 값이 올바르지 않습니다." } },
      400,
    );
  }
  const challengeId = challengeQuery.data.challenge;

  const { accountMergeUseCases } = createContainer(c.env.DB);
  const challenge = await accountMergeUseCases.findMergeChallenge(challengeId);
  if (!challenge) {
    return c.json(
      { error: { code: "MERGE_CHALLENGE_EXPIRED", message: "유효하지 않은 통합 세션입니다." } },
      404,
    );
  }
  if (auth.userId !== challenge.userA && auth.userId !== challenge.userB) {
    return c.json(
      { error: { code: "MERGE_CHALLENGE_MISMATCH", message: "권한이 없습니다." } },
      403,
    );
  }

  const previews = await accountMergeUseCases.getMergePreviewPair(challengeId);
  if (!previews) {
    return c.json({ error: "Merge preview unavailable" }, 404);
  }

  const validated = MergePreviewPairSchema.parse({
    userA: previews.userA,
    userB: previews.userB,
  });
  return c.json(validated, 200);
});

// POST /api/auth/merge/confirm — perform the Primary-Wins merge atomically
authRouter.post("/merge/confirm", async (c) => {
  const auth = await requireAuth(c);
  if (!auth) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Unauthenticated" } }, 401);
  }
  if (!c.env?.DB) {
    return c.json({ error: "Database unavailable" }, 500);
  }

  const body = (await c.req
    .json<{ challengeId?: string; keepUserId?: number }>()
    .catch(() => ({}))) as { challengeId?: string; keepUserId?: number };
  const parsed = ConfirmAccountMergeRequestSchema.safeParse({
    challengeId: body.challengeId,
    keepUserId: body.keepUserId,
  });
  if (!parsed.success) {
    return c.json({ error: "challengeId and keepUserId are required" }, 400);
  }

  const { accountMergeUseCases } = createContainer(c.env.DB);
  const result = await accountMergeUseCases.confirmMerge(
    parsed.data.challengeId,
    parsed.data.keepUserId,
    auth.userId,
  );

  if (!result.ok) {
    const statusMap: Record<string, 400 | 403 | 404 | 409> = {
      MERGE_CHALLENGE_EXPIRED: 400,
      MERGE_CHALLENGE_CONSUMED: 400,
      MERGE_CHALLENGE_MISMATCH: 403,
      USER_NOT_FOUND: 404,
      MERGE_PROVIDER_CONFLICT: 409,
      MERGE_STREAMER_CONFLICT: 409,
      MERGE_MULTIPLAYER_CONFLICT: 409,
      MERGE_GAME_CREATOR_CONFLICT: 409,
      MERGE_ADMIN_CONFLICT: 409,
    };
    const messageMap: Record<string, string> = {
      MERGE_CHALLENGE_EXPIRED: "계정 통합 세션이 만료되었습니다. 다시 시도해주세요.",
      MERGE_CHALLENGE_CONSUMED: "이미 처리된 계정 통합 세션입니다.",
      MERGE_CHALLENGE_MISMATCH: "통합 대상 계정이 일치하지 않습니다.",
      USER_NOT_FOUND: "통합 대상 계정을 찾을 수 없습니다.",
      MERGE_PROVIDER_CONFLICT: "두 계정 모두 동일 로그인 수단을 사용 중이라 병합할 수 없습니다.",
      MERGE_STREAMER_CONFLICT:
        "두 계정이 같은 플랫폼의 서로 다른 Streamer 채널을 소유하고 있어 안전하게 병합할 수 없습니다. 먼저 Streamer 채널 충돌을 정리해주세요.",
      MERGE_MULTIPLAYER_CONFLICT:
        "진행 중이거나 서로 충돌하는 멀티플레이 기록이 있어 안전하게 병합할 수 없습니다.",
      MERGE_GAME_CREATOR_CONFLICT:
        "두 계정의 게임 심사 슬롯이 충돌합니다. 진행 중인 게임 심사를 먼저 완료하거나 철회해주세요.",
      MERGE_ADMIN_CONFLICT:
        "통합 대상(Secondary) 계정이 관리자 계정이라 안전하게 병합할 수 없습니다. 관리자에게 문의해 먼저 정리해주세요.",
    };
    const code = result.code;
    return accountError(
      c,
      code,
      messageMap[code] ?? "계정 통합에 실패했습니다.",
      statusMap[code] ?? 400,
    );
  }

  const validated = ConfirmAccountMergeResponseSchema.parse({
    merged: true,
    primaryId: result.primaryId,
    secondaryId: result.secondaryId,
  });
  return c.json(validated, 200);
});
