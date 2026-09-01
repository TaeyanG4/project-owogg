import {
  UpdateNicknameRequestSchema,
  UpdateNicknameResponseSchema,
  UpdateAvatarPreferenceRequestSchema,
  UpdateAvatarPreferenceResponseSchema,
  UpdateCountryRequestSchema,
  UpdateCountryResponseSchema,
  UpdateVisibilityRequestSchema,
  UpdateVisibilityResponseSchema,
  UpdateProfilePresentationRequestSchema,
  UpdateProfilePresentationResponseSchema,
  PublicProfileResponseSchema,
  ProfileConnectionsResponseSchema,
  ProfileFollowMutationResponseSchema,
  type UpdateNicknameResponse,
  type UpdateAvatarPreferenceResponse,
  type UpdateCountryResponse,
  type UpdateVisibilityResponse,
  type UpdateProfilePresentationResponse,
  type ProfileBanner,
  type PublicProfileResponse,
  type ProfileConnectionsResponse,
  type ProfileFollowMutationResponse,
} from "@owogg/contracts";
import { apiFetch } from "../../lib/api";

export async function updateNicknameApi(nickname: string): Promise<UpdateNicknameResponse> {
  const body = UpdateNicknameRequestSchema.parse({ nickname });
  return await apiFetch("/api/profile/nickname", UpdateNicknameResponseSchema, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateAvatarPreferenceApi(
  provider: "google" | "discord",
): Promise<UpdateAvatarPreferenceResponse> {
  const body = UpdateAvatarPreferenceRequestSchema.parse({ provider });
  return await apiFetch("/api/profile/avatar", UpdateAvatarPreferenceResponseSchema, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/** `country: null` means "설정 안 함(unset)". */
export async function updateCountryApi(country: string | null): Promise<UpdateCountryResponse> {
  const body = UpdateCountryRequestSchema.parse({ country });
  return await apiFetch("/api/profile/country", UpdateCountryResponseSchema, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Controls whether favorites or recent-play activity (list + daily calendar) shows on the
 * PUBLIC profile to other viewers. Data is stored either way; this only changes disclosure. */
export async function updateVisibilityApi(
  showFavorites: boolean,
  showRecentPlays: boolean,
): Promise<UpdateVisibilityResponse> {
  const body = UpdateVisibilityRequestSchema.parse({ showFavorites, showRecentPlays });
  return await apiFetch("/api/profile/visibility", UpdateVisibilityResponseSchema, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/** Public profile page data (no auth, but sends credentials so an authenticated owner viewing
 * their own profile gets their private favorites/recent-plays + visibilitySettings back too —
 * see getPublicProfileData's viewerId param). Throws ApiClientError (404) if unknown userId. */
export async function fetchPublicProfileApi(
  userId: number | string,
): Promise<PublicProfileResponse> {
  return await apiFetch(
    `/api/profile/public/${encodeURIComponent(String(userId))}`,
    PublicProfileResponseSchema,
  );
}

export async function updateProfilePresentationApi(
  banner: ProfileBanner,
  bioMarkdown: string,
): Promise<UpdateProfilePresentationResponse> {
  const body = UpdateProfilePresentationRequestSchema.parse({ banner, bioMarkdown });
  return apiFetch("/api/profile/presentation", UpdateProfilePresentationResponseSchema, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function setProfileFollowApi(
  userId: number,
  following: boolean,
): Promise<ProfileFollowMutationResponse> {
  return apiFetch(
    `/api/profile/follows/${encodeURIComponent(String(userId))}`,
    ProfileFollowMutationResponseSchema,
    { method: following ? "PUT" : "DELETE" },
  );
}

export async function fetchProfileConnectionsApi(
  userId: number | string,
  kind: "followers" | "following",
  page: number,
  pageSize: 10 | 20 | 30 | 50,
): Promise<ProfileConnectionsResponse> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return apiFetch(
    `/api/profile/public/${encodeURIComponent(String(userId))}/${kind}?${query.toString()}`,
    ProfileConnectionsResponseSchema,
  );
}
