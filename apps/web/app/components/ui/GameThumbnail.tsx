import { useState } from "react";

interface GameThumbnailProps {
  thumbnail: string;
  title: string;
  accent?: string | undefined;
  /** Full control over sizing/effects (e.g. "w-24 h-24 shadow-xl") — no default, every caller
   * states its own size explicitly. */
  className: string;
  rounded?: string | undefined;
}

export function shouldRenderGameThumbnailImage(
  thumbnail: string,
  failedThumbnail: string | null,
): boolean {
  const isValidPath = thumbnail.startsWith("/") || thumbnail.startsWith("http");
  return failedThumbnail !== thumbnail && isValidPath;
}

/** Single source of truth for "how a game's icon renders": the real thumbnail image when its
 * path looks valid and hasn't failed to load, otherwise a colored two-letter badge from the
 * game's accent color. Previously each screen re-implemented this differently — GameCard had the
 * real fallback logic, the per-game ranking page always showed letters even when a thumbnail
 * existed, and the gameplay header showed neither (just a flat color square). */
export function GameThumbnail({
  thumbnail,
  title,
  accent = "#6366f1",
  className,
  rounded = "rounded-2xl",
}: GameThumbnailProps) {
  // Remember the exact URL that failed, not a permanent boolean for this mounted card. A game can
  // be deleted and re-registered under the same slug while the catalog page remains open; the
  // revisioned replacement URL must get a fresh image attempt without requiring a hard reload.
  const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);

  if (shouldRenderGameThumbnailImage(thumbnail, failedThumbnail)) {
    return (
      <img
        src={thumbnail}
        alt={title}
        onError={() => setFailedThumbnail(thumbnail)}
        className={`${className} ${rounded} object-contain`}
      />
    );
  }

  return (
    <div
      className={`${className} ${rounded} flex items-center justify-center text-white font-extrabold`}
      style={{ backgroundColor: accent }}
    >
      {title.slice(0, 2)}
    </div>
  );
}
