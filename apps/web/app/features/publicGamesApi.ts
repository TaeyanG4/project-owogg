import { useEffect, useState } from "react";
import { PublicGameListResponseSchema, PublicGameSchema } from "@owogg/contracts";
import { apiFetch } from "../lib/api/client";

const PUBLIC_GAME_CATALOG_CHANGED_EVENT = "owogg:public-game-catalog-changed";
const PUBLIC_GAME_CATALOG_CHANGED_STORAGE_KEY = "owogg.public-game-catalog.changed";

/**
 * Generic public game reads. The API is the sole catalog/detail authority for both publishers;
 * legacy sandbox endpoints remain available only for compatibility callers.
 */
export function fetchPublicGame(slug: string) {
  return apiFetch(`/api/games/${encodeURIComponent(slug)}`, PublicGameSchema, {
    cache: "no-store",
  });
}

export function fetchPublicGames() {
  return apiFetch("/api/games", PublicGameListResponseSchema, { cache: "no-store" });
}

/** Signals already-open catalog screens after an admin control-plane mutation. The DOM event
 * refreshes the current tab; the storage event reaches other OwOGG tabs without polling. */
export function notifyPublicGameCatalogChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PUBLIC_GAME_CATALOG_CHANGED_EVENT));
  try {
    window.localStorage.setItem(
      PUBLIC_GAME_CATALOG_CHANGED_STORAGE_KEY,
      `${Date.now()}:${Math.random()}`,
    );
  } catch {
    // Storage may be unavailable in privacy modes. The current-tab event and focus refresh remain.
  }
}

/** Shared catalog hook. A failed public read fails closed to an empty catalog; no static registry
 * or sandbox metadata fallback is allowed on the primary production path. */
export function usePublicGames() {
  const [games, setGames] = useState<Awaited<ReturnType<typeof fetchPublicGames>>["games"]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let requestSequence = 0;

    const refresh = () => {
      const sequence = ++requestSequence;
      void fetchPublicGames()
        .then((response) => {
          if (!cancelled && sequence === requestSequence) setGames(response.games);
        })
        .catch(() => {
          if (!cancelled && sequence === requestSequence) setGames([]);
        })
        .finally(() => {
          if (!cancelled && sequence === requestSequence) setIsLoading(false);
        });
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === PUBLIC_GAME_CATALOG_CHANGED_STORAGE_KEY) refresh();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    setIsLoading(true);
    refresh();
    window.addEventListener(PUBLIC_GAME_CATALOG_CHANGED_EVENT, refresh);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      window.removeEventListener(PUBLIC_GAME_CATALOG_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return { games, isLoading };
}
