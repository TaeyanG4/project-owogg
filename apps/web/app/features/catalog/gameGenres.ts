export interface GameGenreLabels {
  readonly skillTest: string;
  readonly board: string;
  readonly action: string;
  readonly adventure: string;
  readonly arcade: string;
  readonly casual: string;
  readonly puzzle: string;
  readonly strategy: string;
  readonly party: string;
  readonly sports: string;
  readonly racing: string;
  readonly rhythm: string;
  readonly simulation: string;
  readonly rolePlaying: string;
  readonly shooter: string;
  readonly fighting: string;
  readonly platformer: string;
  readonly educational: string;
  readonly other: string;
}

export interface ResolvedGameGenre {
  readonly key: string;
  readonly label: string;
}

const UNCATEGORIZED_KEY = "__uncategorized__";

const KNOWN_GENRE_LABEL_KEYS = {
  "skill-test": "skillTest",
  board: "board",
  action: "action",
  adventure: "adventure",
  arcade: "arcade",
  casual: "casual",
  puzzle: "puzzle",
  strategy: "strategy",
  party: "party",
  sports: "sports",
  racing: "racing",
  rhythm: "rhythm",
  simulation: "simulation",
  "role-playing": "rolePlaying",
  shooter: "shooter",
  fighting: "fighting",
  platformer: "platformer",
  educational: "educational",
  other: "other",
} as const satisfies Record<string, keyof GameGenreLabels>;

/**
 * Compatibility aliases for previously published, overly-specific official-game genres.
 * New games should put the broad genre in `genre` and specific mechanics in free-form `tags`.
 * Unknown values deliberately pass through so this list never becomes a closed allowlist.
 */
const GENRE_ALIASES: Readonly<Record<string, string>> = {
  typing: "skill-test",
  reaction: "skill-test",
  brain: "skill-test",
  skill: "skill-test",
  aim: "skill-test",
  memory: "skill-test",
  "board-game": "board",
  boardgame: "board",
  "card-board": "board",
  "card-game": "board",
  rpg: "role-playing",
  roleplaying: "role-playing",
};

export function normalizeGameGenreKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/[\s_]+/gu, "-")
    .replace(/-+/gu, "-")
    .toLocaleLowerCase();
}

export function resolveGameGenre(
  rawGenre: string | undefined,
  labels: GameGenreLabels,
  uncategorizedLabel: string,
): ResolvedGameGenre {
  const sourceLabel = rawGenre?.normalize("NFC").trim();
  if (!sourceLabel) return { key: UNCATEGORIZED_KEY, label: uncategorizedLabel };
  if (sourceLabel === UNCATEGORIZED_KEY) {
    return { key: UNCATEGORIZED_KEY, label: uncategorizedLabel };
  }

  const normalized = normalizeGameGenreKey(sourceLabel);
  const key = GENRE_ALIASES[normalized] ?? normalized;
  const labelKey = KNOWN_GENRE_LABEL_KEYS[key as keyof typeof KNOWN_GENRE_LABEL_KEYS];
  return {
    key,
    label: labelKey ? labels[labelKey] : sourceLabel,
  };
}
