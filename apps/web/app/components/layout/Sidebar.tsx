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
} from "lucide-react";
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

/** Desktop rail row — icon always visible, label/badge fade in on the group hover-expand
 * (w-16 → w-56). Shared by both the game group and the "기타" group below it. */
function DesktopNavLink({ item, currentPath }: { item: NavItem; currentPath: string }) {
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
      <span className="text-sm font-semibold opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap overflow-hidden">
        {item.label}
      </span>
      {item.badge && (
        <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-accent-red text-white uppercase tracking-wider">
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
  /** Gameplay uses an on-demand overlay drawer at every breakpoint, leaving the player flush with
   * the content edge. Every other service route keeps the compact hover-expanding desktop rail. */
  overlayOnly?: boolean;
}

export function Sidebar({ isMobileOpen, onMobileClose, overlayOnly = false }: SidebarProps) {
  const location = useLocation();
  const currentPath = location.pathname;
  const { dict, locale, setLocale } = useI18n();

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

  return (
    <>
      {/* Desktop Sidebar (CrazyGames style: compact w-16 or expanded w-56) */}
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
      {/* overflow-hidden lives on the INNER sticky div, not this <aside>, on purpose: overflow
          (even just `hidden`) on an ancestor makes that ancestor the sticky element's
          containing block for `top` resolution instead of the viewport. With it on <aside>,
          `sticky top-16` below was computing its offset from the aside's own (non-scrolling)
          box rather than the page scroll, which silently added a bogus ~64px gap above the
          nav items on every load — nothing was scrolled, so nothing should have been "stuck"
          yet. Moving overflow-hidden one level in keeps the same visual clipping (still needed
          so the w-16→w-56 hover-expand doesn't spill icon-row content past the collapsed
          rail) without it also hijacking the sticky calculation. */}
      {!overlayOnly && (
        <aside className="hidden lg:block w-16 hover:w-56 transition-all duration-300 ease-in-out bg-surface-sidebar border-r border-border z-30 group shadow-2xl shrink-0 select-none">
          <div className="sticky top-16 flex flex-col h-[calc(100vh-4rem)] overflow-hidden p-2">
            {/* Main Nav — no heading above it (used to be a "탐색 메뉴" label here, which just
              pushed Home down by its own height even while collapsed) so the first item sits
              right at the top. Games first, then a divider, then everything else — see
              gameNavItems/otherNavItems above for why they're split. */}
            <div className="flex flex-col gap-1.5">
              {gameNavItems.map((item) => (
                <DesktopNavLink key={item.label} item={item} currentPath={currentPath} />
              ))}
            </div>

            <div className="mt-3 border-t border-border/60 pt-3 flex flex-col gap-1.5">
              <p className="px-3.5 text-[10px] font-bold text-text-muted uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                {dict.sidebar.otherHeading}
              </p>
              {otherNavItems.map((item) => (
                <DesktopNavLink key={item.label} item={item} currentPath={currentPath} />
              ))}
            </div>
          </div>
        </aside>
      )}

      {/* Mobile Drawer Overlay */}
      {isMobileOpen && (
        <div
          className={`${overlayOnly ? "" : "lg:hidden"} fixed inset-0 z-50 flex`}
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
