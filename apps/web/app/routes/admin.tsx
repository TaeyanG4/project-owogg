import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock3,
  CloudCog,
  Database,
  ExternalLink,
  Github,
  HardDrive,
  KeyRound,
  Loader2,
  LogOut,
  MessageCircleMore,
  Server,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  fetchAdminMe,
  fetchAdminOverview,
  postAdminGoogleStepUp,
  postAdminLogin,
  postAdminLogout,
  postAdminBootstrap,
  postAdminPasswordChange,
} from "../features/adminApi";
import { fetchMyAccess } from "../features/myAccess";
import type { AdminMeResponse, AdminOverviewResponse, PermissionValue } from "@owogg/contracts";
import { ApiClientError } from "../lib/api/errors";
import { useAuth } from "../features/auth";
import { getVisibleAdminNavigation } from "../components/admin/adminNavigation";
import {
  ADMIN_RESOURCE_LINKS,
  resolveAdminDataTargets,
  type AdminResourceLink,
} from "../features/adminResourceLinks";

export function meta() {
  return [
    { title: "관리자 센터 | OwOGG" },
    { name: "description", content: "OwOGG 관리자 전용 운영 센터" },
    { name: "robots", content: "noindex,nofollow" },
  ];
}

type Stage =
  | "loading"
  | "need-owogg-login"
  | "not-eligible"
  | "step-up"
  | "must-change-password"
  | "unavailable"
  | "dashboard";

export default function AdminRoute() {
  const { isAuthenticated, isLoading: authLoading, providerStatus, openLoginModal } = useAuth();
  const [me, setMe] = useState<AdminMeResponse | null>(null);
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [permissions, setPermissions] = useState<PermissionValue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  // Local, client-only progress within the two-step elevation flow — the server has no
  // concept of "Google done, password pending" outside the short-lived step-up cookie.
  const [googleStepDone, setGoogleStepDone] = useState(false);

  const refreshMe = useCallback(async () => {
    setLoadingMe(true);
    try {
      const next = await fetchAdminMe();
      setMe(next);
      setError(null);
      if (next.adminAuthenticated && !next.mustChangePassword) {
        const myAccess = await fetchMyAccess();
        setPermissions(myAccess.permissions);
        // The overview endpoint is intentionally system.monitor-gated. A valid OPERATOR or
        // MODERATOR without that permission must still reach their own tools instead of the
        // whole dashboard failing because one optional summary request returned 403.
        if (next.role === "ADMIN" || myAccess.permissions.includes("system.monitor")) {
          try {
            setOverview(await fetchAdminOverview());
          } catch {
            setOverview(null);
          }
        } else {
          setOverview(null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "관리자 상태를 확인할 수 없습니다.");
    } finally {
      setLoadingMe(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    void refreshMe();
  }, [authLoading, refreshMe]);

  let stage: Stage = "loading";
  if (!authLoading && !loadingMe) {
    if (!me) stage = "unavailable";
    else if (!isAuthenticated || !me.authenticated) stage = "need-owogg-login";
    else if (!me.eligible) stage = "not-eligible";
    else if (!me.adminAuthenticated) stage = "step-up";
    else if (me.mustChangePassword) stage = "must-change-password";
    else stage = "dashboard";
  }

  if (stage === "loading") return <PageMessage>관리자 권한을 확인하는 중...</PageMessage>;

  if (stage === "unavailable") {
    return (
      <PageMessage>
        <ShieldAlert className="mx-auto mb-4 h-10 w-10 text-accent-yellow" />
        <h1 className="text-lg font-black text-text-primary">관리자 상태를 확인할 수 없습니다</h1>
        <p className="mt-2 text-sm text-text-muted">{error || "잠시 후 다시 시도해주세요."}</p>
        <button
          type="button"
          onClick={() => void refreshMe()}
          className="mt-6 inline-flex items-center rounded-xl bg-brand px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-light focus:outline-none focus:ring-2 focus:ring-brand cursor-pointer"
        >
          다시 시도
        </button>
      </PageMessage>
    );
  }

  if (stage === "need-owogg-login") {
    return (
      <PageMessage>
        <ShieldCheck className="mx-auto mb-4 h-10 w-10 text-text-muted" />
        <h1 className="text-lg font-black text-text-primary">OwOGG 로그인이 필요합니다</h1>
        <p className="mt-2 text-sm text-text-muted">
          관리자 센터는 OwOGG 로그인 이후 추가 본인 확인을 거쳐 접근할 수 있습니다.
        </p>
        <button
          onClick={openLoginModal}
          className="mt-6 inline-flex items-center rounded-xl bg-brand px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-light focus:outline-none focus:ring-2 focus:ring-brand cursor-pointer"
        >
          OwOGG 로그인
        </button>
      </PageMessage>
    );
  }

  if (stage === "not-eligible") {
    return (
      <PageMessage>
        <ShieldCheck className="mx-auto mb-4 h-10 w-10 text-text-muted" />
        <h1 className="text-lg font-black text-text-primary">관리자 전용 페이지</h1>
        <p className="mt-2 text-sm text-text-muted">
          {error || "현재 계정에는 관리자 센터 접근 권한이 없습니다."}
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center rounded-xl bg-brand px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-light focus:outline-none focus:ring-2 focus:ring-brand"
        >
          홈으로 돌아가기
        </Link>
      </PageMessage>
    );
  }

  if (stage === "step-up") {
    return (
      <StepUpFlow
        googleClientId={providerStatus.google.clientId}
        googleConfigured={providerStatus.google.configured}
        googleStepDone={googleStepDone}
        bootstrapAvailable={Boolean(me?.bootstrapAvailable)}
        onGoogleStepDone={() => setGoogleStepDone(true)}
        onLoggedIn={() => void refreshMe()}
      />
    );
  }

  if (stage === "must-change-password") {
    return <ForcedPasswordChange onChanged={() => void refreshMe()} />;
  }

  return (
    <AdminDashboard
      overview={overview}
      role={me?.role ?? null}
      permissions={permissions}
      onLoggedOut={() => void refreshMe()}
    />
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Google 계정으로 관리자 본인 확인 / Step 2 — 관리자 로그인 또는 초기 설정
// ---------------------------------------------------------------------------

function StepUpFlow({
  googleClientId,
  googleConfigured,
  googleStepDone,
  bootstrapAvailable,
  onGoogleStepDone,
  onLoggedIn,
}: {
  googleClientId?: string | undefined;
  googleConfigured: boolean;
  googleStepDone: boolean;
  bootstrapAvailable: boolean;
  onGoogleStepDone: () => void;
  onLoggedIn: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div className="text-center">
        <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-accent-yellow" />
        <h1 className="text-xl font-black text-text-primary">관리자 본인 확인</h1>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          관리자 센터는 두 단계 확인을 모두 통과해야 열립니다.
        </p>
      </div>

      <ol className="flex items-center justify-center gap-2 text-[11px] font-bold text-text-muted">
        <StepBadge
          index={1}
          label="Google 본인 확인"
          active={!googleStepDone}
          done={googleStepDone}
        />
        <span className="text-text-muted">→</span>
        <StepBadge
          index={2}
          label={bootstrapAvailable ? "초기 관리자 설정" : "관리자 로그인"}
          active={googleStepDone}
          done={false}
        />
      </ol>

      {!googleStepDone ? (
        <GoogleStepUpPanel
          googleClientId={googleClientId}
          googleConfigured={googleConfigured}
          onGoogleStepDone={onGoogleStepDone}
        />
      ) : bootstrapAvailable ? (
        <BootstrapForm onLoggedIn={onLoggedIn} />
      ) : (
        <AdminLoginForm onLoggedIn={onLoggedIn} />
      )}
    </div>
  );
}

/**
 * Renders a real, visible Google Identity Services button (`google.accounts.id.renderButton`)
 * into an actual DOM container — the administrator must physically click it. This intentionally
 * does NOT use One Tap + a hidden off-screen button + a synthetic click: that pattern isn't
 * guaranteed to represent a fresh, explicit user action and isn't a supported UI surface.
 */
function GoogleStepUpPanel({
  googleClientId,
  googleConfigured,
  onGoogleStepDone,
}: {
  googleClientId?: string | undefined;
  googleConfigured: boolean;
  onGoogleStepDone: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  useEffect(() => {
    if (!googleClientId || !googleConfigured) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tryInit = (attemptsLeft: number) => {
      if (cancelled) return;
      if (!window.google?.accounts?.id) {
        if (attemptsLeft <= 0) return;
        timer = setTimeout(() => tryInit(attemptsLeft - 1), 150);
        return;
      }
      setScriptReady(true);
      if (initializedRef.current || !containerRef.current) return;
      initializedRef.current = true;

      const googleAuth = window.google.accounts.id;
      googleAuth.initialize({
        client_id: googleClientId,
        callback: async (response: { credential: string }) => {
          setVerifying(true);
          setGoogleError(null);
          try {
            await postAdminGoogleStepUp(response.credential);
            onGoogleStepDone();
          } catch {
            setGoogleError(
              "Google 본인 확인에 실패했습니다. 허용된 Google 계정이 현재 OwOGG 계정에 연결되어 있는지 확인해주세요.",
            );
          } finally {
            setVerifying(false);
          }
        },
        // Always a fresh, explicit user action — never auto-selects a previously chosen account.
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      googleAuth.renderButton(containerRef.current, {
        type: "standard",
        theme: "filled_black",
        size: "large",
        text: "signin_with",
        shape: "pill",
      });
    };

    tryInit(60); // ~9s of polling for the async GIS script tag in root.tsx to finish loading
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [googleClientId, googleConfigured, onGoogleStepDone]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface-raised p-5">
      <p className="text-center text-xs text-text-muted">
        평소 로그인 세션과는 별개로, 지금 이 자리에서 Google 계정으로 새로 본인 확인을 진행합니다.
      </p>

      {!googleClientId || !googleConfigured ? (
        <p className="flex items-center gap-2 text-xs font-semibold text-accent-red">
          <ShieldAlert className="h-4 w-4" /> Google 설정 누락 — 관리자에게 문의해주세요.
        </p>
      ) : (
        // The container is always mounted (never conditionally rendered behind `scriptReady`)
        // so `containerRef.current` is already non-null by the time the effect above runs its
        // very first check. Gating this div's presence on `scriptReady` instead — as an earlier
        // version of this component did — created a race: when the async GIS script (loaded by
        // root.tsx on every page) has already finished loading before this component mounts,
        // `tryInit` calls `setScriptReady(true)` and, in that same synchronous tick, immediately
        // checks `containerRef.current` — which was still null because React hadn't yet
        // committed the render that would have mounted this div. `renderButton` was silently
        // skipped and never retried, leaving a permanently empty box with no error and no
        // loading text (exactly what an admin visiting a second time — GIS already warm from an
        // earlier page — would see).
        <div className="relative flex min-h-[44px] items-center justify-center">
          <div ref={containerRef} className={scriptReady ? undefined : "invisible"} />
          {!scriptReady && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs font-semibold text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Google 스크립트 로딩 중...
            </div>
          )}
          {verifying && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-full bg-surface-raised/90 text-xs font-bold text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> 확인 중...
            </div>
          )}
        </div>
      )}
      {googleError && (
        <p className="text-center text-xs font-semibold text-accent-red">{googleError}</p>
      )}
    </div>
  );
}

function AdminLoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginLoading) return;
    setLoginError(null);
    setLoginLoading(true);
    try {
      await postAdminLogin(username, password);
      onLoggedIn();
    } catch (err) {
      setLoginError(
        err instanceof ApiClientError
          ? err.detail || "로그인에 실패했습니다."
          : "로그인에 실패했습니다.",
      );
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleLogin}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-raised p-5"
    >
      <label className="flex flex-col gap-1.5 text-xs font-bold text-text-primary">
        관리자 아이디
        <input
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-brand"
          required
        />
      </label>
      <label className="flex flex-col gap-1.5 text-xs font-bold text-text-primary">
        관리자 비밀번호
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-brand"
          required
        />
      </label>
      <button
        type="submit"
        disabled={loginLoading}
        className="mt-1 rounded-xl bg-brand py-3 text-xs font-bold text-white hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
      >
        {loginLoading ? "로그인 중..." : "관리자 로그인"}
      </button>
      {loginError && <p className="text-xs font-semibold text-accent-red">{loginError}</p>}
    </form>
  );
}

/** One-time first-administrator setup — only ever shown while no administrator account exists
 * anywhere, after root eligibility + a fresh Google step-up for this exact OwOGG account. */
function BootstrapForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setFormError(null);
    if (password !== passwordConfirm) {
      setFormError("비밀번호가 일치하지 않습니다.");
      return;
    }
    setLoading(true);
    try {
      await postAdminBootstrap({ username, password, passwordConfirm });
      onLoggedIn();
    } catch (err) {
      setFormError(
        err instanceof ApiClientError
          ? err.detail || "초기 설정에 실패했습니다."
          : "초기 설정에 실패했습니다.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-2xl border border-accent-yellow/40 bg-surface-raised p-5"
    >
      <p className="text-xs leading-relaxed text-text-muted">
        아직 관리자 계정이 없습니다. 최초 ADMIN 계정의 아이디/비밀번호를 설정해주세요. 이후
        로그인마다 비밀번호 변경이 강제됩니다.
      </p>
      <label className="flex flex-col gap-1.5 text-xs font-bold text-text-primary">
        관리자 아이디
        <input
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          minLength={3}
          maxLength={64}
          className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-brand"
          required
        />
      </label>
      <label className="flex flex-col gap-1.5 text-xs font-bold text-text-primary">
        비밀번호 (12자 이상)
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={12}
          className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-brand"
          required
        />
      </label>
      <label className="flex flex-col gap-1.5 text-xs font-bold text-text-primary">
        비밀번호 확인
        <input
          type="password"
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          minLength={12}
          className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-brand"
          required
        />
      </label>
      <button
        type="submit"
        disabled={loading}
        className="mt-1 rounded-xl bg-accent-yellow py-3 text-xs font-bold text-black hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
      >
        {loading ? "생성 중..." : "초기 관리자 계정 생성"}
      </button>
      {formError && <p className="text-xs font-semibold text-accent-red">{formError}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Forced password change gate (must_change_password)
// ---------------------------------------------------------------------------

function ForcedPasswordChange({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div className="text-center">
        <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-accent-yellow" />
        <h1 className="text-xl font-black text-text-primary">관리자 비밀번호를 변경해주세요</h1>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          임시 비밀번호로 로그인했습니다. 비밀번호를 변경해야 관리자 기능을 사용할 수 있습니다.
        </p>
      </div>
      <PasswordChangeForm onChanged={onChanged} />
      <LogoutLink />
    </div>
  );
}

export function PasswordChangeForm({ onChanged }: { onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setFormError(null);
    if (newPassword !== newPasswordConfirm) {
      setFormError("새 비밀번호가 일치하지 않습니다.");
      return;
    }
    setLoading(true);
    try {
      await postAdminPasswordChange({ currentPassword, newPassword, newPasswordConfirm });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      onChanged();
    } catch (err) {
      setFormError(
        err instanceof ApiClientError
          ? err.detail || "비밀번호 변경에 실패했습니다."
          : "비밀번호 변경에 실패했습니다.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-raised p-5"
    >
      <label className="flex flex-col gap-1.5 text-xs font-bold text-text-primary">
        현재 비밀번호
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-brand"
          required
        />
      </label>
      <label className="flex flex-col gap-1.5 text-xs font-bold text-text-primary">
        새 비밀번호 (12자 이상)
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          minLength={12}
          className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-brand"
          required
        />
      </label>
      <label className="flex flex-col gap-1.5 text-xs font-bold text-text-primary">
        새 비밀번호 확인
        <input
          type="password"
          autoComplete="new-password"
          value={newPasswordConfirm}
          onChange={(e) => setNewPasswordConfirm(e.target.value)}
          minLength={12}
          className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-brand"
          required
        />
      </label>
      <button
        type="submit"
        disabled={loading}
        className="mt-1 rounded-xl bg-brand py-3 text-xs font-bold text-white hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
      >
        {loading ? "변경 중..." : "비밀번호 변경"}
      </button>
      {formError && <p className="text-xs font-semibold text-accent-red">{formError}</p>}
      {success && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-accent-green">
          <CheckCircle2 className="h-3.5 w-3.5" /> 비밀번호가 변경되었습니다.
        </p>
      )}
    </form>
  );
}

function LogoutLink() {
  const [loggingOut, setLoggingOut] = useState(false);
  return (
    <button
      onClick={async () => {
        setLoggingOut(true);
        try {
          await postAdminLogout();
        } finally {
          window.location.reload();
        }
      }}
      disabled={loggingOut}
      className="mx-auto inline-flex items-center gap-1.5 text-xs font-bold text-text-muted hover:text-text-primary disabled:opacity-50 cursor-pointer"
    >
      <LogOut className="h-3.5 w-3.5" /> 관리자 로그아웃
    </button>
  );
}

function StepBadge({
  index,
  label,
  active,
  done,
}: {
  index: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 ${
        done
          ? "border-accent-green/30 bg-accent-green/10 text-accent-green"
          : active
            ? "border-brand/40 bg-brand/10 text-brand-light"
            : "border-border bg-surface text-text-muted"
      }`}
    >
      {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span>{index}</span>}
      {label}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Dashboard (post-elevation)
// ---------------------------------------------------------------------------

function AdminDashboard({
  overview,
  role,
  permissions,
  onLoggedOut,
}: {
  overview: AdminOverviewResponse | null;
  role: "ADMIN" | "OPERATOR" | "MODERATOR" | "SYSTEM_DEVELOPER" | null;
  permissions: PermissionValue[];
  onLoggedOut: () => void;
}) {
  const [loggingOut, setLoggingOut] = useState(false);
  // ADMIN implicitly has every permission (see hasPermission's "ADMIN implies all" rule in
  // packages/core/src/domain/staffRoles.ts) — mirrored here so this nav doesn't need its own copy
  // of the full PERMISSIONS catalog just to special-case the top role.
  const can = (permission: PermissionValue) => role === "ADMIN" || permissions.includes(permission);
  const quickItems = getVisibleAdminNavigation({ elevated: true, role, permissions })
    .filter((group) => group.id === "operations" || group.id === "people" || group.id === "system")
    .flatMap((group) => group.items)
    .filter((item) => item.id !== "security");
  const dataTargets = resolveAdminDataTargets(
    typeof window === "undefined" ? "" : window.location.hostname,
  );

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await postAdminLogout();
    } finally {
      setLoggingOut(false);
      onLoggedOut();
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-7 px-4 py-8 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 text-accent-yellow">
            <ShieldCheck className="h-5 w-5" />
            <span className="text-[11px] font-black uppercase tracking-[0.2em]">OwOGG Admin</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-text-primary">관리자 센터</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-muted">
            운영에 필요한 안전한 상태 요약과 스트리머 심사 도구를 한곳에서 확인합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent-green/30 bg-accent-green/10 px-3 py-2 text-xs font-bold text-accent-green">
            <CheckCircle2 className="h-4 w-4" /> 관리자 인증됨
          </span>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-2 text-xs font-bold text-text-muted hover:text-text-primary disabled:opacity-50 cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" /> 관리자 로그아웃
          </button>
        </div>
      </header>

      {quickItems.length > 0 && (
        <section aria-labelledby="admin-quick-actions">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 id="admin-quick-actions" className="text-sm font-black text-text-primary">
                내 작업 바로가기
              </h2>
              <p className="mt-1 text-xs text-text-muted">
                현재 권한으로 사용할 수 있는 기능입니다.
              </p>
            </div>
            <span className="text-[10px] font-bold text-text-muted">
              {quickItems.length}개 기능
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {quickItems.map((item) => (
              <Link
                key={item.id}
                to={item.path}
                className="group flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface-raised p-4 transition-colors hover:border-brand/60 hover:bg-brand/5 focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-black text-text-primary">{item.label}</span>
                  <span className="mt-1 block text-xs text-text-muted">{item.description}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand-light" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {can("system.monitor") && (
        <section aria-labelledby="admin-resource-links">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="admin-resource-links" className="text-sm font-black text-text-primary">
                운영 리소스 바로가기
              </h2>
              <p className="mt-1 text-xs text-text-muted">
                데이터 검색과 외부 서비스 운영 콘솔을 새 창에서 엽니다.
              </p>
            </div>
            <span
              className={`rounded-full border px-3 py-1.5 text-[10px] font-black ${
                dataTargets.environment === "production"
                  ? "border-accent-red/30 bg-accent-red/10 text-accent-red"
                  : dataTargets.environment === "staging"
                    ? "border-accent-yellow/30 bg-accent-yellow/10 text-accent-yellow"
                    : "border-border bg-surface text-text-muted"
              }`}
            >
              현재 환경 · {dataTargets.environmentLabel}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ADMIN_RESOURCE_LINKS.map((item) => (
              <AdminResourceCard
                key={item.id}
                item={item}
                targetName={
                  item.id === "d1"
                    ? dataTargets.d1Database
                    : item.id === "b2"
                      ? dataTargets.b2Bucket
                      : null
                }
              />
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
            D1과 B2에서는 위 환경 이름과 일치하는 대상을 선택하세요. 외부 콘솔의 계정 권한이 최종
            접근을 통제하며, 관리자 센터는 계정 ID·접근 키·비밀값을 전달하거나 노출하지 않습니다.
            직접 수정·삭제하면 앱의 감사 기록과 D1/B2 일관성을 우회할 수 있으므로 콘솔은 조회·검색에
            사용하고 운영 변경은 관리자 기능에서 처리하세요.
          </p>
        </section>
      )}

      {overview ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="핵심 운영 상태">
            <MetricCard
              icon={<Clock3 className="h-4 w-4" />}
              label="대기 중 스트리머 심사"
              value={overview.pendingStreamerReviews.toLocaleString()}
              tone="yellow"
            />
            <MetricCard
              icon={<Server className="h-4 w-4" />}
              label="등록된 활성 Discord 서버"
              value={overview.discord.activeGuildCount.toLocaleString()}
              tone="purple"
            />
            <MetricCard
              icon={<Activity className="h-4 w-4" />}
              label="Discord HTTP Interactions"
              value={overview.discord.interactionsConfigured ? "준비됨" : "외부 설정 대기"}
              tone={overview.discord.interactionsConfigured ? "green" : "red"}
            />
            <MetricCard
              icon={<Users className="h-4 w-4" />}
              label="최근 감사 기록"
              value={overview.recentAudits.length.toLocaleString()}
              tone="blue"
            />
          </section>

          <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
            <article className="rounded-2xl border border-border bg-surface-raised p-5 shadow-lg shadow-black/10">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.15em] text-accent-yellow">
                    STREAMER
                  </p>
                  <h2 className="mt-1 text-xl font-black text-text-primary">Featured 수동 심사</h2>
                  <p className="mt-2 text-sm leading-relaxed text-text-muted">
                    공식 소유권과 자격 지표만 확인하고, 모든 결정은 append-only 감사 원장에
                    남깁니다.
                  </p>
                </div>
                <Clock3 className="h-6 w-6 shrink-0 text-accent-yellow" />
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                {can("streamers.review") ? (
                  <Link
                    to="/admin/streamers"
                    className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-xs font-bold text-white hover:bg-brand-light focus:outline-none focus:ring-2 focus:ring-brand"
                  >
                    심사 큐 열기 <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <span className="rounded-full border border-border px-3 py-2 text-[10px] font-bold text-text-muted">
                    읽기 전용 · 심사 권한 없음
                  </span>
                )}
                <span className="text-xs text-text-muted">
                  대기 {overview.pendingStreamerReviews}건
                </span>
              </div>
            </article>

            <article className="rounded-2xl border border-border bg-surface-raised p-5 shadow-lg shadow-black/10">
              <h2 className="text-sm font-black text-text-primary">Streamer Provider 준비 상태</h2>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {Object.entries(overview.streamerProviders).map(([provider, configured]) => (
                  <div
                    key={provider}
                    className="flex items-center justify-between rounded-xl bg-surface px-3 py-2.5"
                  >
                    <span className="text-xs font-bold text-text-primary">{provider}</span>
                    <span
                      className={`text-[10px] font-bold ${configured ? "text-accent-green" : "text-text-muted"}`}
                    >
                      {configured ? "준비됨" : "미설정"}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="rounded-2xl border border-border bg-surface-raised p-5 shadow-lg shadow-black/10">
            <h2 className="text-sm font-black text-text-primary">Discord 통합 상태</h2>
            <p className="mt-1 text-xs text-text-muted">
              안전한 값만 표시합니다. Bot Token/Client Secret/Public Key 원문은 절대 노출하지
              않습니다.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <DiscordStatusRow label="Discord OAuth" ok={overview.discord.oauthConfigured} />
              <DiscordStatusRow
                label="HTTP Interactions"
                ok={overview.discord.interactionsConfigured}
              />
              <DiscordStatusRow
                label="설치 링크(Install URL)"
                ok={overview.discord.installUrlConfigured}
              />
              <DiscordStatusRow
                label="명령어 자동 동기화"
                ok={overview.discord.commandSyncEnabled}
                okLabel="활성화됨"
                offLabel="비활성화(수동 등록 필요)"
              />
              <div className="rounded-xl bg-surface px-3 py-2.5">
                <p className="text-xs font-bold text-text-primary">등록된 활성 서버</p>
                <p className="mt-1 text-xs text-text-muted">
                  {overview.discord.activeGuildCount}개
                </p>
              </div>
              <div className="rounded-xl bg-surface px-3 py-2.5 sm:col-span-2 lg:col-span-1">
                <p className="text-xs font-bold text-text-primary">Interactions Endpoint</p>
                <p className="mt-1 truncate text-[10px] font-mono text-text-muted">
                  {overview.discord.expectedInteractionsEndpoint}
                </p>
              </div>
            </div>
            <div className="mt-3 rounded-xl bg-surface px-3 py-2.5">
              <p className="text-xs font-bold text-text-primary">
                로컬 /owogg 서브커맨드 ({overview.discord.localSubcommands.length}개)
              </p>
              <p className="mt-1 text-[11px] text-text-muted">
                {overview.discord.localSubcommands.map((s) => `/owogg ${s}`).join(" · ")}
              </p>
            </div>
            <p className="mt-3 text-[11px] text-text-muted">
              실제 Discord에 등록된 명령어와의 드리프트(불일치) 여부는 Bot Token이 필요한 운영 CI
              검증 대상입니다 (<code className="font-mono">pnpm discord:commands:check</code>).
            </p>
          </section>

          <section className="rounded-2xl border border-border bg-surface-raised p-5 shadow-lg shadow-black/10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black text-text-primary">최근 심사·감사 내역</h2>
                <p className="mt-1 text-xs text-text-muted">운영 결정의 요약만 표시합니다.</p>
              </div>
              {can("streamers.review") && (
                <Link
                  to="/admin/streamers"
                  className="text-xs font-bold text-brand-light hover:underline"
                >
                  전체 심사 도구 <ExternalLink className="ml-1 inline h-3.5 w-3.5" />
                </Link>
              )}
            </div>
            {overview.recentAudits.length === 0 ? (
              <p className="mt-5 rounded-xl bg-surface p-4 text-xs text-text-muted">
                아직 감사 기록이 없습니다.
              </p>
            ) : (
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {overview.recentAudits.map((audit, index) => (
                  <div key={`${audit.createdAt}-${index}`} className="rounded-xl bg-surface p-3">
                    <p className="text-[10px] font-bold text-text-muted">
                      {audit.platform ?? "Streamer"}
                    </p>
                    <p className="mt-1 text-xs font-bold text-text-primary">{audit.action}</p>
                    <p className="mt-1 text-[10px] text-text-muted">
                      {audit.createdAt.replace("T", " ").slice(0, 16)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-border bg-surface-raised p-6">
          <div className="flex items-start gap-3">
            <Activity className="mt-0.5 h-5 w-5 shrink-0 text-brand-light" />
            <div>
              <h2 className="text-sm font-black text-text-primary">
                운영 요약 없이 계속할 수 있습니다
              </h2>
              <p className="mt-2 max-w-2xl text-xs leading-relaxed text-text-muted">
                {can("system.monitor")
                  ? "운영 요약을 현재 불러오지 못했습니다. 위 바로가기와 관리자 메뉴의 허용된 기능은 계속 사용할 수 있습니다."
                  : "현재 역할에는 시스템 모니터링 권한이 없습니다. 위 바로가기와 관리자 메뉴에는 사용할 수 있는 기능만 표시됩니다."}
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

const ADMIN_RESOURCE_ICONS: Record<AdminResourceLink["id"], React.ReactNode> = {
  d1: <Database className="h-5 w-5" />,
  b2: <HardDrive className="h-5 w-5" />,
  workers: <CloudCog className="h-5 w-5" />,
  actions: <Github className="h-5 w-5" />,
  access: <KeyRound className="h-5 w-5" />,
  discord: <MessageCircleMore className="h-5 w-5" />,
};

function AdminResourceCard({
  item,
  targetName,
}: {
  item: AdminResourceLink;
  targetName: string | null;
}) {
  return (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-h-36 flex-col justify-between rounded-2xl border border-border bg-surface-raised p-4 transition-colors hover:border-brand/60 hover:bg-brand/5 focus:outline-none focus:ring-2 focus:ring-brand"
      aria-label={`${item.label} 새 창에서 열기`}
    >
      <span>
        <span className="flex items-start justify-between gap-3">
          <span className="inline-flex rounded-xl bg-brand/10 p-2.5 text-brand-light">
            {ADMIN_RESOURCE_ICONS[item.id]}
          </span>
          <ExternalLink className="h-4 w-4 shrink-0 text-text-muted transition-colors group-hover:text-brand-light" />
        </span>
        <span className="mt-4 block text-[10px] font-black uppercase tracking-[0.12em] text-text-muted">
          {item.provider}
        </span>
        <span className="mt-1 block text-sm font-black text-text-primary">{item.label}</span>
        <span className="mt-1.5 block text-xs leading-relaxed text-text-muted">
          {item.description}
        </span>
      </span>
      {targetName && (
        <span className="mt-3 block truncate rounded-lg bg-surface px-2.5 py-2 font-mono text-[10px] font-bold text-brand-light">
          대상 · {targetName}
        </span>
      )}
    </a>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "yellow" | "purple" | "green" | "red" | "blue";
}) {
  const colors = {
    yellow: "text-accent-yellow bg-accent-yellow/10",
    purple: "text-accent-purple bg-accent-purple/10",
    green: "text-accent-green bg-accent-green/10",
    red: "text-accent-red bg-accent-red/10",
    blue: "text-brand-light bg-brand/10",
  };
  return (
    <article className="rounded-2xl border border-border bg-surface-raised p-4 shadow-lg shadow-black/10">
      <div className={`mb-4 inline-flex rounded-xl p-2 ${colors[tone]}`}>{icon}</div>
      <p className="text-[11px] font-bold text-text-muted">{label}</p>
      <p className="mt-1 text-xl font-black text-text-primary">{value}</p>
    </article>
  );
}

function DiscordStatusRow({
  label,
  ok,
  okLabel = "설정됨",
  offLabel = "미설정",
}: {
  label: string;
  ok: boolean;
  okLabel?: string;
  offLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-surface px-3 py-2.5">
      <span className="text-xs font-bold text-text-primary">{label}</span>
      <span className={`text-[10px] font-bold ${ok ? "text-accent-green" : "text-text-muted"}`}>
        {ok ? okLabel : offLabel}
      </span>
    </div>
  );
}

function PageMessage({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-xl px-4 py-24 text-center">{children}</div>;
}
