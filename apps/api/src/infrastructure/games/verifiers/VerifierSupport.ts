import type { GameVerifierResult } from "@owogg/core";

const UINT32_RANGE = 4_294_967_296;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

export function seedHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash === 0 ? 0x6d2b79f5 : hash;
}

export function randomSource(seed: string): () => number {
  let state = seedHash(seed);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / UINT32_RANGE;
  };
}

export function elapsedMatches(
  clientElapsedMs: number,
  serverElapsedMs: number,
  timing: { readonly maxClockLeadMs: number; readonly maxSubmissionLagMs: number },
): boolean {
  return !(
    clientElapsedMs > serverElapsedMs + timing.maxClockLeadMs ||
    serverElapsedMs - clientElapsedMs > timing.maxSubmissionLagMs
  );
}

export function rejected(code: string): GameVerifierResult {
  return { accepted: false, code };
}
