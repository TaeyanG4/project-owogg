import {
  MultiplayerCreateInviteResponseSchema,
  MultiplayerGameAvailabilityResponseSchema,
  MultiplayerRoomResponseSchema,
  MultiplayerRoomRosterResponseSchema,
  MultiplayerRematchResponseSchema,
  type MultiplayerCreateInviteResponse,
  type MultiplayerGameAvailabilityResponse,
  type MultiplayerRoomResponse,
  type MultiplayerRoomRosterResponse,
  type MultiplayerRematchResponse,
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

export function fetchMultiplayerRematchStatus(input: {
  readonly instanceId: string;
  readonly expectedGeneration: number;
}): Promise<MultiplayerRematchResponse> {
  return apiFetch(
    `/api/multiplayer/instances/${encodeURIComponent(input.instanceId)}/rematch?generation=${encodeURIComponent(String(input.expectedGeneration))}`,
    MultiplayerRematchResponseSchema,
    { method: "GET" },
  );
}

export interface MultiplayerRematchRequestInput {
  readonly instanceId: string;
  readonly expectedGeneration: number;
}

interface MultiplayerRematchRecoveryDependencies {
  readonly request?: (input: MultiplayerRematchRequestInput) => Promise<MultiplayerRematchResponse>;
  readonly readStatus?: (
    input: MultiplayerRematchRequestInput,
  ) => Promise<MultiplayerRematchResponse>;
}

function postMultiplayerRematch(
  input: MultiplayerRematchRequestInput,
): Promise<MultiplayerRematchResponse> {
  return apiFetch(
    `/api/multiplayer/instances/${encodeURIComponent(input.instanceId)}/rematch`,
    MultiplayerRematchResponseSchema,
    {
      method: "POST",
      body: JSON.stringify({ expectedGeneration: input.expectedGeneration }),
    },
  );
}

/**
 * Rematch consent is an idempotent, server-authoritative mutation. A D1 commit can succeed even
 * when the browser loses the response or a following read fails transiently. Reconcile that
 * uncertain outcome once before surfacing an error so a successfully started rematch is never
 * presented as failed. This is an error-only read, not polling.
 */
export async function requestMultiplayerRematch(
  input: MultiplayerRematchRequestInput,
  dependencies: MultiplayerRematchRecoveryDependencies = {},
): Promise<MultiplayerRematchResponse> {
  const request = dependencies.request ?? postMultiplayerRematch;
  const readStatus = dependencies.readStatus ?? fetchMultiplayerRematchStatus;
  try {
    return await request(input);
  } catch (requestError) {
    try {
      const authoritative = await readStatus(input);
      if (authoritative.state === "STARTED" || authoritative.requestedBySelf) {
        return authoritative;
      }
    } catch {
      // Preserve the mutation error below. The status read is only an uncertainty reconciliation.
    }
    throw requestError;
  }
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
