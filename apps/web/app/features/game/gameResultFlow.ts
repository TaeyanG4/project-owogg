import type { OwoggCompletionPayload } from "@owogg/game-sdk/contracts";

export type GameResultSubmissionState = "idle" | "guest" | "submitting" | "success" | "error";

export interface GameResultFlowDeps {
  slug: string;
  fetchGameSession: (
    slug: string,
    difficulty?: string,
  ) => Promise<{ token: string; expiresAt: string }>;
  acceptResult: (
    slug: string,
    input: OwoggCompletionPayload & {
      token: string;
      events?: Record<string, number>;
      difficulty?: string;
    },
  ) => Promise<{ success: true }>;
}

export interface GameResultFlow {
  startAttempt(authenticated: boolean, difficulty?: string): Promise<void>;
  recordEvent(name: string): void;
  handleComplete(authenticated: boolean, result: OwoggCompletionPayload): Promise<void>;
}

export function createGameResultFlow(
  deps: GameResultFlowDeps,
  callbacks: {
    onStatusChange: (state: GameResultSubmissionState, message?: string) => void;
  },
): GameResultFlow {
  let heldToken: string | null = null;
  let heldDifficulty = "normal";
  let spent = false;
  let generation = 0;
  let events: Record<string, number> = {};

  async function startAttempt(authenticated: boolean, difficulty = "normal"): Promise<void> {
    generation += 1;
    const current = generation;
    heldToken = null;
    heldDifficulty = difficulty;
    spent = false;
    events = {};
    callbacks.onStatusChange("idle");
    if (!authenticated) return;
    try {
      const session = await deps.fetchGameSession(deps.slug, difficulty);
      if (generation === current && !spent) heldToken = session.token;
    } catch {
      if (generation === current && !spent) heldToken = null;
    }
  }

  function recordEvent(name: string): void {
    if (spent) return;
    events[name] = (events[name] ?? 0) + 1;
  }

  async function handleComplete(
    authenticated: boolean,
    result: OwoggCompletionPayload,
  ): Promise<void> {
    const current = generation;
    if (!authenticated) {
      callbacks.onStatusChange("guest");
      return;
    }
    if (spent) return;
    const token = heldToken;
    spent = true;
    heldToken = null;
    if (!token) {
      callbacks.onStatusChange("error");
      return;
    }
    callbacks.onStatusChange("submitting");
    try {
      await deps.acceptResult(deps.slug, {
        token,
        ...(result.outcome !== undefined ? { outcome: result.outcome } : {}),
        ...(result.score !== undefined ? { score: result.score } : {}),
        ...(result.progression !== undefined ? { progression: result.progression } : {}),
        ...(result.metrics !== undefined ? { metrics: result.metrics } : {}),
        ...(Object.keys(events).length > 0 ? { events } : {}),
        difficulty: heldDifficulty,
      });
      if (generation === current) callbacks.onStatusChange("success");
    } catch (error) {
      if (generation === current) {
        callbacks.onStatusChange("error", error instanceof Error ? error.message : undefined);
      }
    }
  }

  return { startAttempt, recordEvent, handleComplete };
}
