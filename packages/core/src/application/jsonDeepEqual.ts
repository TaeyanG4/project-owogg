/**
 * Structural (deep) equality over JSON-safe values — key order never matters (two objects built by
 * different code paths, like a freshly-converted document and one round-tripped through JSON, are
 * not guaranteed to insert keys in the same order). Deliberately hand-rolled rather than
 * `node:util`'s `isDeepStrictEqual`: `packages/core` has to stay runnable inside a Cloudflare
 * Worker, where Node builtins aren't guaranteed.
 *
 * Promoted out of the former Game Creator canonical backfill's private `deepEqualJson` (Stage B-2)
 * — same implementation, unchanged, now shared so Unified Game Platform U-2's generic canonical
 * migration (application/genericCanonicalMigration.ts) doesn't duplicate it. Stage B-2's own
 * `canonicalDocumentsEqual` now delegates here instead of keeping a second copy.
 */
export function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => jsonDeepEqual(value, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj).sort();
    const bKeys = Object.keys(bObj).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key, index) => key === bKeys[index] && jsonDeepEqual(aObj[key], bObj[key]));
  }
  return false;
}
