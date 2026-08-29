import {
  canonicalizeGameEvidence,
  type GameEvidenceRejectionCode,
} from "../domain/gameEvidence.js";
import {
  normalizeVerifiedGameCreatorResult,
  type NormalizedGameCreatorResult,
} from "../domain/gameCreatorResult.js";
import {
  verifiedGameSessionMatches,
  verifyVerifiedGameSession,
  type VerifiedGameSessionPlayMode,
} from "../domain/verifiedGameSession.js";
import { publicGamePlayModes } from "../modules/game/domain/publicGame.js";
import type { RuntimeGameRegistry } from "../modules/game/ports/runtimeGameRegistry.js";
import type {
  GameResultVerificationClaimKey,
  GameResultVerificationClaimRepository,
} from "../ports/gameResultVerificationClaims.js";
import type {
  GameVerifierRegistry,
  GameVerifierResult,
  VerifiedGameFacts,
  VerifiedGameOutcome,
} from "../ports/gameVerifier.js";
import type {
  GameVerifiedResultPersistenceRepository,
  PersistedVerifiedGameResult,
} from "../ports/gameVerifiedResultPersistence.js";
import type { GameSettingsRepository } from "../ports/repositories.js";
import type { RuntimeGameAvailability } from "./runtimeGameAvailability.js";
import type { OwoggAchievementDefinition } from "@owogg/game-sdk/contracts";

const REJECTION_CODE = /^[A-Z][A-Z0-9_]{0,95}$/;
const FACT_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const MAX_VERIFIED_FACT_KEYS = 256;
const OUTCOMES = new Set<VerifiedGameOutcome>([
  "neutral",
  "success",
  "failure",
  "win",
  "loss",
  "draw",
]);

export interface GameResultVerificationLease extends GameResultVerificationClaimKey {
  readonly slug: string;
  readonly playMode: VerifiedGameSessionPlayMode;
  readonly difficultyId: string;
  readonly variantId: string;
  readonly rewardFactor: number;
  readonly rulesetRevision: number;
  readonly verifierId: string;
  readonly submittedAtMs: number;
}

export interface GameResultVerificationContext {
  readonly gameId: number;
  readonly versionId: number;
  readonly slug: string;
  readonly leaderboardEnabled: boolean;
  readonly xpPerCompletion: number;
  readonly achievements: readonly OwoggAchievementDefinition[];
}

export type GameResultVerificationError =
  | "GAME_NOT_AVAILABLE"
  | "GAME_DISABLED"
  | "PLAY_CONFIG_NOT_CONFIGURED"
  | "INVALID_TOKEN"
  | "CONTEXT_MISMATCH"
  | "VERIFIER_NOT_REGISTERED"
  | GameEvidenceRejectionCode
  | "CLAIM_AUTHORITY_UNAVAILABLE"
  | "CLAIM_CONFLICT"
  | "VERIFICATION_IN_PROGRESS"
  | "VERIFIER_REJECTED"
  | "VERIFIER_INVALID_OUTPUT"
  | "VERIFIER_EXECUTION_FAILED"
  | "CLAIM_STATE_ERROR";

export type GameResultVerificationPrepareResult =
  | {
      readonly ok: true;
      readonly status: "READY_TO_PERSIST";
      readonly lease: GameResultVerificationLease;
      readonly facts: VerifiedGameFacts;
      readonly normalized: NormalizedGameCreatorResult;
      readonly competitiveScore: number;
      readonly context: GameResultVerificationContext;
    }
  | {
      readonly ok: true;
      readonly status: "ALREADY_VERIFIED";
      readonly resultId: number;
      readonly scoreId: number | null;
      readonly difficultyId: string;
      readonly variantId: string;
      readonly rulesetRevision: number;
      readonly verifierId: string;
      readonly context: GameResultVerificationContext;
    }
  | {
      readonly ok: false;
      readonly error: GameResultVerificationError;
      readonly reason?: string | undefined;
    };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function dataProperties(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, PropertyDescriptor> | null {
  if (!isPlainRecord(value)) return null;
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key)) ||
    new Set(keys).size !== keys.length
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
  }
  return descriptors;
}

function normalizeFactMap(value: unknown): Readonly<Record<string, number>> | null {
  const descriptors = dataProperties(value, isPlainRecord(value) ? Object.keys(value) : []);
  if (!descriptors) return null;
  const keys = Object.keys(descriptors).sort();
  if (keys.length > MAX_VERIFIED_FACT_KEYS) return null;
  const normalized: Record<string, number> = {};
  for (const key of keys) {
    const candidate = descriptors[key]?.value;
    if (!FACT_KEY.test(key) || typeof candidate !== "number" || !Number.isFinite(candidate)) {
      return null;
    }
    Object.defineProperty(normalized, key, {
      value: Object.is(candidate, -0) ? 0 : candidate,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(normalized);
}

type NormalizedVerifierResult =
  | { readonly accepted: true; readonly facts: VerifiedGameFacts }
  | { readonly accepted: false; readonly code: string }
  | null;

/** Revalidates even statically typed trusted implementations so a verifier bug fails closed. */
function normalizeVerifierResult(result: GameVerifierResult | unknown): NormalizedVerifierResult {
  const resultProperties = dataProperties(result, ["accepted", "facts", "diagnostics", "code"]);
  const accepted = resultProperties?.accepted?.value;
  if (!resultProperties || typeof accepted !== "boolean") return null;

  if (!accepted) {
    if (
      Object.keys(resultProperties).some((key) => key !== "accepted" && key !== "code") ||
      typeof resultProperties.code?.value !== "string" ||
      !REJECTION_CODE.test(resultProperties.code.value)
    ) {
      return null;
    }
    return { accepted: false, code: resultProperties.code.value };
  }

  if (
    Object.keys(resultProperties).some(
      (key) => key !== "accepted" && key !== "facts" && key !== "diagnostics",
    )
  ) {
    return null;
  }
  const factProperties = dataProperties(resultProperties.facts?.value, [
    "outcome",
    "score",
    "progression",
    "metrics",
    "events",
  ]);
  if (!factProperties) return null;
  const score = factProperties.score?.value;
  if (typeof score !== "number" || !Number.isFinite(score)) return null;

  const outcome = factProperties.outcome?.value;
  if (
    outcome !== undefined &&
    (typeof outcome !== "string" || !OUTCOMES.has(outcome as VerifiedGameOutcome))
  ) {
    return null;
  }

  let progression: { readonly value: number } | undefined;
  if (factProperties.progression !== undefined) {
    const properties = dataProperties(factProperties.progression.value, ["value"]);
    const value = properties?.value?.value;
    if (
      !properties ||
      Object.keys(properties).length !== 1 ||
      typeof value !== "number" ||
      !Number.isFinite(value)
    ) {
      return null;
    }
    progression = Object.freeze({ value: Object.is(value, -0) ? 0 : value });
  }

  const metrics =
    factProperties.metrics === undefined
      ? undefined
      : normalizeFactMap(factProperties.metrics.value);
  const events =
    factProperties.events === undefined ? undefined : normalizeFactMap(factProperties.events.value);
  if (metrics === null || events === null) return null;

  return {
    accepted: true,
    facts: Object.freeze({
      ...(outcome !== undefined ? { outcome: outcome as VerifiedGameOutcome } : {}),
      score: Object.is(score, -0) ? 0 : score,
      ...(progression !== undefined ? { progression } : {}),
      ...(metrics !== undefined ? { metrics } : {}),
      ...(events !== undefined ? { events } : {}),
    }),
  };
}

/**
 * Resolves and verifies one gs2 submission, but deliberately does not persist game_results/scores.
 * READY_TO_PERSIST is consumed only by GameVerifiedResultAcceptanceUseCases, whose repository
 * writes the result/score and finalizes the claim atomically.
 */
export class GameResultVerificationUseCases {
  constructor(
    private readonly runtimeGames: RuntimeGameRegistry,
    private readonly availability: Pick<RuntimeGameAvailability, "isVersionServable">,
    private readonly settings: Pick<GameSettingsRepository, "getDisabledGameIds">,
    private readonly verifiers: GameVerifierRegistry,
    private readonly claims: GameResultVerificationClaimRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async prepare(input: {
    readonly slug: string;
    readonly userId: number;
    readonly token: string;
    readonly secret: string;
    readonly evidence: unknown;
  }): Promise<GameResultVerificationPrepareResult> {
    const runtime = await this.runtimeGames.findBySlug(input.slug);
    if (!runtime) return { ok: false, error: "GAME_NOT_AVAILABLE" };
    if ((await this.settings.getDisabledGameIds()).includes(runtime.identity.slug)) {
      return { ok: false, error: "GAME_DISABLED" };
    }
    if (!(await this.availability.isVersionServable(runtime.identity.id, runtime.liveVersion.id))) {
      return { ok: false, error: "GAME_NOT_AVAILABLE" };
    }

    const playConfig = runtime.canonical.playConfig;
    const manifest = runtime.canonical.creatorManifest;
    if (!playConfig || !manifest) {
      return { ok: false, error: "PLAY_CONFIG_NOT_CONFIGURED" };
    }
    const context: GameResultVerificationContext = Object.freeze({
      gameId: runtime.identity.id,
      versionId: runtime.liveVersion.id,
      slug: runtime.identity.slug,
      leaderboardEnabled: runtime.canonical.policy.leaderboard,
      xpPerCompletion: runtime.canonical.policy.xpPerCompletion,
      achievements: Object.freeze([...(manifest.achievements ?? [])]),
    });

    const submittedAt = this.now();
    const submittedAtMs = submittedAt.getTime();
    if (!Number.isSafeInteger(submittedAtMs) || submittedAtMs <= 0) {
      return { ok: false, error: "CONTEXT_MISMATCH" };
    }
    const token = await verifyVerifiedGameSession(
      input.token,
      input.secret,
      Math.floor(submittedAtMs / 1_000),
    );
    if (!token.ok) return { ok: false, error: "INVALID_TOKEN" };

    const allowedConfig = playConfig.allowedConfigs.find(
      (candidate) =>
        candidate.difficultyId === token.payload.difficultyId &&
        candidate.variantId === token.payload.variantId,
    );
    if (
      !allowedConfig ||
      token.payload.issuedAtMs > submittedAtMs ||
      !publicGamePlayModes(runtime).includes(token.payload.playMode) ||
      !verifiedGameSessionMatches(token.payload, {
        userId: input.userId,
        gameId: runtime.identity.id,
        versionId: runtime.liveVersion.id,
        playMode: token.payload.playMode,
        difficultyId: allowedConfig.difficultyId,
        variantId: allowedConfig.variantId,
        rewardFactor: allowedConfig.rewardFactor,
        rulesetRevision: playConfig.rulesetRevision,
        verifierId: playConfig.verifierId,
      })
    ) {
      return { ok: false, error: "CONTEXT_MISMATCH" };
    }

    const verifier = this.verifiers.resolve(playConfig.verifierId);
    if (!verifier) return { ok: false, error: "VERIFIER_NOT_REGISTERED" };

    const evidence = await canonicalizeGameEvidence(input.evidence);
    if (!evidence.ok) return { ok: false, error: evidence.code };

    const claimKey: GameResultVerificationClaimKey = {
      attemptId: token.payload.attemptId,
      userId: input.userId,
      gameId: runtime.identity.id,
      versionId: runtime.liveVersion.id,
      evidenceHash: evidence.evidenceHash,
    };
    let claim: Awaited<ReturnType<GameResultVerificationClaimRepository["begin"]>>;
    try {
      claim = await this.claims.begin({ ...claimKey, nowIso: submittedAt.toISOString() });
    } catch {
      return { ok: false, error: "CLAIM_AUTHORITY_UNAVAILABLE" };
    }
    if (claim.status === "CONFLICT") {
      return { ok: false, error: "CLAIM_CONFLICT", reason: claim.reason };
    }
    if (claim.status === "PROCESSING") {
      return { ok: false, error: "VERIFICATION_IN_PROGRESS" };
    }
    if (claim.status === "REJECTED") {
      return { ok: false, error: "VERIFIER_REJECTED", reason: claim.rejectionCode };
    }
    if (claim.status === "VERIFIED") {
      return {
        ok: true,
        status: "ALREADY_VERIFIED",
        resultId: claim.resultId,
        scoreId: claim.scoreId,
        difficultyId: token.payload.difficultyId,
        variantId: token.payload.variantId,
        rulesetRevision: token.payload.rulesetRevision,
        verifierId: token.payload.verifierId,
        context,
      };
    }

    let normalized: NormalizedVerifierResult;
    let terminalCode: "VERIFIER_EXECUTION_FAILED" | "VERIFIER_INVALID_OUTPUT" | null = null;
    try {
      normalized = normalizeVerifierResult(
        await verifier.verify({
          gameId: runtime.identity.id,
          versionId: runtime.liveVersion.id,
          slug: runtime.identity.slug,
          challengeSeed: token.payload.challengeSeed,
          playConfig: {
            difficultyId: token.payload.difficultyId,
            variantId: token.payload.variantId,
          },
          rulesetRevision: token.payload.rulesetRevision,
          issuedAtMs: token.payload.issuedAtMs,
          submittedAtMs,
          serverElapsedMs: submittedAtMs - token.payload.issuedAtMs,
          evidence: evidence.value,
        }),
      );
      if (normalized === null) terminalCode = "VERIFIER_INVALID_OUTPUT";
    } catch {
      normalized = null;
      terminalCode = "VERIFIER_EXECUTION_FAILED";
    }

    const rejectionCode = terminalCode ?? (normalized?.accepted === false ? normalized.code : null);
    if (rejectionCode !== null) {
      let finalized: boolean;
      try {
        finalized = await this.claims.finalizeRejected({
          ...claimKey,
          rejectionCode,
          nowIso: this.now().toISOString(),
        });
      } catch {
        return { ok: false, error: "CLAIM_AUTHORITY_UNAVAILABLE" };
      }
      if (!finalized) return { ok: false, error: "CLAIM_STATE_ERROR" };
      return {
        ok: false,
        error: terminalCode ?? "VERIFIER_REJECTED",
        ...(terminalCode === null ? { reason: rejectionCode } : {}),
      };
    }
    if (!normalized?.accepted) return { ok: false, error: "VERIFIER_INVALID_OUTPUT" };

    const verifiedResult = normalizeVerifiedGameCreatorResult(
      manifest,
      normalized.facts,
      token.payload.rewardFactor,
    );
    if (!verifiedResult.valid) {
      let finalized: boolean;
      try {
        finalized = await this.claims.finalizeRejected({
          ...claimKey,
          rejectionCode: "VERIFIER_INVALID_OUTPUT",
          nowIso: this.now().toISOString(),
        });
      } catch {
        return { ok: false, error: "CLAIM_AUTHORITY_UNAVAILABLE" };
      }
      if (!finalized) return { ok: false, error: "CLAIM_STATE_ERROR" };
      return { ok: false, error: "VERIFIER_INVALID_OUTPUT" };
    }

    return {
      ok: true,
      status: "READY_TO_PERSIST",
      lease: Object.freeze({
        ...claimKey,
        slug: runtime.identity.slug,
        playMode: token.payload.playMode,
        difficultyId: token.payload.difficultyId,
        variantId: token.payload.variantId,
        rewardFactor: token.payload.rewardFactor,
        rulesetRevision: token.payload.rulesetRevision,
        verifierId: token.payload.verifierId,
        submittedAtMs,
      }),
      facts: normalized.facts,
      normalized: verifiedResult.result,
      competitiveScore: verifiedResult.competitiveScore,
      context,
    };
  }

  async finalizeRejected(
    lease: GameResultVerificationLease,
    rejectionCode: string,
  ): Promise<boolean> {
    if (!REJECTION_CODE.test(rejectionCode)) return false;
    return this.claims.finalizeRejected({
      ...lease,
      rejectionCode,
      nowIso: this.now().toISOString(),
    });
  }
}

export type GameVerifiedResultAcceptError =
  GameResultVerificationError | "RESULT_PERSISTENCE_UNAVAILABLE";

export type GameVerifiedResultAcceptResult =
  | {
      readonly ok: true;
      readonly resultId: number;
      readonly scoreId: number | null;
      readonly gameId: number;
      readonly slug: string;
      readonly normalized: NormalizedGameCreatorResult;
      readonly competitiveScore: number;
      readonly difficultyId: string;
      readonly variantId: string;
      readonly rulesetRevision: number;
      readonly verifierId: string;
      readonly xpPerCompletion: number;
      readonly achievements: readonly OwoggAchievementDefinition[];
      readonly replayed: boolean;
    }
  | {
      readonly ok: false;
      readonly error: GameVerifiedResultAcceptError;
      readonly reason?: string | undefined;
    };

/** Completes the verifier coordinator with the one atomic D1 persistence boundary. */
export class GameVerifiedResultAcceptanceUseCases {
  constructor(
    private readonly verification: GameResultVerificationUseCases,
    private readonly persistence: GameVerifiedResultPersistenceRepository,
  ) {}

  async accept(input: {
    readonly slug: string;
    readonly userId: number;
    readonly nickname: string;
    readonly avatarUrl: string | null;
    readonly token: string;
    readonly secret: string;
    readonly evidence: unknown;
  }): Promise<GameVerifiedResultAcceptResult> {
    const prepared = await this.verification.prepare(input);
    if (!prepared.ok) return prepared;

    if (prepared.status === "ALREADY_VERIFIED") {
      let persisted: PersistedVerifiedGameResult | null;
      try {
        persisted = await this.persistence.findVerifiedResult({
          resultId: prepared.resultId,
          userId: input.userId,
          gameId: prepared.context.gameId,
          versionId: prepared.context.versionId,
        });
      } catch {
        return { ok: false, error: "RESULT_PERSISTENCE_UNAVAILABLE" };
      }
      if (
        !persisted ||
        persisted.scoreId !== prepared.scoreId ||
        persisted.difficultyId !== prepared.difficultyId ||
        persisted.variantId !== prepared.variantId ||
        persisted.rulesetRevision !== prepared.rulesetRevision ||
        persisted.verifierId !== prepared.verifierId
      ) {
        return { ok: false, error: "CLAIM_STATE_ERROR" };
      }
      return this.success(prepared.context, persisted, true);
    }

    let write: Awaited<ReturnType<GameVerifiedResultPersistenceRepository["acceptVerifiedResult"]>>;
    try {
      write = await this.persistence.acceptVerifiedResult({
        ...prepared.lease,
        nickname: input.nickname,
        avatarUrl: input.avatarUrl,
        normalized: prepared.normalized,
        competitiveScore: prepared.competitiveScore,
        leaderboardEnabled: prepared.context.leaderboardEnabled,
        nowIso: new Date(prepared.lease.submittedAtMs).toISOString(),
      });
    } catch {
      return { ok: false, error: "RESULT_PERSISTENCE_UNAVAILABLE" };
    }
    if (!write.accepted || write.resultId === null) {
      return { ok: false, error: "CLAIM_STATE_ERROR" };
    }

    return this.success(
      prepared.context,
      {
        resultId: write.resultId,
        scoreId: write.scoreId,
        normalized: prepared.normalized,
        competitiveScore: prepared.competitiveScore,
        difficultyId: prepared.lease.difficultyId,
        variantId: prepared.lease.variantId,
        rulesetRevision: prepared.lease.rulesetRevision,
        verifierId: prepared.lease.verifierId,
      },
      false,
    );
  }

  private success(
    context: GameResultVerificationContext,
    persisted: PersistedVerifiedGameResult,
    replayed: boolean,
  ): GameVerifiedResultAcceptResult {
    return {
      ok: true,
      resultId: persisted.resultId,
      scoreId: persisted.scoreId,
      gameId: context.gameId,
      slug: context.slug,
      normalized: persisted.normalized,
      competitiveScore: persisted.competitiveScore,
      difficultyId: persisted.difficultyId,
      variantId: persisted.variantId,
      rulesetRevision: persisted.rulesetRevision,
      verifierId: persisted.verifierId,
      xpPerCompletion: context.xpPerCompletion,
      achievements: context.achievements,
      replayed,
    };
  }
}
