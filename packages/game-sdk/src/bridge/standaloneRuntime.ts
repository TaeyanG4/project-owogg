import { connectGameBridge, type GameBridgeClient } from "./client.js";
import type { GameRuntimeContext } from "../react/module.js";
import type { GameResult } from "../contracts/result.js";

/**
 * Adapts a Game Bridge client into the exact `GameRuntimeContext` shape standalone React game
 * builds consume via `GameProps`. This remains reusable SDK support for independently built game
 * bundles; production publication and loading do not depend on a Git game-source workspace.
 *
 * `user` is always `null` and `sessionId` is a throwaway id with no meaning to the host — no
 * auth/token/API address ever crosses into a standalone game bundle. `difficultyId` comes from
 * `client.difficultyId` (set from the host's HOST_INIT bootstrap — see protocol.ts's
 * HostInitMessage) when the host sent one, falling back to `fallbackDifficultyId` for a game with
 * no host-selected difficulty tier.
 */
export function createStandaloneBridgeRuntime(
  client: GameBridgeClient,
  fallbackDifficultyId = "normal",
): GameRuntimeContext {
  return {
    sessionId: crypto.randomUUID(),
    user: null,
    difficultyId: client.difficultyId ?? fallbackDifficultyId,
    emit: (event) => {
      if (event.type === "game_started") client.started();
    },
    complete: async (result: GameResult) => {
      client.complete({
        ...(result.outcome !== undefined ? { outcome: result.outcome } : {}),
        ...(result.score !== undefined ? { score: result.score } : {}),
        ...(result.progression !== undefined ? { progression: result.progression } : {}),
        ...(result.metrics !== undefined ? { metrics: result.metrics } : {}),
        ...(result.metadata ? { metadata: result.metadata } : {}),
      });
    },
    cancel: () => {
      client.cancel();
    },
  };
}

/** Waits for the host's HOST_INIT handshake, then returns a ready-to-use runtime built by
 * {@link createStandaloneBridgeRuntime}. */
export async function connectStandaloneBridgeRuntime(fallbackDifficultyId?: string): Promise<{
  runtime: GameRuntimeContext;
  client: GameBridgeClient;
}> {
  const client = await connectGameBridge();
  // Passing `undefined` explicitly still lets createStandaloneBridgeRuntime's own default
  // parameter ("normal") apply — JS default parameters trigger on an explicit `undefined` the
  // same as an omitted argument.
  return { runtime: createStandaloneBridgeRuntime(client, fallbackDifficultyId), client };
}
