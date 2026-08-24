import type { Dictionary } from "../i18n/dictionary";

export interface WikiNavItem {
  path: string;
  label: string;
}

export interface WikiNavSection {
  title: string;
  items: WikiNavItem[];
}

/** Single source of truth for the Wiki's information architecture — sidebar nav, breadcrumbs,
 * and prev/next links are all derived from this list. Discord is listed first since that's what
 * most incoming users need help with (install/onboarding). Locale-aware: built from the active
 * dictionary rather than a static Korean-only list. */
export function buildWikiSections(dict: Dictionary): WikiNavSection[] {
  return [
    {
      title: dict.wiki.navGettingStarted,
      items: [{ path: "/wiki/getting-started", label: dict.wiki.navGettingStarted }],
    },
    {
      title: "Discord",
      items: [
        { path: "/wiki/discord", label: dict.wiki.navDiscordOverview },
        { path: "/wiki/discord/install", label: dict.wiki.navDiscordInstall },
        { path: "/wiki/discord/account-link", label: dict.wiki.navDiscordAccountLink },
        {
          path: "/wiki/discord/server-registration",
          label: dict.wiki.navDiscordServerRegistration,
        },
        { path: "/wiki/discord/commands", label: dict.wiki.navDiscordCommands },
        { path: "/wiki/discord/xp", label: dict.wiki.navDiscordXp },
        { path: "/wiki/discord/troubleshooting", label: dict.wiki.navDiscordTroubleshooting },
      ],
    },
    {
      title: dict.wiki.navAccount,
      items: [
        { path: "/wiki/account", label: dict.wiki.navAccountOverview },
        { path: "/wiki/account/merge", label: dict.wiki.navAccountMerge },
      ],
    },
    {
      title: dict.wiki.navGamesRanking,
      items: [
        { path: "/wiki/games", label: dict.wiki.navGamesOverview },
        { path: "/wiki/games/development", label: dict.wiki.navGamesDevelopment },
        { path: "/wiki/games/ranking", label: dict.wiki.navRanking },
        { path: "/wiki/games/xp", label: dict.wiki.navGamesXp },
      ],
    },
    {
      title: "Streamer",
      items: [
        { path: "/wiki/streamer", label: dict.wiki.navStreamerOverview },
        { path: "/wiki/streamer/verification", label: dict.wiki.navStreamerVerification },
        { path: "/wiki/streamer/featured", label: dict.wiki.navStreamerFeatured },
      ],
    },
    {
      title: dict.wiki.navSupport,
      items: [{ path: "/wiki/support", label: dict.wiki.navSupport }],
    },
    {
      title: dict.wiki.catPolicyTitle,
      items: [
        { path: "/terms", label: dict.legal.terms.pageTitle },
        { path: "/privacy", label: dict.legal.privacy.pageTitle },
      ],
    },
  ];
}

export function findAdjacentWikiPages(
  sections: WikiNavSection[],
  currentPath: string,
): {
  prev: WikiNavItem | null;
  next: WikiNavItem | null;
} {
  const flatItems = sections.flatMap((s) => s.items);
  const index = flatItems.findIndex((item) => item.path === currentPath);
  if (index === -1) return { prev: null, next: null };
  return {
    prev: index > 0 ? (flatItems[index - 1] ?? null) : null,
    next: index < flatItems.length - 1 ? (flatItems[index + 1] ?? null) : null,
  };
}
