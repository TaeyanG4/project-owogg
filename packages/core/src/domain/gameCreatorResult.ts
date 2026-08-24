import type {
  OwoggGameCreatorManifest,
  OwoggMetricDefinition,
  OwoggRangeDefinition,
} from "@owogg/game-sdk/contracts";

export interface GameCreatorReportedResult {
  readonly outcome?: string | undefined;
  readonly score?: number | undefined;
  readonly progression?: { readonly value: number } | undefined;
  readonly metrics?: Readonly<Record<string, number>> | undefined;
  readonly events?: Readonly<Record<string, number>> | undefined;
}

export interface NormalizedGameCreatorResult {
  readonly outcome: string | null;
  readonly rawScore: number | null;
  readonly normalizedScore: number | null;
  readonly progressionValue: number | null;
  readonly metrics: Readonly<Record<string, number>>;
  readonly events: Readonly<Record<string, number>>;
  readonly adjusted: boolean;
  readonly adjustmentReason: string | null;
  readonly rewardEligible: boolean;
}

export type GameCreatorResultNormalization =
  | { readonly valid: true; readonly result: NormalizedGameCreatorResult }
  | { readonly valid: false; readonly reason: string };

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function applyRange(
  value: number,
  range: OwoggRangeDefinition | undefined,
  path: string,
):
  | { valid: true; value: number; adjusted: boolean; reason: string | null }
  | { valid: false; reason: string } {
  if (!range || (value >= range.min && value <= range.max)) {
    return { valid: true, value, adjusted: false, reason: null };
  }
  if (range.outOfRange === "reject") return { valid: false, reason: `${path} is out of range` };
  return {
    valid: true,
    value: Math.min(range.max, Math.max(range.min, value)),
    adjusted: true,
    reason: `${path} was clamped to its declared range`,
  };
}

function validateMetricType(value: number, definition: OwoggMetricDefinition): boolean {
  return definition.type !== "integer" || Number.isInteger(value);
}

/** Validates untrusted completion facts against the exact normalized manifest stored in B2. */
export function normalizeGameCreatorResult(
  manifest: OwoggGameCreatorManifest,
  input: GameCreatorReportedResult,
): GameCreatorResultNormalization {
  const reasons: string[] = [];
  let adjusted = false;

  let outcome: string | null = null;
  if (input.outcome !== undefined) {
    if (!manifest.result.outcome?.values.includes(input.outcome as never)) {
      return { valid: false, reason: "outcome is not declared by owogg.json" };
    }
    outcome = input.outcome;
  }

  let rawScore: number | null = null;
  let normalizedScore: number | null = null;
  if (input.score !== undefined) {
    if (manifest.result.score === null) {
      return { valid: false, reason: "score is not declared by owogg.json" };
    }
    if (!finite(input.score)) return { valid: false, reason: "score must be finite" };
    rawScore = input.score;
    const precision = manifest.result.score.precision;
    const rounded =
      precision === undefined
        ? input.score
        : Math.round(input.score * 10 ** precision) / 10 ** precision;
    const ranged = applyRange(rounded, manifest.result.score.range, "score");
    if (!ranged.valid) return ranged;
    normalizedScore = ranged.value;
    if (ranged.adjusted) {
      adjusted = true;
      if (ranged.reason) reasons.push(ranged.reason);
    }
  }

  let progressionValue: number | null = null;
  if (input.progression !== undefined) {
    if (manifest.progression.type === "none") {
      return { valid: false, reason: "progression is not declared by owogg.json" };
    }
    if (!finite(input.progression.value)) {
      return { valid: false, reason: "progression.value must be finite" };
    }
    const ranged = applyRange(
      input.progression.value,
      manifest.progression.range,
      "progression.value",
    );
    if (!ranged.valid) return ranged;
    progressionValue = ranged.value;
    if (ranged.adjusted) {
      adjusted = true;
      if (ranged.reason) reasons.push(ranged.reason);
    }
  }

  const normalizedMetrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(input.metrics ?? {})) {
    const definition = manifest.result.metrics?.[key];
    if (!definition) return { valid: false, reason: `metric ${key} is not declared by owogg.json` };
    if (!finite(value) || !validateMetricType(value, definition)) {
      return { valid: false, reason: `metric ${key} has an invalid numeric type` };
    }
    const ranged = applyRange(value, definition.range, `metrics.${key}`);
    if (!ranged.valid) return ranged;
    normalizedMetrics[key] = ranged.value;
    if (ranged.adjusted) {
      adjusted = true;
      if (ranged.reason) reasons.push(ranged.reason);
    }
  }

  const normalizedEvents: Record<string, number> = {};
  for (const [key, count] of Object.entries(input.events ?? {})) {
    const definition = manifest.events?.[key];
    if (!definition) return { valid: false, reason: `event ${key} is not declared by owogg.json` };
    if (!Number.isInteger(count) || count < 1) {
      return { valid: false, reason: `event ${key} count must be a positive integer` };
    }
    if (definition.maxPerAttempt !== undefined && count > definition.maxPerAttempt) {
      normalizedEvents[key] = definition.maxPerAttempt;
      adjusted = true;
      reasons.push(`events.${key} was clamped to maxPerAttempt`);
    } else {
      normalizedEvents[key] = count;
    }
  }

  return {
    valid: true,
    result: {
      outcome,
      rawScore,
      normalizedScore,
      progressionValue,
      metrics: normalizedMetrics,
      events: normalizedEvents,
      adjusted,
      adjustmentReason: reasons.length > 0 ? reasons.join("; ") : null,
      rewardEligible: !adjusted,
    },
  };
}
