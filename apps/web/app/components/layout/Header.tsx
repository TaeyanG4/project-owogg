import { Link, useNavigate } from "react-router";
import {
  Search,
  Menu,
  Bookmark,
  User,
  LogOut,
  Trophy,
  Settings as SettingsIcon,
  ShieldCheck,
  Gamepad2,
  Video,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../features/auth";
import { useI18n } from "../../features/i18n/I18nContext";
import { LanguageSelector } from "../ui/LanguageSelector";
import { OwoWordmarkIcon } from "../ui/OwoWordmarkIcon";
import { RegisteredServersMenu } from "../ui/RegisteredServersMenu";
import { useClickOutside } from "../../hooks/useClickOutside";
import { fetchMyAccess } from "../../features/myAccess";
import { ApiClientError } from "../../lib/api/errors.js";
import { retryAsync } from "../../lib/api/retry.js";
import type { MyAccessResponse } from "@owogg/contracts";

interface HeaderProps {
  onToggleMobileSidebar: () => void;
  isAdminWorkspace?: boolean;
}

export function Header({ onToggleMobileSidebar, isAdminWorkspace = false }: HeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [myAccess, setMyAccess] = useState<MyAccessResponse | null>(null);
  const navigate = useNavigate();
  const { user, isAuthenticated, openLoginModal, logout } = useAuth();
  const { dict } = useI18n();
  const userDropdownRef = useRef<HTMLDivElement>(null);
  useClickOutside(userDropdownRef, () => setShowUserDropdown(false), showUserDropdown);

  // Drives the role/program-specific dropdown entries below (Staff Role center, Game Creator
  // center/apply, Streamer center — see docs/AUTHORIZATION.md). One extra request per session per
  // login, not per dropdown-open. A plain USER gets back staffRole: null and both programs false,
  // so nothing extra renders for them — frontend display only follows what the backend actually
  // grants; it is never itself the authorization check (see routes' requirePermission calls).
  // Network/5xx failures are retried and preserve the last successful access snapshot. A browser
  // reconnect/focus rechecks it so a temporary API outage cannot hide Staff Center entries for
  // the rest of the SPA session.
  useEffect(() => {
    if (!isAuthenticated) {
      setMyAccess(null);
      return;
    }
    let cancelled = false;
    const refreshMyAccess = async () => {
      try {
        const response = await retryAsync(fetchMyAccess);
        if (!cancelled) setMyAccess(response);
      } catch (error) {
        // Only an authoritative 401 clears the access snapshot. Transient outages keep the last
        // known value until the focus/online retry succeeds instead of silently removing menus.
        if (!cancelled && error instanceof ApiClientError && error.status === 401) {
          setMyAccess(null);
        }
      }
    };
    const retryAfterReconnect = () => void refreshMyAccess();
    void refreshMyAccess();
    window.addEventListener("online", retryAfterReconnect);
    window.addEventListener("focus", retryAfterReconnect);
    return () => {
      cancelled = true;
      window.removeEventListener("online", retryAfterReconnect);
      window.removeEventListener("focus", retryAfterReconnect);
    };
  }, [isAuthenticated]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/games?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const staffCenter =
    myAccess?.staffRole &&
    (myAccess.staffRole === "ADMIN" || myAccess.permissions.includes("admin.center.access"))
      ? { to: "/admin", label: "관리자 센터", Icon: ShieldCheck }
      : null;
  const gameCreator = myAccess?.gameCreator;
  // Always shown to every logged-in user, regardless of canApply — even while self-serve
  // applications are closed (canApplyForGameCreator() currently false, §"추후 업데이트 예정"), the
  // entry stays visible and just routes to /game-creator's own "coming soon" state, rather than
  // disappearing and giving no indication the program exists at all.
  const showGameCreatorEntry = !!gameCreator;
  const gameCreatorLabel = !gameCreator
    ? ""
    : gameCreator.hasAccess
      ? "게임 크리에이터 센터"
      : gameCreator.applicationStatus === "PENDING"
        ? "게임 크리에이터 신청 확인"
        : "게임 크리에이터 신청";
  const showStreamerEntry = !!myAccess?.streamer.isVerified;
  const showAccessSection = !!staffCenter || showGameCreatorEntry || showStreamerEntry;

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-surface/90 border-b border-border/80 transition-all select-none">
      <div className="w-full px-4 h-16 flex items-center justify-between gap-4">
        {/* Left: Mobile Toggle & Brand Logo */}
        <div className="flex items-center gap-3">
          <button
            className="cursor-pointer rounded-xl p-2 text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary lg:hidden"
            onClick={onToggleMobileSidebar}
            aria-label={dict.sidebar.openMenuAria}
          >
            <Menu className="w-6 h-6" />
          </button>

          <Link to="/" className="flex items-center gap-2 group">
            <OwoWordmarkIcon className="h-9 w-9 group-hover:scale-105 transition-transform duration-200" />
            <span className="font-extrabold text-xl tracking-tight text-text-primary">
              OwO
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-light to-accent-purple">
                GG
              </span>
            </span>
          </Link>
        </div>

        {/* Center: Search Bar */}
        {isAdminWorkspace ? (
          <div className="hidden flex-1 items-center sm:flex">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand/10 px-3 py-1.5 text-xs font-black text-brand-light">
              <ShieldCheck className="h-3.5 w-3.5" /> 관리자 워크스페이스
            </span>
          </div>
        ) : (
          <form
            onSubmit={handleSearchSubmit}
            className="flex-1 max-w-md hidden sm:flex items-center relative"
          >
            <Search className="w-4 h-4 text-text-muted absolute left-3.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={dict.nav.searchPlaceholder}
              className="w-full bg-surface-raised text-text-primary placeholder:text-text-muted text-sm rounded-full pl-10 pr-4 py-2 border border-border/80 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-all shadow-inner"
            />
          </form>
        )}

        {/* Right: Quick Actions & Auth.
            Growth rule for this row: on narrow phones (<sm), the header only ever shows the
            small, fixed set of actions every visitor needs on every page — search and
            profile/login. Everything else (favorites, Discord servers, language, and whatever
            gets added next) lives in the `hidden sm:flex` cluster below, which is free to grow
            since sm+ viewports have the width for it, PLUS a matching entry in the mobile
            drawer's "more" section (Sidebar.tsx) so it's never actually unreachable on phones —
            just one tap behind the hamburger instead of a 6th icon fighting for header space.
            A horizontal icon row has a hard width ceiling; a vertical drawer list doesn't, so
            new features should default to the drawer rather than squeezing into this row. */}
        <div className="flex items-center gap-2.5">
          {/* Search is a full input on sm+ (above); below that there's no room for it, so this
              icon links to /games where the search input lives instead of hiding search entirely. */}
          {!isAdminWorkspace && (
            <Link
              to="/games"
              className="sm:hidden p-2.5 rounded-full text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors cursor-pointer"
              title={dict.nav.searchPlaceholder}
              aria-label={dict.nav.searchPlaceholder}
            >
              <Search className="w-5 h-5" />
            </Link>
          )}

          {!isAdminWorkspace && (
            <div className="hidden sm:flex items-center gap-2.5">
              <Link
                to="/games?category=favorites"
                className="p-2.5 rounded-full text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors relative cursor-pointer"
                title={dict.nav.favorites}
              >
                <Bookmark className="w-5 h-5" />
              </Link>

              <RegisteredServersMenu />

              <LanguageSelector />
            </div>
          )}

          {isAuthenticated && user ? (
            <div className="relative" ref={userDropdownRef}>
              {/* No pill/box at any size — just the avatar (+ nickname from md up) with a subtle
                  hover highlight, matching the rest of the header's plain icon buttons instead
                  of standing out as a bordered card. */}
              <button
                onClick={() => setShowUserDropdown(!showUserDropdown)}
                className="flex items-center gap-2 rounded-full p-1 transition-colors cursor-pointer hover:bg-surface-raised"
              >
                <span className="text-xs font-bold text-text-primary max-w-[100px] truncate hidden md:inline">
                  {user.nickname}
                </span>
                <div className="w-8 h-8 md:w-7 md:h-7 rounded-full bg-brand text-white font-black text-xs flex items-center justify-center overflow-hidden border border-brand/40">
                  {user.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt={user.nickname}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    user.nickname.slice(0, 2)
                  )}
                </div>
              </button>

              {/* User Dropdown Menu */}
              {showUserDropdown && (
                <div
                  className="absolute right-0 mt-2 w-56 bg-surface-raised border border-border rounded-2xl shadow-2xl py-2 flex flex-col z-50 animate-in fade-in zoom-in-95 duration-150"
                  onMouseLeave={() => setShowUserDropdown(false)}
                >
                  <div className="px-4 py-3 border-b border-border/60">
                    <p className="text-xs font-bold text-text-primary truncate">{user.nickname}</p>
                    <p className="text-[11px] text-text-muted truncate">{user.email}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {user.providers.map((p) => (
                        <span
                          key={p}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand/10 text-brand border border-brand/20 capitalize"
                        >
                          {p}
                          {dict.nav.accountSuffix}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* A single "프로필" entry — this used to be two separate links (a private
                      "내 프로필" and a "공개 프로필") pointing at two pages that duplicated most
                      of their content; they're merged into one unified page at /users/:id now. */}
                  <Link
                    to={`/users/${user.id}`}
                    onClick={() => setShowUserDropdown(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-text-primary hover:bg-surface-overlay transition-colors"
                  >
                    <User className="w-4 h-4 text-brand-light" />
                    <span>{dict.nav.myProfile}</span>
                  </Link>

                  <Link
                    to="/settings"
                    onClick={() => setShowUserDropdown(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-text-primary hover:bg-surface-overlay transition-colors"
                  >
                    <SettingsIcon className="w-4 h-4 text-brand-light" />
                    <span>{dict.nav.settings}</span>
                  </Link>

                  <Link
                    to="/ranking"
                    onClick={() => setShowUserDropdown(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-text-primary hover:bg-surface-overlay transition-colors"
                  >
                    <Trophy className="w-4 h-4 text-accent-yellow" />
                    <span>{dict.nav.ranking}</span>
                  </Link>

                  {/* Staff Role / Game Creator / Streamer entry points — each independently
                      gated on the /api/me/access response, per docs/AUTHORIZATION.md. Backend
                      authorization is the real gate; this only decides what's worth showing. */}
                  {showAccessSection && (
                    <>
                      <div className="my-1 border-t border-border/40" />

                      {staffCenter && (
                        <Link
                          to={staffCenter.to}
                          onClick={() => setShowUserDropdown(false)}
                          className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-text-primary hover:bg-surface-overlay transition-colors"
                        >
                          <staffCenter.Icon className="w-4 h-4 text-brand-light" />
                          <span>{staffCenter.label}</span>
                        </Link>
                      )}

                      {showGameCreatorEntry && (
                        <Link
                          to="/game-creator"
                          onClick={() => setShowUserDropdown(false)}
                          className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-text-primary hover:bg-surface-overlay transition-colors"
                        >
                          <Gamepad2 className="w-4 h-4 text-brand-light" />
                          <span>{gameCreatorLabel}</span>
                        </Link>
                      )}

                      {showStreamerEntry && (
                        <Link
                          to="/settings#streamer-center"
                          onClick={() => setShowUserDropdown(false)}
                          className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-text-primary hover:bg-surface-overlay transition-colors"
                        >
                          <Video className="w-4 h-4 text-brand-light" />
                          <span>스트리머 센터</span>
                        </Link>
                      )}
                    </>
                  )}

                  <button
                    onClick={() => {
                      void logout();
                      setShowUserDropdown(false);
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-accent-red hover:bg-accent-red/10 transition-colors w-full text-left border-t border-border/40 mt-1 cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>{dict.nav.logout}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={openLoginModal}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-gradient-to-r from-brand to-brand-dark rounded-full hover:shadow-lg hover:shadow-brand/30 hover:scale-105 transition-all cursor-pointer"
            >
              <User className="w-4 h-4" />
              <span>{dict.nav.login}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
