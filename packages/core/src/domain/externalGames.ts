export const EXTERNAL_GAME_POLICY = {
  MAX_CONCURRENT_REVIEW_SLOTS: 3,
  MAX_SCREENSHOTS: 8,
  MAX_MEDIA_BYTES: 5 * 1024 * 1024,
} as const;

export const EXTERNAL_GAME_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;
export type ExternalGameImageType = (typeof EXTERNAL_GAME_IMAGE_TYPES)[number];
export type ExternalGameMediaKind = "BANNER" | "SCREENSHOT";
export type ExternalGameModerationStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
export type ExternalGameVisibility = "PRIVATE" | "PUBLIC";
export type ExternalGameOwnershipType = "OWN_GAME" | "THIRD_PARTY";

export function isValidExternalGameSlug(value: string): boolean {
  return value.length >= 3 && value.length <= 48 && /^[a-z0-9-]+$/.test(value);
}

export function isSafeExternalGameUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

export function detectExternalGameImageType(bytes: ArrayBuffer): ExternalGameImageType | null {
  const view = new Uint8Array(bytes);
  if (
    view.length >= 8 &&
    view[0] === 0x89 &&
    view[1] === 0x50 &&
    view[2] === 0x4e &&
    view[3] === 0x47 &&
    view[4] === 0x0d &&
    view[5] === 0x0a &&
    view[6] === 0x1a &&
    view[7] === 0x0a
  ) {
    return "image/png";
  }
  if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) {
    return "image/jpeg";
  }
  if (view.length >= 6) {
    const signature = String.fromCharCode(...view.slice(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  if (
    view.length >= 12 &&
    String.fromCharCode(...view.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...view.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  if (view.length >= 16 && String.fromCharCode(...view.slice(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...view.slice(8, 16));
    if (brand.includes("avif") || brand.includes("avis")) return "image/avif";
  }
  return null;
}

export function externalGameMediaObjectKey(
  gameId: number,
  contentHash: string,
  contentType: ExternalGameImageType,
): string {
  const extension: Record<ExternalGameImageType, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif",
  };
  return `external-games/${gameId}/media/${contentHash}.${extension[contentType]}`;
}
