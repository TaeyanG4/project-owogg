import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  AdminGoogleStepUpRequestSchema,
  AdminLoginRequestSchema,
  AdminMeResponseSchema,
  AdminBootstrapRequestSchema,
  AdminBootstrapResponseSchema,
} from "@owogg/contracts";
import {
  ADMIN_AUTH_POLICY,
  resolveAdminSessionTtlMs,
  isAdminGoogleSub,
  evaluateAdminPasswordPolicy,
  AdminAccountUseCaseFailure,
  type AdminAccountRecord,
} from "@owogg/core";
import { createContainer } from "../container.js";
import { isTrustedAdminOrigin } from "../auth/admin.js";
import { resolveAdminEligibility, resolveEffectiveStaffRole } from "../auth/adminEligibility.js";
import { verifyAdminPassword, safeStringEqual, hashAdminPassword } from "../auth/adminPassword.js";
import { verifyGoogleToken } from "../infrastructure/oauth/google.js";
import { isLocalhost, type ApiEnv } from "./auth.js";

export const adminAuthRouter = new Hono<ApiEnv>();

const ADMIN_STEP_UP_COOKIE = "owogg_admin_stepup";
export const ADMIN_SESSION_COOKIE = "owogg_admin_session";
const STEP_UP_MAX_AGE_SECONDS = Math.floor(ADMIN_AUTH_POLICY.STEP_UP_CHALLENGE_TTL_MS / 1000);

export function resolveAdminSessionMaxAgeSeconds(configuredSeconds: string | undefined): number {
  return Math.floor(resolveAdminSessionTtlMs(configuredSeconds) / 1000);
}

adminAuthRouter.use("*", async (c, next) => {
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

interface EligibleAdmin {
  userId: number;
  rawSessionToken: string;
  account: AdminAccountRecord | null;
}

/** Root-eligibility check only (session valid + ADMIN_USER_IDS or an ACTIVE managed account) —
 * used by the step-up/login/bootstrap endpoints themselves, which exist precisely to grant the
 * elevated layer these guard. */
async function requireEligible(c: Context<ApiEnv>): Promise<Response | EligibleAdmin> {
  const rawSessionToken = getCookie(c, "owogg_session");
  if (!rawSessionToken) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
  }
  const container = createContainer(c.env.DB);
  const sessionResult = await container.sessionRepo.findSession(rawSessionToken);
  if (!sessionResult) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, 401);
  }
  const userId = sessionResult.user.id;
  const { eligible, account } = await resolveAdminEligibility(
    userId,
    c.env.ADMIN_USER_IDS,
    container.adminAccountUseCases,
  );
  if (!eligible) {
    return c.json({ error: { code: "FORBIDDEN", message: "관리자 권한이 필요합니다." } }, 403);
  }
  return { userId, rawSessionToken, account };
}

function isResponse(value: Response | EligibleAdmin): value is Response {
  return value instanceof Response;
}

export function setAdminCookie(
  c: Context<ApiEnv>,
  name: string,
  value: string,
  maxAgeSeconds: number,
): void {
  const secure = !isLocalhost(c.req.url);
  setCookie(c, name, value, {
    httpOnly: true,
    secure,
    // SameSite=Strict is not viable here: the web app and API worker are on different
    // subdomains (cross-site), and Strict would stop the browser from ever sending this cookie
    // on the credentialed cross-origin requests the admin UI makes. None (with Secure) is the
    // closest compatible equivalent in production; Lax is used for local http development.
    sameSite: secure ? "None" : "Lax",
    maxAge: maxAgeSeconds,
    path: "/",
  });
}

// GET /api/admin/me — safe state only; never returns ADMIN_USER_IDS/ADMIN_GOOGLE_SUBS/
// ADMIN_LOGIN_USERNAME/password hash/internal challenge hashes.
adminAuthRouter.get("/me", async (c) => {
  const rawSessionToken = getCookie(c, "owogg_session");
  const notAuthenticated = () =>
    c.json(
      AdminMeResponseSchema.parse({
        authenticated: false,
        eligible: false,
        adminAuthenticated: false,
        stepUpRequired: false,
        bootstrapAvailable: false,
        mustChangePassword: false,
        role: null,
      }),
    );

  if (!rawSessionToken) return notAuthenticated();

  const container = createContainer(c.env.DB);
  const sessionResult = await container.sessionRepo.findSession(rawSessionToken);
  if (!sessionResult) return notAuthenticated();

  const eligibility = await resolveAdminEligibility(
    sessionResult.user.id,
    c.env.ADMIN_USER_IDS,
    container.adminAccountUseCases,
  );
  const { eligible, account } = eligibility;

  let adminAuthenticated = false;
  if (eligible) {
    const adminSession = await container.adminAuthUseCases.validateAdminSession({
      rawToken: getCookie(c, ADMIN_SESSION_COOKIE),
      rawSessionToken,
    });
    adminAuthenticated = Boolean(adminSession);
  }

  const bootstrapAvailable =
    eligible &&
    !adminAuthenticated &&
    !(await container.adminAccountUseCases.hasAnyActiveAccount());

  return c.json(
    AdminMeResponseSchema.parse({
      authenticated: true,
      eligible,
      adminAuthenticated,
      stepUpRequired: eligible && !adminAuthenticated,
      bootstrapAvailable,
      mustChangePassword: adminAuthenticated ? Boolean(account?.mustChangePassword) : false,
      role: adminAuthenticated ? resolveEffectiveStaffRole(eligibility) : null,
    }),
  );
});

// POST /api/admin/auth/google — fresh Google step-up. Never treats "Google already linked" (a
// normal login) as fresh proof; requires a brand-new ID token from this exact request.
adminAuthRouter.post("/auth/google", async (c) => {
  const eligible = await requireEligible(c);
  if (isResponse(eligible)) return eligible;

  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = AdminGoogleStepUpRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "요청 본문이 올바르지 않습니다." } },
      400,
    );
  }

  const verified = await verifyGoogleToken(parsed.data.credential, c.env.GOOGLE_CLIENT_ID);
  const deny = () =>
    c.json({ error: { code: "STEP_UP_FAILED", message: "Google 본인 확인에 실패했습니다." } }, 403);

  if (!verified.valid || !verified.profile) return deny();

  const { sub, iat } = verified.profile;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (iat <= 0 || nowSeconds - iat > ADMIN_AUTH_POLICY.GOOGLE_TOKEN_MAX_AGE_SECONDS) {
    return deny(); // stale/cached token — must be a fresh sign-in right now
  }

  // ADMIN_GOOGLE_SUBS is an OPTIONAL extra restriction (break-glass allowlist). When unset, the
  // primary binding below (this exact sub must already be linked to the current OwOGG account
  // via OwOGG's own OAuth linking) is the sole authority — an unset optional allowlist must
  // never make an otherwise-valid, DB-managed administrator permanently unable to log in.
  if (c.env.ADMIN_GOOGLE_SUBS && !isAdminGoogleSub(sub, c.env.ADMIN_GOOGLE_SUBS)) return deny();

  // The Google sub must be linked (via OwOGG's own OAuth linking) to THIS OwOGG account —
  // never authorized by email/display-name match.
  const { userRepo, adminAuthUseCases } = createContainer(c.env.DB);
  const linkedAccount = await userRepo.findOAuthAccount("google", sub);
  if (!linkedAccount || linkedAccount.user_id !== eligible.userId) return deny();

  const { rawToken } = await adminAuthUseCases.beginStepUp({
    userId: eligible.userId,
    googleSub: sub,
    rawSessionToken: eligible.rawSessionToken,
  });

  setAdminCookie(c, ADMIN_STEP_UP_COOKIE, rawToken, STEP_UP_MAX_AGE_SECONDS);
  return c.json({ stepUpVerified: true });
});

// POST /api/admin/bootstrap — one-time first-administrator setup. Only reachable while zero
// administrator accounts exist anywhere, and only after root eligibility + a fresh, still-valid
// Google step-up for this exact session (consumed exactly like /auth/login does).
adminAuthRouter.post("/bootstrap", async (c) => {
  const eligible = await requireEligible(c);
  if (isResponse(eligible)) return eligible;

  const { adminAccountUseCases, adminAuthUseCases } = createContainer(c.env.DB);

  if (await adminAccountUseCases.hasAnyActiveAccount()) {
    return c.json(
      { error: { code: "ALREADY_BOOTSTRAPPED", message: "이미 관리자 계정이 존재합니다." } },
      409,
    );
  }

  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = AdminBootstrapRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "요청 본문이 올바르지 않습니다." } },
      400,
    );
  }

  const stepUp = await adminAuthUseCases.consumeStepUp({
    rawToken: getCookie(c, ADMIN_STEP_UP_COOKIE),
    rawSessionToken: eligible.rawSessionToken,
    expectedUserId: eligible.userId,
  });
  if (!stepUp) {
    return c.json(
      { error: { code: "STEP_UP_REQUIRED", message: "Google 본인 확인을 먼저 완료해주세요." } },
      403,
    );
  }

  const policy = evaluateAdminPasswordPolicy({
    newPassword: parsed.data.password,
    username: parsed.data.username,
    matchesCurrentPassword: false,
  });
  if (!policy.ok) {
    return c.json(
      { error: { code: "WEAK_PASSWORD", message: "비밀번호가 정책을 만족하지 않습니다." } },
      400,
    );
  }

  const passwordHash = await hashAdminPassword(parsed.data.password);

  let account: AdminAccountRecord;
  try {
    account = await adminAccountUseCases.bootstrapFirstAdmin({
      userId: eligible.userId,
      googleSub: stepUp.googleSub,
      username: parsed.data.username,
      passwordHash,
    });
  } catch (err) {
    if (err instanceof AdminAccountUseCaseFailure && err.code === "ALREADY_BOOTSTRAPPED") {
      return c.json(
        { error: { code: "ALREADY_BOOTSTRAPPED", message: "이미 관리자 계정이 존재합니다." } },
        409,
      );
    }
    if (err instanceof AdminAccountUseCaseFailure) {
      return c.json(
        { error: { code: err.code, message: "관리자 계정을 생성할 수 없습니다." } },
        409,
      );
    }
    throw err;
  }

  const maxAgeSeconds = resolveAdminSessionMaxAgeSeconds(c.env.ADMIN_SESSION_TTL_SECONDS);
  const { rawToken } = await adminAuthUseCases.issueAdminSession({
    userId: eligible.userId,
    rawSessionToken: eligible.rawSessionToken,
    ttlMs: maxAgeSeconds * 1000,
  });
  setAdminCookie(c, ADMIN_SESSION_COOKIE, rawToken, maxAgeSeconds);
  deleteCookie(c, ADMIN_STEP_UP_COOKIE, { path: "/" });

  return c.json(
    AdminBootstrapResponseSchema.parse({
      adminAuthenticated: true,
      mustChangePassword: account.mustChangePassword,
    }),
  );
});

// POST /api/admin/auth/login — second factor (admin username/password), only after a valid,
// unconsumed step-up challenge for this exact session. Checks the managed D1 admin_accounts
// table first; falls back to the legacy env-based credential pair ONLY while no managed account
// exists anywhere (pre-bootstrap / migration bridge) — see docs/ADMIN_GUIDE.md.
adminAuthRouter.post("/auth/login", async (c) => {
  const eligible = await requireEligible(c);
  if (isResponse(eligible)) return eligible;

  const { adminAuthUseCases, adminAccountUseCases } = createContainer(c.env.DB);

  const rateLimit = await adminAuthUseCases.checkRateLimit(eligible.userId);
  if (rateLimit.locked) {
    c.header("Retry-After", String(rateLimit.retryAfterSeconds));
    return c.json({ error: { code: "RATE_LIMITED", message: "잠시 후 다시 시도해주세요." } }, 429);
  }

  const rawBody = await c.req.json().catch(() => ({}));
  const parsed = AdminLoginRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { error: { code: "INVALID_REQUEST", message: "요청 본문이 올바르지 않습니다." } },
      400,
    );
  }

  const stepUp = await adminAuthUseCases.consumeStepUp({
    rawToken: getCookie(c, ADMIN_STEP_UP_COOKIE),
    rawSessionToken: eligible.rawSessionToken,
    expectedUserId: eligible.userId,
  });
  if (!stepUp) {
    return c.json(
      { error: { code: "STEP_UP_REQUIRED", message: "Google 본인 확인을 먼저 완료해주세요." } },
      403,
    );
  }

  let credentialsOk = false;
  let mustChangePassword = false;

  if (eligible.account) {
    // This OwOGG user already has a managed admin account — it alone governs; never falls
    // back to legacy env credentials once a managed account exists for this user.
    const usernameOk = safeStringEqual(parsed.data.username, eligible.account.username);
    const passwordOk = await verifyAdminPassword(
      parsed.data.password,
      eligible.account.passwordHash,
    );
    if (usernameOk && passwordOk && eligible.account.status === "ACTIVE") {
      credentialsOk = true;
      mustChangePassword = eligible.account.mustChangePassword;
    }
  } else if (!(await adminAccountUseCases.hasAnyActiveAccount())) {
    // Legacy migration bridge — only while no managed account exists anywhere (deprecated, see
    // docs/ADMIN_GUIDE.md).
    const usernameOk = safeStringEqual(parsed.data.username, c.env.ADMIN_LOGIN_USERNAME ?? "");
    const passwordOk = await verifyAdminPassword(parsed.data.password, c.env.ADMIN_PASSWORD_PBKDF2);
    credentialsOk =
      Boolean(c.env.ADMIN_LOGIN_USERNAME) &&
      Boolean(c.env.ADMIN_PASSWORD_PBKDF2) &&
      usernameOk &&
      passwordOk;
  }

  if (!credentialsOk) {
    await adminAuthUseCases.recordAttempt(eligible.userId, false);
    // Generic message — never reveals whether username or password was the wrong factor.
    return c.json(
      { error: { code: "INVALID_CREDENTIALS", message: "자격 증명이 올바르지 않습니다." } },
      401,
    );
  }

  await adminAuthUseCases.recordAttempt(eligible.userId, true);
  const maxAgeSeconds = resolveAdminSessionMaxAgeSeconds(c.env.ADMIN_SESSION_TTL_SECONDS);
  const { rawToken } = await adminAuthUseCases.issueAdminSession({
    userId: eligible.userId,
    rawSessionToken: eligible.rawSessionToken,
    ttlMs: maxAgeSeconds * 1000,
  });

  setAdminCookie(c, ADMIN_SESSION_COOKIE, rawToken, maxAgeSeconds);
  deleteCookie(c, ADMIN_STEP_UP_COOKIE, { path: "/" });

  return c.json({ adminAuthenticated: true, mustChangePassword });
});

// POST /api/admin/auth/logout
adminAuthRouter.post("/auth/logout", async (c) => {
  const rawAdminSessionToken = getCookie(c, ADMIN_SESSION_COOKIE);
  if (rawAdminSessionToken) {
    const { adminAuthUseCases } = createContainer(c.env.DB);
    await adminAuthUseCases.logout(rawAdminSessionToken);
  }
  deleteCookie(c, ADMIN_SESSION_COOKIE, { path: "/" });
  return c.json({ success: true });
});
