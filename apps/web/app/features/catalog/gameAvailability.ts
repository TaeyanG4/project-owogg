import { useEffect, useState } from "react";
import {
  PublicGameAvailabilityResponseSchema,
  type PublicGameAvailabilityResponse,
} from "@owogg/contracts";
import { apiFetch } from "../../lib/api";

// Module-level cache so every component calling the hook below shares one fetch instead of each
// issuing its own request — the disabled set rarely changes and is cheap to keep around for the
// lifetime of the page.
let cachedPromise: Promise<PublicGameAvailabilityResponse> | null = null;
type PlatformFeatureSettings = Pick<
  PublicGameAvailabilityResponse,
  "multiplayerEnabled" | "externalPlatformGamesVisible"
>;
const DEFAULT_PLATFORM_FEATURE_SETTINGS: PlatformFeatureSettings = {
  multiplayerEnabled: false,
  externalPlatformGamesVisible: false,
};
let platformSettingsOverride: PlatformFeatureSettings | null = null;
const platformSettingsListeners = new Set<(settings: PlatformFeatureSettings) => void>();

function fetchAvailability(): Promise<PublicGameAvailabilityResponse> {
  cachedPromise ??= apiFetch("/api/games/availability", PublicGameAvailabilityResponseSchema)
    // Fail OPEN: if this one endpoint hiccups, never hide the whole catalog over it — the real
    // enforcement happens server-side. Feature links fail closed because they are optional UI.
    .catch(() => ({
      disabledGameIds: [],
      multiplayerEnabled: false,
      externalPlatformGamesVisible: false,
    }));
  return cachedPromise;
}

/** Makes an administrator's successful kill-switch mutation visible to components in the current
 * SPA immediately. The server still purges the edge cache; this local publication only closes the
 * gap before the next navigation/reload and never invents a value before the PATCH succeeds. */
export function publishPlatformFeatureSettings(settings: PlatformFeatureSettings): void {
  platformSettingsOverride = settings;
  for (const listener of platformSettingsListeners) listener(settings);
}

export function useDisabledGameIds(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void fetchAvailability().then((result) => {
      if (!cancelled) setIds(new Set(result.disabledGameIds));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return ids;
}

export function usePlatformFeatureSettings(): Pick<
  PublicGameAvailabilityResponse,
  "multiplayerEnabled" | "externalPlatformGamesVisible"
> {
  const [settings, setSettings] = useState(
    platformSettingsOverride ?? DEFAULT_PLATFORM_FEATURE_SETTINGS,
  );
  useEffect(() => {
    let cancelled = false;
    const handlePublishedSettings = (next: PlatformFeatureSettings) => {
      if (!cancelled) setSettings(next);
    };
    platformSettingsListeners.add(handlePublishedSettings);
    void fetchAvailability().then((result) => {
      if (!cancelled) {
        setSettings(
          platformSettingsOverride ?? {
            multiplayerEnabled: result.multiplayerEnabled,
            externalPlatformGamesVisible: result.externalPlatformGamesVisible,
          },
        );
      }
    });
    return () => {
      cancelled = true;
      platformSettingsListeners.delete(handlePublishedSettings);
    };
  }, []);
  return settings;
}

export function useIsGameDisabled(gameId: string): boolean {
  const disabled = useDisabledGameIds();
  return disabled.has(gameId);
}
