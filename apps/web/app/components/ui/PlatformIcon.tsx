import type { StreamerPlatform } from "@owogg/contracts";
import { useI18n } from "../../features/i18n/I18nContext";
import type { Dictionary } from "../../features/i18n/dictionary";
import {
  isStreamerUiPlatform,
  STREAMER_UI_PLATFORMS,
  type StreamerUiPlatform,
} from "../../features/streamers/streamerPlatforms";

/**
 * Lightweight local SVG badges for the user-facing Streamer platforms — deliberately not
 * emoji (▶️/🟢/🔵/💜) and not a hotlinked third-party image. Each badge is a brand-colored
 * circle with a simple glyph; it is not a pixel-accurate trademark reproduction, just a
 * compact, distinguishable, accessible indicator.
 */
function platformMeta(
  dict: Dictionary["platformIcon"],
): Record<StreamerUiPlatform, { label: string; bg: string; fg: string }> {
  return {
    YOUTUBE: { label: "YouTube", bg: "#FF0000", fg: "#ffffff" },
    CHZZK: { label: dict.chzzkLabel, bg: "#1ECB4F", fg: "#0b1b0f" },
    TWITCH: { label: "Twitch", bg: "#9146FF", fg: "#ffffff" },
  };
}

function PlatformGlyph({ platform }: { platform: StreamerUiPlatform }) {
  if (platform === "YOUTUBE") {
    // Universal "play" triangle — not the trademarked YouTube wordmark/icon, just the shape.
    return (
      <svg viewBox="0 0 24 24" width="55%" height="55%" fill="currentColor" aria-hidden="true">
        <polygon points="8,6 8,18 18,12" />
      </svg>
    );
  }
  const letter = platform === "CHZZK" ? "Z" : "T";
  return (
    <svg viewBox="0 0 24 24" width="70%" height="70%" aria-hidden="true">
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fontSize="15"
        fontWeight="800"
        fontFamily="system-ui, sans-serif"
        fill="currentColor"
      >
        {letter}
      </text>
    </svg>
  );
}

/**
 * A single verified-platform badge. Never render this for an unverified platform account —
 * callers are expected to already filter to `verificationStatus === "VERIFIED"` accounts
 * (the ranking API only ever returns verified platformAccounts in the first place).
 */
export function PlatformIcon({
  platform,
  size = 22,
  href,
  className = "",
}: {
  platform: StreamerPlatform;
  size?: number;
  /** Verified channel URL — when provided, the badge becomes a link that opens the channel. */
  href?: string;
  className?: string;
}) {
  const { dict } = useI18n();
  if (!isStreamerUiPlatform(platform)) return null;

  const meta = platformMeta(dict.platformIcon)[platform];
  const label = `${meta.label} ${dict.platformIcon.channelSuffix}`;

  const badge = (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-full ${className}`}
      style={{ width: size, height: size, backgroundColor: meta.bg, color: meta.fg }}
    >
      <PlatformGlyph platform={platform} />
    </span>
  );

  if (!href) return badge;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className="inline-flex shrink-0 rounded-full transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      {badge}
    </a>
  );
}

/** Compact row of verified-platform badges, ordered YouTube → CHZZK → Twitch regardless
 * of input order, deduplicated by platform. */
export function PlatformIconRow({
  accounts,
  size = 22,
}: {
  accounts: Array<{ platform: StreamerPlatform; channelUrl: string }>;
  size?: number;
}) {
  const { dict } = useI18n();
  const byPlatform = new Map(accounts.map((a) => [a.platform, a] as const));

  const verified = STREAMER_UI_PLATFORMS.map((platform) => byPlatform.get(platform)).filter(
    (account): account is { platform: StreamerPlatform; channelUrl: string } => Boolean(account),
  );

  return (
    <div className="flex items-center gap-1.5" aria-label={dict.platformIcon.verifiedPlatforms}>
      {verified.map((account) => (
        <PlatformIcon
          key={account.platform}
          platform={account.platform}
          size={size}
          href={account.channelUrl}
        />
      ))}
    </div>
  );
}
