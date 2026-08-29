import {
  MultiplayerCreateInviteResponseSchema,
  MultiplayerGameAvailabilityResponseSchema,
  MultiplayerRoomAdmissionResponseSchema,
  MultiplayerRoomResponseSchema,
  MultiplayerRoomRosterResponseSchema,
  type MultiplayerCreateInviteResponse,
  type MultiplayerGameAvailabilityResponse,
  type MultiplayerRoomAdmissionResponse,
  type MultiplayerRoomResponse,
  type MultiplayerRoomRosterResponse,
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
): Promise<MultiplayerRoomAdmissionResponse> {
  return apiFetch("/api/multiplayer/instances", MultiplayerRoomAdmissionResponseSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function joinMultiplayerRoom(
  input: JoinMultiplayerRoomInput,
): Promise<MultiplayerRoomAdmissionResponse> {
  return apiFetch("/api/multiplayer/instances/join", MultiplayerRoomAdmissionResponseSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchMultiplayerRoomRoster(
  instanceId: string,
): Promise<MultiplayerRoomRosterResponse> {
  return apiFetch(
    `/api/multiplayer/instances/${encodeURIComponent(instanceId)}/roster`,
    MultiplayerRoomRosterResponseSchema,
    { method: "GET" },
  );
}

export function startMultiplayerRoom(input: {
  readonly instanceId: string;
  readonly expectedGeneration: number;
}): Promise<MultiplayerRoomResponse> {
  return apiFetch(
    `/api/multiplayer/instances/${encodeURIComponent(input.instanceId)}/start`,
    MultiplayerRoomResponseSchema,
    {
      method: "POST",
      body: JSON.stringify({ expectedGeneration: input.expectedGeneration }),
    },
  );
}

export function setMultiplayerRoomReady(input: {
  readonly instanceId: string;
  readonly expectedGeneration: number;
  readonly ready: boolean;
}): Promise<MultiplayerRoomResponse> {
  return apiFetch(
    `/api/multiplayer/instances/${encodeURIComponent(input.instanceId)}/ready`,
    MultiplayerRoomResponseSchema,
    {
      method: "POST",
      body: JSON.stringify({
        expectedGeneration: input.expectedGeneration,
        ready: input.ready,
      }),
    },
  );
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
