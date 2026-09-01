import { Link, useLocation } from "react-router";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Compass,
  Gamepad2,
  Home,
  MonitorPlay,
  ScrollText,
  Shapes,
  Trophy,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../features/i18n/I18nContext";
import { usePlatformFeatureSettings } from "../../features/catalog/gameAvailability";

type NavMatch = "home" | "games-all" | "games-genres" | "games-single" | "games-multi" | "path";

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path?: string;
  match?: NavMatch;
  badge?: string;
  disabled?: boolean;
}

function isNavActive(item: NavItem, pathname: string, search: string): boolean {
  if (item.disabled || !item.path) return false;
  const params = new URLSearchParams(search);

  switch (item.match) {
    case "home":
      return pathname === "/";
    case "games-all":
      return (
        pathname === "/games" &&
        !params.has("playMode") &&
        !params.has("category") &&
        (!params.has("view") || params.get("view") === "all")
      );
    case "games-genres":
      return pathname === "/games" && params.get("view") === "genres";
    case "games-single":
      return pathname === "/games" && params.get("playMode") === "single";
    case "games-multi":
      return pathname === "/games" && params.get("playMode") === "multi";
    default:
      return pathname === item.path || pathname.startsWith(`${item.path}/`);
  }
}

function DesktopNavItem({
  item,
  pathname,
  search,
  expanded,
}: {
  item: NavItem;
  pathname: string;
  search: string;
  expanded: boolean;
}) {
  const Icon = item.icon;
  const active = isNavActive(item, pathname, search);
  const className = `relative flex items-center gap-3.5 rounded-xl px-3.5 py-3 transition-colors duration-200 ${
    item.disabled
      ? "cursor-not-allowed text-text-muted opacity-65"
      : active
        ? "bg-brand font-bold text-white shadow-lg shadow-brand/25"
        : "text-text-secondary hover:bg-surface-raised hover:text-text-primary"
  }`;
  const content = (
    <>
      <Icon
        className={`h-5 w-5 shrink-0 ${active ? "text-white" : "text-brand-light"}`}
        aria-hidden="true"
      />
      <span
        className={`min-w-0 flex-1 truncate whitespace-nowrap text-sm font-semibold transition-opacity duration-150 ${
          expanded ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {item.label}
      </span>
      {item.badge && (
        <span
          className={`shrink-0 whitespace-nowrap rounded bg-surface-overlay px-1.5 py-0.5 text-[9px] font-extrabold text-text-muted transition-opacity duration-150 ${
            expanded ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          {item.badge}
        </span>
      )}
    </>
  );

  if (item.disabled || !item.path) {
    return (
      <div className={className} aria-disabled="true" title={`${item.label} · ${item.badge ?? ""}`}>
        {content}
      </div>
    );
  }

  return (
    <Link to={item.path} className={className} aria-current={active ? "page" : undefined}>
      {content}
    </Link>
  );
}

function MobileNavItem({
  item,
  pathname,
  search,
  onClick,
}: {
  item: NavItem;
  pathname: string;
  search: string;
  onClick: () => void;
}) {
  const Icon = item.icon;
  const active = isNavActive(item, pathname, search);
  const className = `flex items-center gap-3 rounded-xl px-4 py-3 transition-colors ${
    item.disabled
      ? "cursor-not-allowed text-text-muted opacity-65"
      : active
        ? "bg-brand font-bold text-white"
        : "text-text-secondary hover:bg-surface-raised hover:text-text-primary"
  }`;
  const content = (
    <>
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-base font-medium">{item.label}</span>
      {item.badge && (
        <span className="shrink-0 rounded bg-surface-overlay px-2 py-0.5 text-[10px] font-extrabold text-text-muted">
          {item.badge}
        </span>
      )}
    </>
  );

  if (item.disabled || !item.path) {
    return (
      <div className={className} aria-disabled="true">
        {content}
      </div>
    );
  }

  return (
    <Link
      to={item.path}
      onClick={onClick}
      className={className}
      aria-current={active ? "page" : undefined}
    >
      {content}
    </Link>
  );
}

interface SidebarProps {
  isMobileOpen: boolean;
  onMobileClose: () => void;
  isGamePlayPage: boolean;
}

const GAMEPLAY_EXPANDED_KEY = "owogg_gameplay_sidebar_expanded";

export function Sidebar({ isMobileOpen, onMobileClose, isGamePlayPage }: SidebarProps) {
  const location = useLocation();
  const { dict } = useI18n();
  const { externalPlatformGamesVisible } = usePlatformFeatureSettings();
  const [autoExpanded, setAutoExpanded] = useState(false);
  const [gameplayExpanded, setGameplayExpanded] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setGameplayExpanded(window.localStorage.getItem(GAMEPLAY_EXPANDED_KEY) === "true");
    }
  }, []);

  useEffect(
    () => () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    },
    [],
  );

  useEffect(() => setAutoExpanded(false), [location.pathname, location.search]);

  const openAutoSidebar = () => {
    if (isGamePlayPage) return;
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    setAutoExpanded(true);
  };

  const scheduleAutoCollapse = () => {
    if (isGamePlayPage) return;
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setAutoExpanded(false), 140);
  };

  const toggleGameplaySidebar = () => {
    setGameplayExpanded((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(GAMEPLAY_EXPANDED_KEY, String(next));
      }
      return next;
    });
  };

  const expanded = isGamePlayPage ? gameplayExpanded : autoExpanded;
  const gameNavItems: NavItem[] = [
    { label: dict.sidebar.home, path: "/", icon: Home, match: "home" },
    { label: dict.sidebar.allGames, path: "/games", icon: Gamepad2, match: "games-all" },
    {
      label: dict.sidebar.genreGames,
      path: "/games?view=genres",
      icon: Shapes,
      match: "games-genres",
    },
    {
      label: dict.sidebar.singleGames,
      path: "/games?playMode=single",
      icon: UserRound,
      match: "games-single",
    },
    {
      label: dict.sidebar.multiplayerGames,
      path: "/games?playMode=multi",
      icon: UsersRound,
      match: "games-multi",
    },
    ...(externalPlatformGamesVisible
      ? [
          {
            label: dict.sidebar.externalGames,
            icon: MonitorPlay,
            badge: dict.sidebar.comingSoon,
            disabled: true,
          } satisfies NavItem,
        ]
      : []),
  ];
  const otherNavItems: NavItem[] = [
    { label: dict.sidebar.rankingRecords, path: "/ranking", icon: Trophy, match: "path" },
    { label: dict.sidebar.discordServers, path: "/discord/servers", icon: Compass, match: "path" },
    { label: dict.nav.wiki, path: "/wiki", icon: BookOpen, match: "path" },
    { label: dict.footer.changelog, path: "/changelog", icon: ScrollText, match: "path" },
  ];

  return (
    <>
      <aside
        data-expanded={expanded}
        className={`relative z-30 hidden shrink-0 bg-surface-sidebar transition-[width] duration-300 ease-out lg:block ${
          expanded ? "w-56" : "w-16"
        }`}
        onMouseEnter={openAutoSidebar}
        onMouseLeave={scheduleAutoCollapse}
        onFocusCapture={openAutoSidebar}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            scheduleAutoCollapse();
          }
        }}
      >
        <div className="h-[calc(100dvh-4rem)] w-16">
          <div
            className={`fixed bottom-0 left-0 top-16 flex flex-col overflow-hidden border-r border-border/80 bg-surface-sidebar shadow-[14px_0_36px_rgba(0,0,0,0.24)] transition-[width] duration-300 ease-out ${
              expanded ? "w-56" : "w-16"
            }`}
          >
            {isGamePlayPage && (
              <button
                type="button"
                onClick={toggleGameplaySidebar}
                aria-expanded={expanded}
                aria-label={expanded ? dict.sidebar.collapseMenuAria : dict.sidebar.expandMenuAria}
                title={expanded ? dict.sidebar.collapseMenuAria : dict.sidebar.expandMenuAria}
                className="absolute -right-3 top-4 z-20 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface-raised text-brand-light shadow-lg transition-colors hover:border-brand/60 hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {expanded ? (
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            )}

            <div className="flex h-full min-h-0 flex-col overflow-hidden p-2">
              <nav
                className="flex shrink-0 flex-col gap-1.5"
                aria-label={dict.sidebar.mobileMenuTitle}
              >
                {gameNavItems.map((item) => (
                  <DesktopNavItem
                    key={item.label}
                    item={item}
                    pathname={location.pathname}
                    search={location.search}
                    expanded={expanded}
                  />
                ))}
              </nav>

              <div
                data-sidebar-secondary-scroll
                className="mt-3 min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain border-t border-border/60 pt-3"
              >
                <div className="flex flex-col gap-1.5">
                  <p
                    className={`overflow-hidden whitespace-nowrap px-3.5 text-[10px] font-bold uppercase tracking-wider text-text-muted transition-all duration-150 ${
                      expanded ? "h-4 opacity-100" : "h-0 opacity-0"
                    }`}
                  >
                    {dict.sidebar.otherHeading}
                  </p>
                  {otherNavItems.map((item) => (
                    <DesktopNavItem
                      key={item.label}
                      item={item}
                      pathname={location.pathname}
                      search={location.search}
                      expanded={expanded}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {isMobileOpen && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={dict.sidebar.mobileMenuTitle}
        >
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onMobileClose} />
          <div className="relative z-10 flex h-full w-72 max-w-[82vw] flex-col overflow-y-auto border-r border-border bg-surface-sidebar p-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-2">
                <Gamepad2 className="h-6 w-6 text-brand" aria-hidden="true" />
                <span className="text-lg font-bold text-text-primary">
                  {dict.sidebar.mobileMenuTitle}
                </span>
              </div>
              <button
                type="button"
                onClick={onMobileClose}
                aria-label={dict.sidebar.collapseMenuAria}
                className="rounded-lg p-2 text-text-secondary hover:bg-surface-raised hover:text-text-primary"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <nav className="flex flex-col gap-2" aria-label={dict.sidebar.mobileMenuTitle}>
              {gameNavItems.map((item) => (
                <MobileNavItem
                  key={item.label}
                  item={item}
                  pathname={location.pathname}
                  search={location.search}
                  onClick={onMobileClose}
                />
              ))}
            </nav>

            <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
              <p className="px-4 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                {dict.sidebar.otherHeading}
              </p>
              {otherNavItems.map((item) => (
                <MobileNavItem
                  key={item.label}
                  item={item}
                  pathname={location.pathname}
                  search={location.search}
                  onClick={onMobileClose}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
