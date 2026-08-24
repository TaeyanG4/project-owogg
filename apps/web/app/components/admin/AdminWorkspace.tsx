import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Gamepad2,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Search,
  ShieldCheck,
  UserCog,
  Users,
  Video,
  X,
} from "lucide-react";
import type { PermissionValue, StaffRoleValue } from "@owogg/contracts";
import { useAuth } from "../../features/auth";
import { ADMIN_SESSION_CHANGED_EVENT, fetchAdminMe } from "../../features/adminApi";
import { fetchMyAccess } from "../../features/myAccess";
import {
  findAdminNavigationItem,
  getVisibleAdminNavigation,
  isAdminNavigationItemActive,
  type AdminNavigationItem,
  type AdminNavigationItemId,
} from "./adminNavigation";

type WorkspaceStage = "loading" | "signed-out" | "step-up" | "ready" | "unavailable";

const ICONS: Record<AdminNavigationItemId, ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  games: Gamepad2,
  "creator-reviews": Video,
  "game-creators": UserCog,
  users: Users,
  monitoring: Activity,
  accounts: KeyRound,
  security: LockKeyhole,
};

const ROLE_LABELS: Record<StaffRoleValue, string> = {
  ADMIN: "관리자",
  OPERATOR: "운영자",
  MODERATOR: "모더레이터",
  SYSTEM_DEVELOPER: "시스템 개발자",
};

interface AdminWorkspaceProps {
  children: ReactNode;
  isMobileOpen: boolean;
  onMobileOpen: () => void;
  onMobileClose: () => void;
}

/** Persistent admin chrome. Server-side route checks remain the authorization authority. */
export function AdminWorkspace({
  children,
  isMobileOpen,
  onMobileOpen,
  onMobileClose,
}: AdminWorkspaceProps) {
  const location = useLocation();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [stage, setStage] = useState<WorkspaceStage>("loading");
  const [role, setRole] = useState<StaffRoleValue | null>(null);
  const [permissions, setPermissions] = useState<PermissionValue[]>([]);
  const [query, setQuery] = useState("");

  const refreshAccess = useCallback(async () => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setStage("signed-out");
      setRole(null);
      setPermissions([]);
      return;
    }

    setStage((current) => (current === "ready" ? current : "loading"));
    try {
      const me = await fetchAdminMe();
      setRole(me.role);
      if (!me.adminAuthenticated || me.mustChangePassword) {
        setPermissions([]);
        setStage("step-up");
        return;
      }
      const access = await fetchMyAccess();
      setRole(access.staffRole ?? me.role);
      setPermissions(access.permissions);
      setStage("ready");
    } catch {
      setRole(null);
      setPermissions([]);
      setStage("unavailable");
    }
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    void refreshAccess();
  }, [refreshAccess]);

  useEffect(() => {
    const refresh = () => void refreshAccess();
    window.addEventListener(ADMIN_SESSION_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(ADMIN_SESSION_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refreshAccess]);

  useEffect(() => {
    onMobileClose();
  }, [location.pathname, onMobileClose]);

  useEffect(() => {
    if (!isMobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMobileClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isMobileOpen, onMobileClose]);

  const access = useMemo(
    () => ({ elevated: stage === "ready", role, permissions }),
    [permissions, role, stage],
  );
  const groups = useMemo(() => getVisibleAdminNavigation(access, query), [access, query]);
  const currentItem = findAdminNavigationItem(location.pathname);
  const sessionLabel = getSessionLabel(stage, role);

  const navigation = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/80 p-3">
        <Link
          to="/"
          onClick={onMobileClose}
          className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-brand"
        >
          <ArrowLeft className="h-4 w-4" /> 서비스로 돌아가기
        </Link>
      </div>

      <div className="border-b border-border/80 px-4 py-4">
        <Link
          to="/admin"
          onClick={onMobileClose}
          className="group flex items-center gap-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand-light ring-1 ring-brand/25">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-black text-text-primary">관리자 워크스페이스</span>
            <span className="block truncate text-[11px] text-text-muted">OwOGG 운영 콘솔</span>
          </span>
        </Link>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              stage === "ready"
                ? "bg-accent-green shadow-[0_0_8px_rgba(34,197,94,0.7)]"
                : stage === "loading"
                  ? "animate-pulse bg-accent-yellow"
                  : "bg-text-muted"
            }`}
          />
          <span className="min-w-0 truncate text-[11px] font-bold text-text-secondary">
            {sessionLabel}
          </span>
        </div>
      </div>

      <div className="px-3 pt-3">
        <label className="relative block">
          <span className="sr-only">관리 기능 찾기</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="관리 기능 찾기"
            className="w-full rounded-xl border border-border bg-surface py-2.5 pl-9 pr-3 text-xs font-medium text-text-primary outline-none placeholder:text-text-muted focus:border-brand focus:ring-2 focus:ring-brand/25"
          />
        </label>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-label="관리자 메뉴">
        {groups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-text-muted">
            일치하는 관리 기능이 없습니다.
          </p>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <section key={group.id} aria-labelledby={`admin-nav-${group.id}`}>
                <h2
                  id={`admin-nav-${group.id}`}
                  className="mb-1.5 px-2 text-[10px] font-black uppercase tracking-[0.16em] text-text-muted"
                >
                  {group.label}
                </h2>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <AdminNavigationLink
                      key={item.id}
                      item={item}
                      pathname={location.pathname}
                      onClick={onMobileClose}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </nav>
    </div>
  );

  return (
    <>
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface-sidebar lg:block xl:w-72">
        <div className="sticky top-16 h-[calc(100vh-4rem)]">{navigation}</div>
      </aside>

      {isMobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onMobileClose}
            aria-hidden="true"
          />
          <aside className="relative z-10 h-full w-80 max-w-[88vw] border-r border-border bg-surface-sidebar shadow-2xl">
            <button
              type="button"
              onClick={onMobileClose}
              className="absolute right-3 top-3 z-20 rounded-lg p-2 text-text-muted hover:bg-surface-raised hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-brand"
              aria-label="관리자 메뉴 닫기"
            >
              <X className="h-5 w-5" />
            </button>
            {navigation}
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1 bg-surface">
        <div className="sticky top-16 z-20 flex min-h-12 items-center justify-between gap-3 border-b border-border/80 bg-surface/90 px-4 py-2 backdrop-blur-xl md:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={onMobileOpen}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-[11px] font-black text-text-secondary transition-colors hover:border-brand/40 hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-brand lg:hidden"
              aria-label="관리자 메뉴 열기"
            >
              <Menu className="h-3.5 w-3.5" /> 관리 메뉴
            </button>
            <div className="min-w-0 text-xs text-text-muted" aria-label="현재 관리자 위치">
              <Link to="/admin" className="font-bold hover:text-text-primary">
                관리자
              </Link>
              <span className="mx-2 text-border">/</span>
              <span className="truncate font-bold text-text-primary">
                {currentItem?.label ?? "관리 기능"}
              </span>
            </div>
          </div>
          {stage === "ready" && (
            <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-accent-green/10 px-2.5 py-1 text-[10px] font-black text-accent-green sm:inline-flex">
              <CheckCircle2 className="h-3 w-3" /> 보호된 세션
            </span>
          )}
        </div>
        {children}
      </main>
    </>
  );
}

function AdminNavigationLink({
  item,
  pathname,
  onClick,
}: {
  item: AdminNavigationItem;
  pathname: string;
  onClick: () => void;
}) {
  const Icon = ICONS[item.id];
  const active = isAdminNavigationItemActive(item, pathname);
  return (
    <Link
      to={item.path}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-brand ${
        active
          ? "bg-brand text-white shadow-lg shadow-brand/15"
          : "text-text-secondary hover:bg-surface-raised hover:text-text-primary"
      }`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? "text-white" : "text-brand-light"}`} />
      <span className="min-w-0">
        <span className="block truncate text-xs font-black">{item.label}</span>
        <span
          className={`mt-0.5 block truncate text-[10px] ${active ? "text-white/70" : "text-text-muted"}`}
        >
          {item.description}
        </span>
      </span>
    </Link>
  );
}

function getSessionLabel(stage: WorkspaceStage, role: StaffRoleValue | null): string {
  if (stage === "loading") return "관리자 세션 확인 중";
  if (stage === "ready") return `${role ? ROLE_LABELS[role] : "관리자"} · 인증됨`;
  if (stage === "step-up") return "추가 본인 확인 필요";
  if (stage === "signed-out") return "OwOGG 로그인 필요";
  return "세션 상태를 확인할 수 없음";
}
