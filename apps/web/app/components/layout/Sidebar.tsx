import { Link, useLocation } from "react-router";
import {
  Home,
  Gamepad2,
  Zap,
  Brain,
  Trophy,
  Flame,
  X,
  Bookmark,
  Check,
  ScrollText,
  BookOpen,
  Compass,
  ChevronLeft,
  ChevronRight,
  Languages,
} from "lucide-react";
import { useState } from "react";
import { SUPPORTED_LOCALES } from "@owogg/core";
import { useI18n } from "../../features/i18n/I18nContext";
import { DiscordIcon } from "../ui/DiscordIcon";
import { NATIVE_LABELS } from "../ui/LanguageSelector";

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

/** Desktop rail row — icons stay visible in the 64px rail while labels and badges are revealed by
 * the explicit expand control. Shared by the game, other, and more groups. */
function DesktopNavLink({
  item,
  currentPath,
  expanded,
}: {
  item: NavItem;
  currentPath: string;
  expanded: boolean;
}) {
  const Icon = item.icon;
  const isActive =
    currentPath === item.path || (item.path !== "/" && currentPath.startsWith(item.path));

  return (
    <Link
      to={item.path}
      className={`flex items-center gap-3.5 px-3.5 py-3 rounded-xl transition-all duration-200 group/btn relative ${
        isActive
          ? "bg-brand text-white font-bold shadow-lg shadow-brand/25"
          : "text-text-secondary hover:text-text-primary hover:bg-surface-raised"
      }`}
    >
      <Icon
        className={`w-5 h-5 shrink-0 transition-transform group-hover/btn:scale-110 ${isActive ? "text-white" : "text-brand-light"}`}
      />
      <span
        className={`overflow-hidden whitespace-nowrap text-sm font-semibold transition-opacity duration-200 ${
          expanded ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {item.label}
      </span>
      {item.badge && (
        <span
          className={`ml-auto rounded bg-accent-red px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white transition-opacity duration-200 ${
            expanded ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          {item.badge}
        </span>
      )}
    </Link>
  );
}

/** Mobile drawer row — label always visible (no hover state on touch). Shared by both the game
 * group and the "기타" group below it. */
function MobileNavLink({
  item,
  currentPath,
  onClick,
}: {
  item: NavItem;
  currentPath: string;
  onClick: () => void;
}) {
  const Icon = item.icon;
  const isActive =
    currentPath === item.path || (item.path !== "/" && currentPath.startsWith(item.path));

  return (
    <Link
      to={item.path}
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
        isActive
          ? "bg-brand text-white font-bold"
          : "text-text-secondary hover:text-text-primary hover:bg-surface-raised"
      }`}
    >
      <Icon className="w-5 h-5" />
      <span className="text-base font-medium">{item.label}</span>
      {item.badge && (
        <span className="ml-auto text-[10px] font-extrabold px-2 py-0.5 rounded bg-accent-red text-white">
          {item.badge}
        </span>
      )}
    </Link>
  );
}

interface SidebarProps {
  isMobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ isMobileOpen, onMobileClose }: SidebarProps) {
  const location = useLocation();
  const currentPath = location.pathname;
  const { dict, locale, setLocale } = useI18n();
  const [isDesktopExpanded, setIsDesktopExpanded] = useState(false);

  // Games first, always — anything that isn't actually a game/game-category destination goes
  // in otherNavItems below instead, rendered as a visually separate second group. 순발력(reaction)
  // and 두뇌(brain) used to be one combined "순발력 & 두뇌" entry pointing at a single category
  // filter; they're two distinct categories (see CategoryChips.tsx) with their own filter value,
  // so they get their own nav rows now instead of only one of the two being reachable from here.
  const gameNavItems = [
    { label: dict.sidebar.home, path: "/", icon: Home, badge: "HOT" },
    { label: dict.sidebar.allGames, path: "/games", icon: Gamepad2 },
    { label: dict.sidebar.popularGames, path: "/games?sort=popular", icon: Flame },
    {
      label: dict.games.categories.reaction,
      path: "/games?category=reaction",
      icon: Zap,
      badge: "NEW",
    },
    { label: dict.games.categories.brain, path: "/games?category=brain", icon: Brain },
    { label: dict.sidebar.rankingRecords, path: "/ranking", icon: Trophy },
  ];

  const otherNavItems = [
    { label: dict.sidebar.discordHub, path: "/discord", icon: DiscordIcon },
    // dict.nav.wiki already existed (translated in all 4 locales) but was unused — Footer links
    // to Wiki via dict.footer.wiki, the sidebar previously had no Wiki entry at all.
    { label: dict.nav.wiki, path: "/wiki", icon: BookOpen },
    { label: dict.footer.changelog, path: "/changelog", icon: ScrollText },
  ];

  const moreNavItems = [
    { label: dict.sidebar.favorites, path: "/games?category=favorites", icon: Bookmark },
    { label: dict.sidebar.discordServers, path: "/discord/servers", icon: Compass },
  ];

  return (
    <>
      {/* Desktop Sidebar: a stable 64px icon rail that expands only through the edge control.
          Merely crossing the rail no longer resizes the game or catalog; hover reveals a clear
          chevron, then the user deliberately expands or collapses it. Gameplay uses this exact
          same rail instead of switching to a desktop overlay drawer. */}
      {/* z-30: strictly below Header's z-40. Both are `sticky` and Header is h-16 (Sidebar's
          `top-16` sticky offset matches exactly), so they shouldn't normally overlap — but
          they previously shared the same z-40, meaning any transient overlap (e.g. mid-scroll,
          or the sidebar's own shadow-2xl bleeding upward) let the sidebar's later DOM position
          paint over the header instead of under it, hiding the logo. Header must always win. */}
      {/* The <aside> itself stretches to the full height of the content row (default flex
          `align-items: stretch`, no fixed height) so its background and right border run
          unbroken all the way down to the footer. Only the inner panel is sticky/viewport-
          tall — previously the aside itself was both sticky AND h-[calc(100vh-4rem)], so on
          pages taller than the viewport its background simply stopped mid-page, leaving a
          visible horizontal seam with the page background showing through below it. */}
      <aside
        className={`group/sidebar relative z-30 hidden shrink-0 select-none border-r border-border bg-surface-sidebar shadow-2xl transition-[width] duration-300 ease-out lg:block ${
          isDesktopExpanded ? "w-56" : "w-16"
        }`}
      >
        <div className="sticky top-16 h-[calc(100vh-4rem)]">
          <button
            type="button"
            onClick={() => setIsDesktopExpanded((expanded) => !expanded)}
            aria-expanded={isDesktopExpanded}
            aria-label={
              isDesktopExpanded ? dict.sidebar.collapseMenuAria : dict.sidebar.expandMenuAria
            }
            title={isDesktopExpanded ? dict.sidebar.collapseMenuAria : dict.sidebar.expandMenuAria}
            className={`absolute -right-3 top-4 z-20 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface-raised text-brand-light shadow-lg transition-all duration-200 hover:border-brand/60 hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
              isDesktopExpanded
                ? "opacity-100"
                : "pointer-events-none translate-x-1 opacity-0 group-hover/sidebar:pointer-events-auto group-hover/sidebar:translate-x-0 group-hover/sidebar:opacity-100 group-focus-within/sidebar:pointer-events-auto group-focus-within/sidebar:translate-x-0 group-focus-within/sidebar:opacity-100"
            }`}
          >
            {isDesktopExpanded ? (
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </button>

          {/* Horizontal clipping stays inside the sticky panel so labels cannot leak out of the
              collapsed rail. The aside itself deliberately has visible overflow so the edge
              control can sit half outside its border without breaking sticky positioning. */}
          <div className="flex h-full flex-col overflow-x-hidden overflow-y-auto p-2">
            {/* Main Nav — no heading above it (used to be a "탐색 메뉴" label here, which just
              pushed Home down by its own height even while collapsed) so the first item sits
              right at the top. Games first, then a divider, then everything else — see
              gameNavItems/otherNavItems above for why they're split. */}
            <div className="flex flex-col gap-1.5">
              {gameNavItems.map((item) => (
                <DesktopNavLink
                  key={item.label}
                  item={item}
                  currentPath={currentPath}
                  expanded={isDesktopExpanded}
                />
              ))}
            </div>

            <div className="mt-3 border-t border-border/60 pt-3 flex flex-col gap-1.5">
              <p
                className={`whitespace-nowrap px-3.5 text-[10px] font-bold uppercase tracking-wider text-text-muted transition-opacity duration-200 ${
                  isDesktopExpanded ? "opacity-100" : "opacity-0"
                }`}
              >
                {dict.sidebar.otherHeading}
              </p>
              {otherNavItems.map((item) => (
                <DesktopNavLink
                  key={item.label}
                  item={item}
                  currentPath={currentPath}
                  expanded={isDesktopExpanded}
                />
              ))}
            </div>

            {/* Keep the useful secondary actions from the mobile drawer in the desktop menu too.
                Their icons remain reachable in compact mode; labels and locale choices appear
                when the user explicitly expands the rail. */}
            <div className="mt-3 flex flex-col gap-1.5 border-t border-border/60 pt-3">
              <p
                className={`whitespace-nowrap px-3.5 text-[10px] font-bold uppercase tracking-wider text-text-muted transition-opacity duration-200 ${
                  isDesktopExpanded ? "opacity-100" : "opacity-0"
                }`}
              >
                {dict.sidebar.moreHeading}
              </p>
              {moreNavItems.map((item) => (
                <DesktopNavLink
                  key={item.label}
                  item={item}
                  currentPath={currentPath}
                  expanded={isDesktopExpanded}
                />
              ))}

              <div className="flex min-w-0 items-start gap-3.5 rounded-xl px-3.5 py-3 text-text-secondary">
                <Languages className="h-5 w-5 shrink-0 text-brand-light" aria-hidden="true" />
                {isDesktopExpanded && (
                  <div className="min-w-0 flex-1">
                    <p className="mb-2 whitespace-nowrap text-sm font-semibold text-text-secondary">
                      {dict.language.label}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {SUPPORTED_LOCALES.map((l) => {
                        const active = l === locale;
                        return (
                          <button
                            key={l}
                            type="button"
                            onClick={() => setLocale(l)}
                            className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold transition-colors ${
                              active
                                ? "border-brand/30 bg-brand/10 text-brand-light"
                                : "border-border text-text-secondary hover:bg-surface-raised hover:text-text-primary"
                            }`}
                          >
                            {active && <Check className="h-3 w-3" aria-hidden="true" />}
                            {NATIVE_LABELS[l]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer Overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={dict.sidebar.mobileMenuTitle}
        >
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onMobileClose} />

          <div className="relative flex flex-col w-72 max-w-[80vw] bg-surface-sidebar border-r border-border h-full p-4 z-10 shadow-2xl animate-in slide-in-from-left duration-200 overflow-y-auto">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Gamepad2 className="w-6 h-6 text-brand" />
                <span className="font-bold text-lg text-text-primary">
                  {dict.sidebar.mobileMenuTitle}
                </span>
              </div>
              <button
                onClick={onMobileClose}
                className="p-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-raised"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Games first, then a divider, then everything else — same grouping as the desktop
                rail above. */}
            <nav className="flex flex-col gap-2">
              {gameNavItems.map((item) => (
                <MobileNavLink
                  key={item.label}
                  item={item}
                  currentPath={currentPath}
                  onClick={onMobileClose}
                />
              ))}
            </nav>

            <div className="mt-4 pt-4 border-t border-border flex flex-col gap-2">
              <p className="px-4 text-[11px] font-bold text-text-muted uppercase tracking-wider">
                {dict.sidebar.otherHeading}
              </p>
              {otherNavItems.map((item) => (
                <MobileNavLink
                  key={item.label}
                  item={item}
                  currentPath={currentPath}
                  onClick={onMobileClose}
                />
              ))}
            </div>

            {/* Secondary actions — favorites, Discord servers, language. These stay out of the
                header's icon row on narrow phones (Header.tsx's "growth rule" comment explains
                why) and live here instead, so they're always one hamburger-tap away rather than
                fighting the header for a width that phones don't have. */}
            <div className="mt-4 pt-4 border-t border-border flex flex-col gap-2">
              <p className="px-4 text-[11px] font-bold text-text-muted uppercase tracking-wider">
                {dict.sidebar.moreHeading}
              </p>

              <Link
                to="/games?category=favorites"
                onClick={onMobileClose}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
              >
                <Bookmark className="w-5 h-5" />
                <span className="text-base font-medium">{dict.sidebar.favorites}</span>
              </Link>

              <Link
                to="/discord/servers"
                onClick={onMobileClose}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors"
              >
                {/* Compass (not DiscordIcon) so this doesn't look identical to the "Discord Hub"
                    row above in the same drawer — see RegisteredServersMenu.tsx's comment. */}
                <Compass className="w-5 h-5" />
                <span className="text-base font-medium">{dict.sidebar.discordServers}</span>
              </Link>

              <div className="px-4 py-1">
                <div className="flex flex-wrap gap-1.5">
                  {SUPPORTED_LOCALES.map((l) => {
                    const active = l === locale;
                    return (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setLocale(l)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
                          active
                            ? "bg-brand/10 text-brand-light border border-brand/30"
                            : "text-text-secondary border border-border hover:text-text-primary hover:bg-surface-raised"
                        }`}
                      >
                        {active && <Check className="w-3 h-3" aria-hidden="true" />}
                        {NATIVE_LABELS[l]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
