import { sha256Hex } from "./contentHash.js";

export const MAX_GAME_EVIDENCE_BYTES = 16 * 1024;
export const MAX_GAME_EVIDENCE_DEPTH = 12;
export const MAX_GAME_EVIDENCE_ARRAY_LENGTH = 1_024;
export const MAX_GAME_EVIDENCE_OBJECT_KEYS = 256;
export const MAX_GAME_EVIDENCE_NODES = 4_096;
export const MAX_GAME_EVIDENCE_KEY_LENGTH = 128;

export type GameEvidenceJsonValue =
  | null
  | string
  | number
  | boolean
  | readonly GameEvidenceJsonValue[]
  | { readonly [key: string]: GameEvidenceJsonValue };

export type GameEvidenceRejectionCode =
  | "EVIDENCE_NOT_JSON_SAFE"
  | "EVIDENCE_NON_FINITE_NUMBER"
  | "EVIDENCE_TOO_DEEP"
  | "EVIDENCE_ARRAY_TOO_LONG"
  | "EVIDENCE_OBJECT_TOO_WIDE"
  | "EVIDENCE_TOO_MANY_NODES"
  | "EVIDENCE_KEY_TOO_LONG"
  | "EVIDENCE_CYCLIC"
  | "EVIDENCE_TOO_LARGE";

export type CanonicalGameEvidenceResult =
  | {
      readonly ok: true;
      readonly value: GameEvidenceJsonValue;
      readonly canonicalJson: string;
      readonly byteLength: number;
      readonly evidenceHash: string;
    }
  | { readonly ok: false; readonly code: GameEvidenceRejectionCode };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

interface NormalizeContext {
  readonly ancestors: Set<object>;
  nodeCount: number;
}

type NormalizeResult =
  | { readonly ok: true; readonly value: GameEvidenceJsonValue }
  | { readonly ok: false; readonly code: GameEvidenceRejectionCode };

/**
 * Produces a key-sorted JSON value. Recursion is independently bounded by MAX_GAME_EVIDENCE_DEPTH;
 * node/width limits prevent a shallow but pathologically broad payload from consuming unbounded
 * CPU before the final UTF-8 byte check.
 */
function normalizeEvidence(
  value: unknown,
  depth: number,
  context: NormalizeContext,
): NormalizeResult {
  context.nodeCount += 1;
  if (context.nodeCount > MAX_GAME_EVIDENCE_NODES) {
    return { ok: false, code: "EVIDENCE_TOO_MANY_NODES" };
  }

  if (value === null || typeof value === "boolean") return { ok: true, value };
  if (typeof value === "string") {
    // UTF-8 is never shorter than the UTF-16 code-unit count for an ordinary JS string.
    if (value.length > MAX_GAME_EVIDENCE_BYTES) {
      return { ok: false, code: "EVIDENCE_TOO_LARGE" };
    }
    return { ok: true, value };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { ok: false, code: "EVIDENCE_NON_FINITE_NUMBER" };
    return { ok: true, value: Object.is(value, -0) ? 0 : value };
  }
  if (typeof value !== "object" || value === null) {
    return { ok: false, code: "EVIDENCE_NOT_JSON_SAFE" };
  }
  if (depth >= MAX_GAME_EVIDENCE_DEPTH) {
    return { ok: false, code: "EVIDENCE_TOO_DEEP" };
  }
  if (context.ancestors.has(value)) return { ok: false, code: "EVIDENCE_CYCLIC" };

  context.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_GAME_EVIDENCE_ARRAY_LENGTH) {
        return { ok: false, code: "EVIDENCE_ARRAY_TOO_LONG" };
      }
      const normalized: GameEvidenceJsonValue[] = [];
      for (const item of value) {
        const result = normalizeEvidence(item, depth + 1, context);
        if (!result.ok) return result;
        normalized.push(result.value);
      }
      return { ok: true, value: Object.freeze(normalized) };
    }

    if (!isPlainObject(value)) return { ok: false, code: "EVIDENCE_NOT_JSON_SAFE" };
    let descriptors: Record<string, PropertyDescriptor>;
    try {
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key !== "string")) {
        return { ok: false, code: "EVIDENCE_NOT_JSON_SAFE" };
      }
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      return { ok: false, code: "EVIDENCE_NOT_JSON_SAFE" };
    }
    const keys = Object.keys(descriptors).sort();
    if (keys.length > MAX_GAME_EVIDENCE_OBJECT_KEYS) {
      return { ok: false, code: "EVIDENCE_OBJECT_TOO_WIDE" };
    }

    const normalized: Record<string, GameEvidenceJsonValue> = {};
    for (const key of keys) {
      if (key.length > MAX_GAME_EVIDENCE_KEY_LENGTH) {
        return { ok: false, code: "EVIDENCE_KEY_TOO_LONG" };
      }
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return { ok: false, code: "EVIDENCE_NOT_JSON_SAFE" };
      }
      const result = normalizeEvidence(descriptor.value, depth + 1, context);
      if (!result.ok) return result;
      Object.defineProperty(normalized, key, {
        value: result.value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return { ok: true, value: Object.freeze(normalized) };
  } finally {
    context.ancestors.delete(value);
  }
}

/** Canonically serializes and hashes evidence without retaining the caller's mutable object. */
export async function canonicalizeGameEvidence(
  evidence: unknown,
): Promise<CanonicalGameEvidenceResult> {
  const normalized = normalizeEvidence(evidence, 0, { ancestors: new Set(), nodeCount: 0 });
  if (!normalized.ok) return normalized;

  let canonicalJson: string;
  try {
    canonicalJson = JSON.stringify(normalized.value);
  } catch {
    return { ok: false, code: "EVIDENCE_NOT_JSON_SAFE" };
  }
  const bytes = new TextEncoder().encode(canonicalJson);
  if (bytes.byteLength > MAX_GAME_EVIDENCE_BYTES) {
    return { ok: false, code: "EVIDENCE_TOO_LARGE" };
  }
  return {
    ok: true,
    value: normalized.value,
    canonicalJson,
    byteLength: bytes.byteLength,
    evidenceHash: await sha256Hex(bytes.slice().buffer as ArrayBuffer),
  };
}
