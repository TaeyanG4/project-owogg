import { verifyGameSession, gameSessionMatches } from "../domain/gameSession.js";
import {
  normalizeCreatorResult,
  type CreatorReportedResult,
  type NormalizedCreatorResult,
} from "../domain/creatorResult.js";
import { validateDifficultyAgainstDefinition } from "../domain/scoreValidation.js";
import type { GameSettingsRepository } from "../ports/repositories.js";
import type { GameResultAcceptanceRepository } from "../ports/gameResultAcceptance.js";
import type { RuntimeGameRegistry } from "../modules/game/ports/runtimeGameRegistry.js";
import type { RuntimeGameAvailability } from "./runtimeGameAvailability.js";
import type { OwoggAchievementDefinition } from "@owogg/game-sdk/contracts";

export type GameResultAcceptError =
  | "GAME_NOT_AVAILABLE"
  | "GAME_DISABLED"
  | "INVALID_TOKEN"
  | "CONTEXT_MISMATCH"
  | "MANIFEST_NOT_CONFIGURED"
  | "INVALID_DIFFICULTY"
  | "INVALID_RESULT"
  | "ALREADY_CONSUMED";

export type GameResultAcceptResult =
  | {
      readonly ok: true;
      readonly resultId: number;
      readonly scoreId: number | null;
      readonly gameId: number;
      readonly slug: string;
      readonly normalized: NormalizedCreatorResult;
      readonly xpPerCompletion: number;
      readonly achievements: readonly OwoggAchievementDefinition[];
    }
  | { readonly ok: false; readonly error: GameResultAcceptError; readonly reason?: string };

export class GameResultAcceptanceUseCases {
  constructor(
    private readonly runtimeGames: RuntimeGameRegistry,
    private readonly availability: RuntimeGameAvailability,
    private readonly settings: Pick<GameSettingsRepository, "getDisabledGameIds">,
    private readonly acceptanceRepo: GameResultAcceptanceRepository,
  ) {}

  async accept(input: {
    slug: string;
    userId: number;
    nickname: string;
    avatarUrl: string | null;
    token: string;
    secret: string;
    difficulty?: string | undefined;
    result: CreatorReportedResult;
  }): Promise<GameResultAcceptResult> {
    const runtime = await this.runtimeGames.findBySlug(input.slug);
    if (!runtime) return { ok: false, error: "GAME_NOT_AVAILABLE" };
    if ((await this.settings.getDisabledGameIds()).includes(runtime.identity.slug)) {
      return { ok: false, error: "GAME_DISABLED" };
    }
    if (!(await this.availability.isVersionServable(runtime.identity.id, runtime.liveVersion.id))) {
      return { ok: false, error: "GAME_NOT_AVAILABLE" };
    }

    const verified = await verifyGameSession(input.token, input.secret);
    if (!verified.ok) return { ok: false, error: "INVALID_TOKEN" };
    const tokenDifficulty = validateDifficultyAgainstDefinition(
      runtime.canonical.difficulty,
      verified.payload.difficulty,
    );
    const requestedDifficulty = validateDifficultyAgainstDefinition(
      runtime.canonical.difficulty,
      input.difficulty,
    );
    if (!tokenDifficulty.valid || !requestedDifficulty.valid) {
      const reason = tokenDifficulty.reason ?? requestedDifficulty.reason;
      return {
        ok: false,
        error: "INVALID_DIFFICULTY",
        ...(reason ? { reason } : {}),
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

    const manifest = runtime.canonical.creatorManifest;
    if (!manifest) return { ok: false, error: "MANIFEST_NOT_CONFIGURED" };
    const normalized = normalizeCreatorResult(manifest, input.result);
    if (!normalized.valid) {
      return { ok: false, error: "INVALID_RESULT", reason: normalized.reason };
    }

    const write = await this.acceptanceRepo.acceptResult({
      attemptId: verified.payload.attemptId,
      userId: input.userId,
      gameId: runtime.identity.id,
      versionId: runtime.liveVersion.id,
      slug: runtime.identity.slug,
      nickname: input.nickname,
      avatarUrl: input.avatarUrl,
      difficulty: tokenDifficulty.normalizedDifficultyId,
      result: normalized.result,
      leaderboardEnabled: runtime.canonical.policy.leaderboard,
      nowIso: new Date().toISOString(),
    });
    if (!write.accepted || write.resultId === null) {
      return { ok: false, error: "ALREADY_CONSUMED" };
    }

    return {
      ok: true,
      resultId: write.resultId,
      scoreId: write.scoreId,
      gameId: runtime.identity.id,
      slug: runtime.identity.slug,
      normalized: normalized.result,
      xpPerCompletion: runtime.canonical.policy.xpPerCompletion,
      achievements: manifest.achievements ?? [],
    };
  }
}
