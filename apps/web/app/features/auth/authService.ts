import {
  AuthMeResponseSchema,
  AuthProvidersResponseSchema,
  ConnectedProvidersResponseSchema,
  LinkProviderResponseSchema,
  UnlinkProviderResponseSchema,
  MergePreviewPairSchema,
  CreateMergeChallengeResponseSchema,
  ConfirmAccountMergeResponseSchema,
  type AuthMeResponse,
  type AuthUser,
  type ConnectedProvidersResponse,
  type CreateMergeChallengeResponse,
  type LinkProviderResponse,
  type MergePreviewPair,
  type SocialProvider,
  type UnlinkProviderResponse,
  type ConfirmAccountMergeResponse,
} from "@owogg/contracts";
import { API_URL, apiFetch } from "../../lib/api";
import { ApiClientError } from "../../lib/api/errors.js";

export type { AuthUser, AuthMeResponse, SocialProvider };
export type AuthProviderName = SocialProvider;

export interface ProviderStatus {
  availability: "loading" | "ready" | "unavailable";
  google: {
    configured: boolean;
    clientId?: string;
  };
  discord: {
    configured: boolean;
  };
}

export async function fetchProviderStatus(): Promise<ProviderStatus> {
  const data = await apiFetch("/api/auth/providers", AuthProvidersResponseSchema);
  return {
    availability: "ready",
    google: {
      configured: data.google.configured,
      ...(data.google.clientId !== undefined ? { clientId: data.google.clientId } : {}),
    },
    discord: {
      configured: data.discord.configured,
    },
  };
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const data: AuthMeResponse = await apiFetch("/api/auth/me", AuthMeResponseSchema);
    if (data.authenticated && data.user) {
      return data.user;
    }
    return null;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) return null;
    throw error;
  }
}

export async function loginGoogleCode(code: string): Promise<AuthUser> {
  const data: AuthMeResponse = await apiFetch("/api/auth/google/code", AuthMeResponseSchema, {
    method: "POST",
    headers: {
      "X-Requested-With": "XmlHttpRequest",
    },
    body: JSON.stringify({ code }),
  });
  if (data.authenticated && data.user) {
    return data.user;
  }
  throw new Error("Google 로그인에 실패했습니다.");
}

export function getDiscordLoginUrl(): string {
  return `${API_URL}/api/auth/discord`;
}

export async function logoutFromServer(): Promise<void> {
  try {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Ignore network errors on logout
  }
}

// ---------------------------------------------------------------------------
// Account identity: connected providers, linking and unlinking
// ---------------------------------------------------------------------------

export async function fetchConnectedProviders(): Promise<ConnectedProvidersResponse> {
  return apiFetch("/api/auth/accounts", ConnectedProvidersResponseSchema);
}

export async function linkGoogleProvider(credential: string): Promise<LinkProviderResponse> {
  return apiFetch("/api/auth/link/google", LinkProviderResponseSchema, {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
}

export function getDiscordLinkUrl(): string {
  return `${API_URL}/api/auth/link/discord`;
}

export async function unlinkProvider(provider: SocialProvider): Promise<UnlinkProviderResponse> {
  return apiFetch(`/api/auth/link/${provider}`, UnlinkProviderResponseSchema, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Account merge (Primary Account Wins)
// ---------------------------------------------------------------------------

export async function fetchMergePreview(challengeId: string): Promise<MergePreviewPair> {
  return apiFetch(
    `/api/auth/merge/preview?challenge=${encodeURIComponent(challengeId)}`,
    MergePreviewPairSchema,
  );
}

export async function resolveMergeChallenge(
  conflictUserId: number,
  provider: SocialProvider,
): Promise<CreateMergeChallengeResponse> {
  return apiFetch("/api/auth/merge/challenge", CreateMergeChallengeResponseSchema, {
    method: "POST",
    body: JSON.stringify({ conflictUserId, provider }),
  });
}

export async function confirmAccountMerge(
  challengeId: string,
  keepUserId: number,
): Promise<ConfirmAccountMergeResponse> {
  return apiFetch("/api/auth/merge/confirm", ConfirmAccountMergeResponseSchema, {
    method: "POST",
    body: JSON.stringify({ challengeId, keepUserId }),
  });
}
