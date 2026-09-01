import { useEffect, useState } from "react";

export const MOBILE_COLUMN_OPTIONS = [2, 3, 4] as const;
export type MobileColumns = (typeof MOBILE_COLUMN_OPTIONS)[number];

export const DESKTOP_COLUMN_OPTIONS = [4, 5, 6] as const;
export type DesktopColumns = (typeof DESKTOP_COLUMN_OPTIONS)[number];

const MOBILE_KEY = "owogg_grid_columns_mobile";
const DESKTOP_KEY = "owogg_grid_columns_desktop";
const DESCRIPTIONS_KEY = "owogg_game_card_descriptions";
const DEFAULT_MOBILE: MobileColumns = 3;
const DEFAULT_DESKTOP: DesktopColumns = 6;

function readStored<T extends number>(key: string, options: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  const parsed = raw ? Number(raw) : NaN;
  return (options as readonly number[]).includes(parsed) ? (parsed as T) : fallback;
}

/** Persists the game grid's column-count preferences to localStorage — separately for mobile
 * (2/3/4, default 3) and desktop (4/5/6, default 6), since the two breakpoints have genuinely
 * different comfortable densities rather than one value scaling to both. Client-only preference —
 * deliberately not synced to the account, same as locale-before-login. Shared by every page that
 * renders <GameGrid> so the choice feels consistent across the site, and scales cleanly as more
 * games are added since it only ever changes layout density, not pagination. */
export function useGridColumns() {
  const [mobileColumns, setMobileColumnsState] = useState<MobileColumns>(DEFAULT_MOBILE);
  const [desktopColumns, setDesktopColumnsState] = useState<DesktopColumns>(DEFAULT_DESKTOP);
  const [showDescriptions, setShowDescriptionsState] = useState(true);

  useEffect(() => {
    setMobileColumnsState(readStored(MOBILE_KEY, MOBILE_COLUMN_OPTIONS, DEFAULT_MOBILE));
    setDesktopColumnsState(readStored(DESKTOP_KEY, DESKTOP_COLUMN_OPTIONS, DEFAULT_DESKTOP));
    setShowDescriptionsState(window.localStorage.getItem(DESCRIPTIONS_KEY) !== "false");
  }, []);

  const setMobileColumns = (next: MobileColumns) => {
    setMobileColumnsState(next);
    if (typeof window !== "undefined") window.localStorage.setItem(MOBILE_KEY, String(next));
  };

  const setDesktopColumns = (next: DesktopColumns) => {
    setDesktopColumnsState(next);
    if (typeof window !== "undefined") window.localStorage.setItem(DESKTOP_KEY, String(next));
  };

  const setShowDescriptions = (next: boolean) => {
    setShowDescriptionsState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DESCRIPTIONS_KEY, String(next));
    }
  };

  return {
    mobileColumns,
    setMobileColumns,
    desktopColumns,
    setDesktopColumns,
    showDescriptions,
    setShowDescriptions,
  };
}
