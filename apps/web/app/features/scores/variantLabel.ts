import type { PublicGame } from "@owogg/contracts";

/** Public canonical labels are presentation authority; unknown ids remain visible and escaped. */
export function leaderboardVariantLabel(
  game: Pick<PublicGame, "playConfig"> | null | undefined,
  variantId: string,
): string {
  const label = game?.playConfig?.variants.find((variant) => variant.id === variantId)?.label;
  if (label) return label;
  return variantId === "standard" ? "Standard" : variantId;
}
