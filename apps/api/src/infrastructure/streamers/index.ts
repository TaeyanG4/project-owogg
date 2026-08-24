import type { StreamerProviderAdapter, StreamerPlatformType } from "@owogg/core";
import { YouTubeStreamerProvider } from "./youtube.js";
import { TwitchStreamerProvider } from "./twitch.js";
import { ChzzkStreamerProvider } from "./chzzk.js";
import { SoopStreamerProvider } from "./soop.js";
import { MockStreamerProvider } from "./mockProvider.js";

export { YouTubeStreamerProvider } from "./youtube.js";
export { TwitchStreamerProvider } from "./twitch.js";
export { ChzzkStreamerProvider } from "./chzzk.js";
export { SoopStreamerProvider } from "./soop.js";
export { MockStreamerProvider } from "./mockProvider.js";

export function getStreamerProviderAdapters(env: {
  YOUTUBE_CLIENT_ID?: string;
  YOUTUBE_CLIENT_SECRET?: string;
  YOUTUBE_API_KEY?: string;
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
  CHZZK_CLIENT_ID?: string;
  CHZZK_CLIENT_SECRET?: string;
  SOOP_CLIENT_ID?: string;
  SOOP_CLIENT_SECRET?: string;
  USE_MOCK_STREAMER_PROVIDERS?: string;
}): Record<StreamerPlatformType, StreamerProviderAdapter> {
  const useMock = env.USE_MOCK_STREAMER_PROVIDERS === "true";

  if (useMock) {
    return {
      YOUTUBE: new MockStreamerProvider("YOUTUBE", true),
      TWITCH: new MockStreamerProvider("TWITCH", true),
      CHZZK: new MockStreamerProvider("CHZZK", true),
      SOOP: new MockStreamerProvider("SOOP", true),
    };
  }

  return {
    YOUTUBE: new YouTubeStreamerProvider(
      env.YOUTUBE_CLIENT_ID,
      env.YOUTUBE_CLIENT_SECRET,
      env.YOUTUBE_API_KEY,
    ),
    TWITCH: new TwitchStreamerProvider(env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET),
    CHZZK: new ChzzkStreamerProvider(env.CHZZK_CLIENT_ID, env.CHZZK_CLIENT_SECRET),
    SOOP: new SoopStreamerProvider(env.SOOP_CLIENT_ID, env.SOOP_CLIENT_SECRET),
  };
}
