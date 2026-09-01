export interface PlatformFeatureSettings {
  readonly multiplayerEnabled: boolean;
  readonly externalPlatformGamesVisible: boolean;
}

export interface PlatformFeatureSettingsRepository {
  get(): Promise<PlatformFeatureSettings>;
  set(input: {
    multiplayerEnabled?: boolean | undefined;
    externalPlatformGamesVisible?: boolean | undefined;
    adminId: number;
    nowIso: string;
  }): Promise<PlatformFeatureSettings>;
}
