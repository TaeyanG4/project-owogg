import { verifyGameSession, gameSessionMatches } from "../domain/gameSession.js";
import {
  validateDifficultyAgainstDefinition,
  validateScoreAgainstPolicy,
} from "../domain/scoreValidation.js";
import type { GameSettingsRepository } from "../ports/repositories.js";
import type { GameScoreAcceptanceRepository } from "../ports/gameScoreAcceptance.js";
import type { RuntimeGameRegistry } from "../modules/game/ports/runtimeGameRegistry.js";
import type { RuntimeGameAvailability } from "./runtimeGameAvailability.js";
import type { SelectedTopologyAuthorityGate } from "./selectedTopologyAuthorityGate.js";
import { evaluateClientAuthoredResultFlow } from "./clientAuthoredResultFlowGate.js";

export type GameScoreAcceptError =
  | "GAME_NOT_AVAILABLE"
  | "GAME_DISABLED"
  | "MULTIPLAYER_MANAGED"
  | "MULTIPLAYER_AUTHORITY_UNAVAILABLE"
  | "PLAY_CONFIG_AUTHORITY_UNAVAILABLE"
  | "INVALID_TOKEN"
  | "CONTEXT_MISMATCH"
  | "SCORE_POLICY_NOT_CONFIGURED"
  | "INVALID_DIFFICULTY"
  | "INVALID_SCORE"
  | "ALREADY_CONSUMED";

export type GameScoreAcceptResult =
  | {
      ok: true;
      scoreId: number;
      gameId: number;
      slug: string;
      xpPerCompletion: number;
    }
  | { ok: false; error: GameScoreAcceptError; reason?: string };

/**
 * The single provider-neutral score write path. Every publisher is resolved through the generic
 * runtime registry and canonical document; the legacy sandbox policy adapter is intentionally not
 * consulted here. The repository's batch is the final operation so attempt consumption and score
 * insertion remain one atomic, one-use boundary.
 */
export class GameScoreAcceptanceUseCases {
  constructor(
    private readonly runtimeGames: RuntimeGameRegistry,
    private readonly availability: RuntimeGameAvailability,
    private readonly selectedTopologyAuthority: SelectedTopologyAuthorityGate,
    private readonly settings: Pick<GameSettingsRepository, "getDisabledGameIds">,
    private readonly acceptanceRepo: GameScoreAcceptanceRepository,
  ) {}

  async accept(input: {
    slug: string;
    userId: number;
    nickname: string;
    avatarUrl: string | null;
    token: string;
    secret: string;
    score: number;
    difficulty?: string | undefined;
  }): Promise<GameScoreAcceptResult> {
    const runtime = await this.runtimeGames.findBySlug(input.slug);
    if (!runtime) return { ok: false, error: "GAME_NOT_AVAILABLE" };

    const disabled = await this.settings.getDisabledGameIds();
    if (disabled.includes(runtime.identity.slug)) {
      return { ok: false, error: "GAME_DISABLED" };
    }

    if (!(await this.availability.isVersionServable(runtime.identity.id, runtime.liveVersion.id))) {
      return { ok: false, error: "GAME_NOT_AVAILABLE" };
    }

    const authoritySelection = await this.selectedTopologyAuthority.evaluate(
      runtime.identity.id,
      runtime.liveVersion.id,
    );
    if (!authoritySelection.allowed) return { ok: false, error: authoritySelection.error };

    const clientAuthoredFlow = evaluateClientAuthoredResultFlow(runtime.canonical);
    if (!clientAuthoredFlow.allowed) {
      return { ok: false, error: clientAuthoredFlow.error };
    }

    const verified = await verifyGameSession(input.token, input.secret);
    if (!verified.ok) return { ok: false, error: "INVALID_TOKEN" };

    const tokenDifficulty = validateDifficultyAgainstDefinition(
      runtime.canonical.difficulty,
      verified.payload.difficulty,
    );
    if (!tokenDifficulty.valid) {
      return {
        ok: false,
        error: "INVALID_DIFFICULTY",
        ...(tokenDifficulty.reason ? { reason: tokenDifficulty.reason } : {}),
      };
    }

    const requestedDifficulty = validateDifficultyAgainstDefinition(
      runtime.canonical.difficulty,
      input.difficulty,
    );
    if (!requestedDifficulty.valid) {
      return {
        ok: false,
        error: "INVALID_DIFFICULTY",
        ...(requestedDifficulty.reason ? { reason: requestedDifficulty.reason } : {}),
      };
    }

    if (
      !gameSessionMatches(verified.payload, {
        userId: input.userId,
        gameId: runtime.identity.id,
        versionId: runtime.liveVersion.id,
        difficulty: tokenDifficulty.normalizedDifficultyId,
      }) ||
      requestedDifficulty.normalizedDifficultyId !== tokenDifficulty.normalizedDifficultyId
    ) {
      return { ok: false, error: "CONTEXT_MISMATCH" };
    }

    if (runtime.canonical.policy.score === null) {
      return { ok: false, error: "SCORE_POLICY_NOT_CONFIGURED" };
    }

    const scoreResult = validateScoreAgainstPolicy(runtime.canonical.policy, input.score);
    if (!scoreResult.valid) {
      return {
        ok: false,
        error: "INVALID_SCORE",
        ...(scoreResult.reason ? { reason: scoreResult.reason } : {}),
      };
    }

    const write = await this.acceptanceRepo.acceptScore({
      attemptId: verified.payload.attemptId,
      userId: input.userId,
      gameId: runtime.identity.id,
      versionId: runtime.liveVersion.id,
      slug: runtime.identity.slug,
      nickname: input.nickname,
      avatarUrl: input.avatarUrl,
      score: input.score,
      difficulty: tokenDifficulty.normalizedDifficultyId,
      nowIso: new Date().toISOString(),
    });
    if (!write.accepted || write.scoreId === null) {
      return { ok: false, error: "ALREADY_CONSUMED" };
    }

    return {
      ok: true,
      scoreId: write.scoreId,
      gameId: runtime.identity.id,
      slug: runtime.identity.slug,
      xpPerCompletion: runtime.canonical.policy.xpPerCompletion,
    };
  }
}
