import type { StreamerPlatform } from "@owogg/contracts";

/**
 * Platforms intentionally exposed by the Streamer UI. SOOP remains a reserved, fail-closed
 * backend provider so old data and callbacks can be handled safely, but it is not a user-facing
 * option until its ownership flow can meet the same security contract as these platforms.
 */
export const STREAMER_UI_PLATFORMS = [
  "YOUTUBE",
  "CHZZK",
  "TWITCH",
] as const satisfies readonly StreamerPlatform[];

export type StreamerUiPlatform = (typeof STREAMER_UI_PLATFORMS)[number];

const STREAMER_UI_PLATFORM_SET = new Set<StreamerPlatform>(STREAMER_UI_PLATFORMS);

export function isStreamerUiPlatform(platform: StreamerPlatform): platform is StreamerUiPlatform {
  return STREAMER_UI_PLATFORM_SET.has(platform);
}

export const STREAMER_UI_PLATFORM_LABELS: Record<StreamerUiPlatform, string> = {
  YOUTUBE: "YouTube",
  CHZZK: "CHZZK",
  TWITCH: "Twitch",
};
