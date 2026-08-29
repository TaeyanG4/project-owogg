import type {
  MultiplayerMatchPlayerRecord,
  MultiplayerMatchRecord,
} from "../domain/multiplayerMatch.js";

export interface CreatePendingMultiplayerMatchInput {
  readonly matchId: string;
  readonly instanceId: string;
  readonly expectedGeneration: number;
  readonly nowIso: string;
}

export type CreatePendingMultiplayerMatchResult =
  | {
      readonly status: "CREATED" | "REPLAYED";
      readonly match: MultiplayerMatchRecord;
      readonly players: readonly MultiplayerMatchPlayerRecord[];
    }
  | {
      readonly status: "REJECTED";
      readonly code:
        | "INSTANCE_NOT_FOUND"
        | "STALE_GENERATION"
        | "INSTANCE_NOT_STARTING"
        | "PLAYERS_NOT_READY"
        | "IDENTIFIER_CONFLICT"
        | "INTERNAL_RETRYABLE";
    };

export interface MultiplayerMatchRepository {
  createPendingWithPlayers(
    input: CreatePendingMultiplayerMatchInput,
  ): Promise<CreatePendingMultiplayerMatchResult>;
  findMatch(matchId: string): Promise<MultiplayerMatchRecord | null>;
  findMatchByInstanceGeneration(
    instanceId: string,
    generation: number,
  ): Promise<MultiplayerMatchRecord | null>;
  listPlayers(matchId: string): Promise<readonly MultiplayerMatchPlayerRecord[]>;
}
