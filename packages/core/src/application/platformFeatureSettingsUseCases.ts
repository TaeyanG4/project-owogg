import type {
  PlatformFeatureSettings,
  PlatformFeatureSettingsRepository,
} from "../ports/platformFeatureSettings.js";

export class PlatformFeatureSettingsUseCases {
  constructor(private readonly repository: PlatformFeatureSettingsRepository) {}

  get(): Promise<PlatformFeatureSettings> {
    return this.repository.get();
  }

  set(input: {
    multiplayerEnabled?: boolean | undefined;
    externalPlatformGamesVisible?: boolean | undefined;
    adminId: number;
  }): Promise<PlatformFeatureSettings> {
    return this.repository.set({ ...input, nowIso: new Date().toISOString() });
  }
}
