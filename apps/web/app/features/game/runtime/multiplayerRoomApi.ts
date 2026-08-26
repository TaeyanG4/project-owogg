import {
  MultiplayerCreateInviteResponseSchema,
  MultiplayerGameAvailabilityResponseSchema,
  MultiplayerRoomResponseSchema,
  type MultiplayerCreateInviteResponse,
  type MultiplayerGameAvailabilityResponse,
  type MultiplayerRoomResponse,
} from "@owogg/contracts";
import { apiFetch } from "../../../lib/api/client";

export interface CreateMultiplayerRoomInput {
  readonly gameSlug: string;
  readonly visibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
  readonly joinPolicy: "OPEN" | "INVITE_ONLY";
  readonly idempotencyKey: string;
}

export interface JoinMultiplayerRoomInput {
  readonly publicCode: string;
  readonly inviteToken: string | null;
}

export function fetchMultiplayerGameAvailability(
  gameSlug: string,
): Promise<MultiplayerGameAvailabilityResponse> {
  return apiFetch(
    `/api/multiplayer/games/${encodeURIComponent(gameSlug)}`,
    MultiplayerGameAvailabilityResponseSchema,
    { method: "GET" },
  );
}

export function createMultiplayerRoom(
  input: CreateMultiplayerRoomInput,
): Promise<MultiplayerRoomResponse> {
  return apiFetch("/api/multiplayer/instances", MultiplayerRoomResponseSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function joinMultiplayerRoom(
  input: JoinMultiplayerRoomInput,
): Promise<MultiplayerRoomResponse> {
  return apiFetch("/api/multiplayer/instances/join", MultiplayerRoomResponseSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createMultiplayerInvite(input: {
  readonly instanceId: string;
  readonly expectedGeneration: number;
  readonly idempotencyKey: string;
}): Promise<MultiplayerCreateInviteResponse> {
  return apiFetch(
    `/api/multiplayer/instances/${encodeURIComponent(input.instanceId)}/invites`,
    MultiplayerCreateInviteResponseSchema,
    {
      method: "POST",
      body: JSON.stringify({
        expectedGeneration: input.expectedGeneration,
        idempotencyKey: input.idempotencyKey,
      }),
    },
  );
}

export function leaveMultiplayerRoom(input: {
  readonly instanceId: string;
  readonly expectedGeneration: number;
}): Promise<MultiplayerRoomResponse> {
  return apiFetch(
    `/api/multiplayer/instances/${encodeURIComponent(input.instanceId)}/leave`,
    MultiplayerRoomResponseSchema,
    {
      method: "POST",
      body: JSON.stringify({ expectedGeneration: input.expectedGeneration }),
    },
  );
}
