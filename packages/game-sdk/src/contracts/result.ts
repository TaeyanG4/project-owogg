import type { OwoggCompletionPayload } from "./gameCreatorManifest.js";

export interface GameResult extends OwoggCompletionPayload {
  readonly gameId: string;
  readonly sessionId: string;
  readonly durationMs: number;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly clientStartedAt: number;
  readonly clientEndedAt: number;
}

export interface GameResultValidation {
  readonly valid: boolean;
  readonly reason?: string | undefined;
}
