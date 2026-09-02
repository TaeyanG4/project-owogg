import {
  ExternalGameBookmarkResponseSchema,
  ExternalGameDeleteResponseSchema,
  ExternalGameListResponseSchema,
  ExternalGameMediaSchema,
  ExternalGameMineListResponseSchema,
  ExternalGameRecordSchema,
  type ExternalGameCreateRequest,
  type ExternalGameMediaKind,
  type ExternalGameModerationStatus,
  type ExternalGameUpdateRequest,
  type ExternalGameVisibility,
} from "@owogg/contracts";
import { apiFetch } from "../lib/api/client";
import { API_URL } from "../lib/api/config";
import { ApiClientError } from "../lib/api/errors";

export function fetchExternalGames(
  input: {
    page?: number;
    pageSize?: number;
    sort?: "newest" | "bookmarks";
    search?: string;
  } = {},
) {
  const params = new URLSearchParams({
    page: String(input.page ?? 1),
    pageSize: String(input.pageSize ?? 24),
    sort: input.sort ?? "newest",
    search: input.search ?? "",
  });
  return apiFetch(`/api/external-games?${params}`, ExternalGameListResponseSchema);
}

export function fetchExternalGame(slug: string) {
  return apiFetch(`/api/external-games/${encodeURIComponent(slug)}`, ExternalGameRecordSchema);
}

export function fetchMyExternalGames() {
  return apiFetch("/api/external-games/mine", ExternalGameMineListResponseSchema);
}

export function createExternalGame(input: ExternalGameCreateRequest) {
  return apiFetch("/api/external-games", ExternalGameRecordSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateExternalGame(id: number, input: ExternalGameUpdateRequest) {
  return apiFetch(`/api/external-games/mine/${id}`, ExternalGameRecordSchema, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function submitExternalGame(id: number) {
  return apiFetch(`/api/external-games/mine/${id}/submit`, ExternalGameRecordSchema, {
    method: "POST",
    body: JSON.stringify({ rightsConfirmed: true }),
  });
}

export function withdrawExternalGame(id: number) {
  return apiFetch(`/api/external-games/mine/${id}/withdraw`, ExternalGameRecordSchema, {
    method: "POST",
  });
}

export function deleteExternalGame(id: number) {
  return apiFetch(`/api/external-games/mine/${id}`, ExternalGameDeleteResponseSchema, {
    method: "DELETE",
  });
}

export async function uploadExternalGameMedia(input: {
  gameId: number;
  kind: ExternalGameMediaKind;
  file: File;
  altText?: string;
}) {
  const body = new FormData();
  body.append("kind", input.kind);
  body.append("image", input.file);
  body.append("altText", input.altText ?? "");
  const res = await fetch(`${API_URL}/api/external-games/mine/${input.gameId}/media`, {
    method: "POST",
    credentials: "include",
    body,
  });
  if (!res.ok) throw await apiError(res, "이미지 업로드에 실패했습니다.");
  return ExternalGameMediaSchema.parse(await res.json());
}

export function deleteExternalGameMedia(gameId: number, mediaId: number) {
  return apiFetch(
    `/api/external-games/mine/${gameId}/media/${mediaId}`,
    ExternalGameDeleteResponseSchema,
    { method: "DELETE" },
  );
}

export function setExternalGameBookmark(slug: string, bookmarked: boolean) {
  return apiFetch(
    `/api/external-games/${encodeURIComponent(slug)}/bookmark`,
    ExternalGameBookmarkResponseSchema,
    { method: bookmarked ? "PUT" : "DELETE" },
  );
}

export function fetchAdminExternalGames(
  input: {
    page?: number;
    pageSize?: number;
    status?: ExternalGameModerationStatus;
  } = {},
) {
  const params = new URLSearchParams({
    page: String(input.page ?? 1),
    pageSize: String(input.pageSize ?? 20),
  });
  if (input.status) params.set("status", input.status);
  return apiFetch(`/api/admin/external-games?${params}`, ExternalGameListResponseSchema);
}

export function decideAdminExternalGame(
  id: number,
  decision: "APPROVED" | "REJECTED",
  reason: string | null,
) {
  return apiFetch(
    `/api/admin/external-games/${id}/${decision === "APPROVED" ? "approve" : "reject"}`,
    ExternalGameRecordSchema,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

export function setAdminExternalGameVisibility(id: number, visibility: ExternalGameVisibility) {
  return apiFetch(`/api/admin/external-games/${id}/visibility`, ExternalGameRecordSchema, {
    method: "PATCH",
    body: JSON.stringify({ visibility }),
  });
}

export function deleteAdminExternalGame(id: number, reason: string | null) {
  return apiFetch(`/api/admin/external-games/${id}`, ExternalGameRecordSchema, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  });
}

async function apiError(response: Response, fallback: string): Promise<ApiClientError> {
  let message = fallback;
  let code: string | undefined;
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    message = body.error?.message || message;
    code = body.error?.code;
  } catch {
    // Keep the stable fallback.
  }
  return new ApiClientError("HttpError", message, {
    status: response.status,
    ...(code ? { code } : {}),
  });
}
