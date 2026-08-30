import { z } from "zod";
import {
  AdminMeResponseSchema,
  AdminOverviewResponseSchema,
  AdminMonitoringResponseSchema,
  AdminGoogleStepUpResponseSchema,
  AdminLoginResponseSchema,
  AdminBootstrapRequestSchema,
  AdminBootstrapResponseSchema,
  AdminPasswordChangeRequestSchema,
  AdminPasswordChangeResponseSchema,
  AdminAccountListResponseSchema,
  AdminAccountCreateRequestSchema,
  AdminAccountAuditListResponseSchema,
  AdminGameListResponseSchema,
  AdminGameCatalogRoleResponseSchema,
  type AdminGameCatalogRole,
  AdminGameToggleResponseSchema,
  AdminManagedMultiplayerExactVersionResponseSchema,
  AdminManagedMultiplayerProfileReviewResponseSchema,
  AdminManagedMultiplayerProfileActivationResponseSchema,
  AdminOfficialGameDeleteResponseSchema,
  AdminOfficialGameUploadResponseSchema,
  GameLogoUpdateResponseSchema,
  AdminUserSearchResponseSchema,
  AdminUserDetailResponseSchema,
  UserModerationRecordSchema,
  AdminScoreActionResponseSchema,
  PermissionSchema,
  type PermissionValue,
  ConfigurableStaffRoleSchema,
  RolePermissionPolicyListResponseSchema,
  RolePermissionPolicySchema,
  type ConfigurableStaffRoleValue,
  GameCreatorAccessListResponseSchema,
  GameCreatorAccessRecordSchema,
  GameCreatorApplicationListResponseSchema,
  GameCreatorApplicationRecordSchema,
  SandboxGameReviewQueueResponseSchema,
  SandboxGameVersionRecordSchema,
  SandboxGameRecordSchema,
  SandboxGameDetailResponseSchema,
  AdminSandboxGameListResponseSchema,
  type AdminAccountRoleValue,
  type AdminAccountStatusValue,
  type AdminUserPeriod,
  type AdminUserSort,
  type UserSuspensionDurationDays,
  type SandboxGameMetadataUpdateRequest,
  type SandboxGameBasicMetadataUpdateRequest,
  type SandboxGameVisibility,
} from "@owogg/contracts";
import { apiFetch } from "../lib/api/client";
import { API_URL } from "../lib/api/config";
import { ApiClientError } from "../lib/api/errors";
import { notifyPublicGameCatalogChanged } from "./publicGamesApi";

const AdminLogoutResponseSchema = z.object({ success: z.boolean() });
const AdminSuccessResponseSchema = z.object({ success: z.boolean() });
export const ADMIN_SESSION_CHANGED_EVENT = "owogg:admin-session-changed";

function notifyAdminSessionChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ADMIN_SESSION_CHANGED_EVENT));
}

async function refreshCatalogAfter<T>(request: Promise<T>): Promise<T> {
  const result = await request;
  notifyPublicGameCatalogChanged();
  return result;
}
const AdminAccountSummaryOnCreateSchema = z.object({
  id: z.number(),
  userId: z.number(),
  nickname: z.string(),
  username: z.string(),
  role: z.enum(["ADMIN", "OPERATOR", "MODERATOR", "SYSTEM_DEVELOPER"]),
  status: z.enum(["ACTIVE", "DISABLED"]),
  mustChangePassword: z.boolean(),
  createdAt: z.string(),
  passwordChangedAt: z.string(),
  isSelf: z.boolean(),
});

export function fetchAdminMe() {
  return apiFetch("/api/admin/me", AdminMeResponseSchema);
}

export function fetchAdminOverview() {
  return apiFetch("/api/admin/overview", AdminOverviewResponseSchema);
}

export function fetchAdminMonitoring() {
  return apiFetch("/api/admin/monitoring", AdminMonitoringResponseSchema);
}

export function postAdminGoogleStepUp(credential: string) {
  return apiFetch("/api/admin/auth/google", AdminGoogleStepUpResponseSchema, {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
}

export async function postAdminLogin(username: string, password: string) {
  const result = await apiFetch("/api/admin/auth/login", AdminLoginResponseSchema, {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  notifyAdminSessionChanged();
  return result;
}

export async function postAdminLogout() {
  const result = await apiFetch("/api/admin/auth/logout", AdminLogoutResponseSchema, {
    method: "POST",
  });
  notifyAdminSessionChanged();
  return result;
}

export async function postAdminBootstrap(input: {
  username: string;
  password: string;
  passwordConfirm: string;
}) {
  const body = AdminBootstrapRequestSchema.parse(input);
  const result = await apiFetch("/api/admin/bootstrap", AdminBootstrapResponseSchema, {
    method: "POST",
    body: JSON.stringify(body),
  });
  notifyAdminSessionChanged();
  return result;
}

export async function postAdminPasswordChange(input: {
  currentPassword: string;
  newPassword: string;
  newPasswordConfirm: string;
}) {
  const body = AdminPasswordChangeRequestSchema.parse(input);
  const result = await apiFetch("/api/admin/settings/password", AdminPasswordChangeResponseSchema, {
    method: "POST",
    body: JSON.stringify(body),
  });
  notifyAdminSessionChanged();
  return result;
}

export function fetchAdminAccounts() {
  return apiFetch("/api/admin/accounts", AdminAccountListResponseSchema);
}

export function fetchAdminAccountAudit() {
  return apiFetch("/api/admin/accounts/audit", AdminAccountAuditListResponseSchema);
}

export function postCreateAdminAccount(input: {
  userId: number;
  username: string;
  password: string;
  role: AdminAccountRoleValue;
}) {
  const body = AdminAccountCreateRequestSchema.parse(input);
  return apiFetch("/api/admin/accounts", AdminAccountSummaryOnCreateSchema, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function patchAdminAccountStatus(id: number, status: AdminAccountStatusValue) {
  return apiFetch(`/api/admin/accounts/${id}/status`, AdminSuccessResponseSchema, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function patchAdminAccountRole(id: number, role: AdminAccountRoleValue) {
  return apiFetch(`/api/admin/accounts/${id}/role`, AdminSuccessResponseSchema, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export function postResetAdminAccountPassword(id: number, newPassword: string) {
  return apiFetch(`/api/admin/accounts/${id}/reset-password`, AdminSuccessResponseSchema, {
    method: "POST",
    body: JSON.stringify({ newPassword }),
  });
}

export function postRevokeAdminAccountSessions(id: number) {
  return apiFetch(`/api/admin/accounts/${id}/revoke-sessions`, AdminSuccessResponseSchema, {
    method: "POST",
  });
}

// ── Individual permission delegation (e.g. admin.center.access for a trusted SYSTEM_DEVELOPER —
// see docs/AUTHORIZATION.md) ──

const AdminPermissionListResponseSchema = z.object({ permissions: z.array(PermissionSchema) });

export function fetchAdminAccountPermissions(id: number) {
  return apiFetch(`/api/admin/accounts/${id}/permissions`, AdminPermissionListResponseSchema);
}

export function postGrantAdminPermission(id: number, permission: PermissionValue) {
  return apiFetch(`/api/admin/accounts/${id}/permissions`, AdminSuccessResponseSchema, {
    method: "POST",
    body: JSON.stringify({ permission }),
  });
}

export function deleteRevokeAdminPermission(id: number, permission: PermissionValue) {
  return apiFetch(
    `/api/admin/accounts/${id}/permissions/${permission}`,
    AdminSuccessResponseSchema,
    {
      method: "DELETE",
    },
  );
}

// ── Role-level functional policies (managed ADMIN only) ──

export function fetchAdminRolePermissions() {
  return apiFetch("/api/admin/role-permissions", RolePermissionPolicyListResponseSchema);
}

export function putAdminRolePermissions(
  role: ConfigurableStaffRoleValue,
  permissions: PermissionValue[],
) {
  const safeRole = ConfigurableStaffRoleSchema.parse(role);
  return apiFetch(`/api/admin/role-permissions/${safeRole}`, RolePermissionPolicySchema, {
    method: "PUT",
    body: JSON.stringify({ permissions }),
  });
}

export function fetchAdminGames(
  page = 1,
  pageSize: 10 | 20 | 30 = 10,
  catalogRole: AdminGameCatalogRole = "GAME",
) {
  return apiFetch(
    `/api/admin/games?page=${page}&pageSize=${pageSize}&catalogRole=${catalogRole}`,
    AdminGameListResponseSchema,
    { method: "GET", cache: "no-store" },
  );
}

export function fetchManagedMultiplayerExactVersion(gameSlug: string) {
  return apiFetch(
    `/api/admin/games/${encodeURIComponent(gameSlug)}/multiplayer-control`,
    AdminManagedMultiplayerExactVersionResponseSchema,
    { method: "GET", cache: "no-store" },
  );
}

export function postManagedMultiplayerProfileReview(requestId: number) {
  return apiFetch(
    `/api/admin/games/multiplayer-requests/${requestId}/review`,
    AdminManagedMultiplayerProfileReviewResponseSchema,
    {
      method: "POST",
      body: JSON.stringify({ decision: "APPROVED" }),
    },
  );
}

export function postManagedMultiplayerProfileActivation(
  profileId: number,
  enabled: boolean,
  reasonCode: string | null,
) {
  return apiFetch(
    `/api/admin/games/multiplayer-profiles/${profileId}/activation`,
    AdminManagedMultiplayerProfileActivationResponseSchema,
    {
      method: "POST",
      body: JSON.stringify({ enabled, reasonCode }),
    },
  );
}

export function postAdminGameCatalogRole(gameId: string, catalogRole: AdminGameCatalogRole) {
  return refreshCatalogAfter(
    apiFetch(`/api/admin/games/${gameId}/catalog-role`, AdminGameCatalogRoleResponseSchema, {
      method: "POST",
      body: JSON.stringify({ catalogRole }),
    }),
  );
}

export function postToggleAdminGame(gameId: string, enabled: boolean, reason: string | null) {
  return refreshCatalogAfter(
    apiFetch(`/api/admin/games/${gameId}/toggle`, AdminGameToggleResponseSchema, {
      method: "POST",
      body: JSON.stringify({ enabled, reason }),
    }),
  );
}

export async function uploadOfficialGame(file: File) {
  const form = new FormData();
  form.append("bundle", file);
  const res = await fetch(`${API_URL}/api/admin/games/upload`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    let detail: string | undefined;
    let code: string | undefined;
    let retryAfterSeconds: number | undefined;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string; retryAfterSeconds?: number };
      };
      detail = body.error?.message;
      code = body.error?.code;
      retryAfterSeconds = body.error?.retryAfterSeconds;
    } catch {
      // Keep the HTTP fallback below when the response is not JSON.
    }
    const retryAfterHeader = Number.parseInt(res.headers.get("Retry-After") ?? "", 10);
    if (retryAfterSeconds === undefined && Number.isFinite(retryAfterHeader)) {
      retryAfterSeconds = retryAfterHeader;
    }
    throw new ApiClientError("HttpError", detail || `업로드에 실패했습니다. (HTTP ${res.status})`, {
      status: res.status,
      ...(code ? { code } : {}),
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    });
  }
  const result = AdminOfficialGameUploadResponseSchema.parse(await res.json());
  notifyPublicGameCatalogChanged();
  return result;
}

async function uploadAdminGameFile<T>(input: {
  url: string;
  field: "bundle" | "manifest" | "logo";
  file: File;
  parse: (value: unknown) => T;
}): Promise<T> {
  const form = new FormData();
  form.append(input.field, input.file);
  const res = await fetch(`${API_URL}${input.url}`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    let detail: string | undefined;
    let code: string | undefined;
    let retryAfterSeconds: number | undefined;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string; retryAfterSeconds?: number };
      };
      detail = body.error?.message;
      code = body.error?.code;
      retryAfterSeconds = body.error?.retryAfterSeconds;
    } catch {
      // Keep the HTTP fallback below.
    }
    const retryAfterHeader = Number.parseInt(res.headers.get("Retry-After") ?? "", 10);
    if (retryAfterSeconds === undefined && Number.isFinite(retryAfterHeader)) {
      retryAfterSeconds = retryAfterHeader;
    }
    throw new ApiClientError(
      "HttpError",
      detail || `재업로드에 실패했습니다. (HTTP ${res.status})`,
      {
        status: res.status,
        ...(code ? { code } : {}),
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      },
    );
  }
  const result = input.parse(await res.json());
  notifyPublicGameCatalogChanged();
  return result;
}

export function replaceOfficialGameManifest(slug: string, file: File) {
  return uploadAdminGameFile({
    url: `/api/admin/games/${encodeURIComponent(slug)}/manifest`,
    field: "manifest",
    file,
    parse: (value) => AdminOfficialGameUploadResponseSchema.parse(value),
  });
}

export function replaceOfficialGameBundle(slug: string, file: File) {
  return uploadAdminGameFile({
    url: `/api/admin/games/${encodeURIComponent(slug)}/bundle`,
    field: "bundle",
    file,
    parse: (value) => AdminOfficialGameUploadResponseSchema.parse(value),
  });
}

export function replaceOfficialGameLogo(slug: string, file: File) {
  return uploadAdminGameFile({
    url: `/api/admin/games/${encodeURIComponent(slug)}/logo`,
    field: "logo",
    file,
    parse: (value) => GameLogoUpdateResponseSchema.parse(value),
  });
}

export function patchOfficialGameBasicMetadata(
  slug: string,
  input: SandboxGameBasicMetadataUpdateRequest,
) {
  return refreshCatalogAfter(
    apiFetch(
      `/api/admin/games/${encodeURIComponent(slug)}/basic-metadata`,
      AdminOfficialGameUploadResponseSchema,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  );
}

export function deleteOfficialGame(gameId: string) {
  return refreshCatalogAfter(
    apiFetch(
      `/api/admin/games/${encodeURIComponent(gameId)}`,
      AdminOfficialGameDeleteResponseSchema,
      { method: "DELETE" },
    ),
  );
}

export interface AdminUserListParams {
  query?: string | undefined;
  period?: AdminUserPeriod | undefined;
  sort?: AdminUserSort | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export function fetchAdminUserList(params: AdminUserListParams) {
  const search = new URLSearchParams();
  if (params.query) search.set("query", params.query);
  if (params.period) search.set("period", params.period);
  if (params.sort) search.set("sort", params.sort);
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  return apiFetch(`/api/admin/users?${search.toString()}`, AdminUserSearchResponseSchema);
}

export function fetchAdminUserDetail(userId: number) {
  return apiFetch(`/api/admin/users/${userId}`, AdminUserDetailResponseSchema);
}

export function postSuspendUser(
  userId: number,
  durationDays: UserSuspensionDurationDays,
  reason: string,
) {
  return apiFetch(`/api/admin/users/${userId}/suspend`, UserModerationRecordSchema, {
    method: "POST",
    body: JSON.stringify({ durationDays, reason }),
  });
}

export function postBanUser(userId: number, reason: string) {
  return apiFetch(`/api/admin/users/${userId}/ban`, UserModerationRecordSchema, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function postUnsuspendUser(userId: number) {
  return apiFetch(`/api/admin/users/${userId}/unsuspend`, UserModerationRecordSchema, {
    method: "POST",
  });
}

export function postScoreSubmissionBlock(userId: number, blocked: boolean, reason: string | null) {
  return apiFetch(`/api/admin/users/${userId}/score-submission-block`, UserModerationRecordSchema, {
    method: "POST",
    body: JSON.stringify({ blocked, reason }),
  });
}

export function postResetUserScores(userId: number, reason: string) {
  return apiFetch(`/api/admin/users/${userId}/reset-scores`, AdminScoreActionResponseSchema, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function postRestoreUserScores(userId: number) {
  return apiFetch(`/api/admin/users/${userId}/restore-scores`, AdminScoreActionResponseSchema, {
    method: "POST",
  });
}

// ── Game Creator program (admin-direct grant/revoke + application review) ──

export function fetchGameCreators() {
  return apiFetch("/api/admin/game-creators", GameCreatorAccessListResponseSchema);
}

export function postGrantGameCreator(userId: number) {
  return apiFetch("/api/admin/game-creators", GameCreatorAccessRecordSchema, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export function postRevokeGameCreator(userId: number) {
  return apiFetch(`/api/admin/game-creators/${userId}/revoke`, GameCreatorAccessRecordSchema, {
    method: "POST",
  });
}

export function fetchGameCreatorApplications(page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  return apiFetch(
    `/api/admin/game-creators/applications?page=${page}&pageSize=${pageSize}&offset=${offset}`,
    GameCreatorApplicationListResponseSchema,
  );
}

export function postApproveGameCreatorApplication(applicationId: number) {
  return apiFetch(
    `/api/admin/game-creators/applications/${applicationId}/approve`,
    GameCreatorApplicationRecordSchema,
    { method: "POST" },
  );
}

export function postRejectGameCreatorApplication(applicationId: number, rejectReason: string) {
  return apiFetch(
    `/api/admin/game-creators/applications/${applicationId}/reject`,
    GameCreatorApplicationRecordSchema,
    { method: "POST", body: JSON.stringify({ rejectReason }) },
  );
}

// ── Sandbox games (review queue, publish, generalized metadata) ──

export function fetchSandboxReviewQueue(page = 1, pageSize = 20) {
  return apiFetch(
    `/api/admin/sandbox-games/review-queue?page=${page}&pageSize=${pageSize}`,
    SandboxGameReviewQueueResponseSchema,
  );
}

/** Every non-deleted game, regardless of developer/visibility — powers the admin "게임 관리" list
 * (activate/deactivate without needing to already know a game's id). */
export function fetchAllSandboxGames(page = 1, pageSize: 10 | 20 | 30 = 10) {
  return apiFetch(
    `/api/admin/sandbox-games?page=${page}&pageSize=${pageSize}`,
    AdminSandboxGameListResponseSchema,
  );
}

export function fetchAdminSandboxGameDetail(id: number) {
  return apiFetch(`/api/admin/sandbox-games/${id}`, SandboxGameDetailResponseSchema);
}

export function uploadAdminSandboxGameVersion(id: number, file: File) {
  return uploadAdminGameFile({
    url: `/api/admin/sandbox-games/${id}/versions`,
    field: "bundle",
    file,
    parse: (value) => SandboxGameVersionRecordSchema.parse(value),
  });
}

export function replaceAdminSandboxGameManifest(id: number, file: File) {
  return uploadAdminGameFile({
    url: `/api/admin/sandbox-games/${id}/manifest`,
    field: "manifest",
    file,
    parse: (value) => SandboxGameVersionRecordSchema.parse(value),
  });
}

export function replaceAdminSandboxGameLogo(id: number, file: File) {
  return uploadAdminGameFile({
    url: `/api/admin/sandbox-games/${id}/logo`,
    field: "logo",
    file,
    parse: (value) => GameLogoUpdateResponseSchema.parse(value),
  });
}

export function postApproveSandboxVersion(versionId: number) {
  return apiFetch(
    `/api/admin/sandbox-games/versions/${versionId}/approve`,
    SandboxGameVersionRecordSchema,
    { method: "POST" },
  );
}

export function postRejectSandboxVersion(versionId: number, reason: string) {
  return apiFetch(
    `/api/admin/sandbox-games/versions/${versionId}/reject`,
    SandboxGameVersionRecordSchema,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

/** Reverts an APPROVED decision back to PENDING_REVIEW ("승인 결정 자체를 취소") — undoing a
 * mistaken approval. If the version was the game's live version, the game is forced back to
 * PRIVATE server-side in the same call. */
export function postRevokeSandboxVersion(versionId: number, reason: string | null) {
  return refreshCatalogAfter(
    apiFetch(
      `/api/admin/sandbox-games/versions/${versionId}/revoke`,
      SandboxGameVersionRecordSchema,
      { method: "POST", body: JSON.stringify({ reason }) },
    ),
  );
}

export function patchSandboxGameMetadata(id: number, input: SandboxGameMetadataUpdateRequest) {
  return refreshCatalogAfter(
    apiFetch(`/api/admin/sandbox-games/${id}/metadata`, SandboxGameRecordSchema, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  );
}

export function patchSandboxGameVisibility(id: number, visibility: SandboxGameVisibility) {
  return refreshCatalogAfter(
    apiFetch(`/api/admin/sandbox-games/${id}/visibility`, SandboxGameRecordSchema, {
      method: "PATCH",
      body: JSON.stringify({ visibility }),
    }),
  );
}

/** Soft-deletes a sandbox game (migration 0026) — requires `sandbox_games.delete`, ADMIN/OPERATOR
 * only (MODERATOR has review but not delete, see docs/AUTHORIZATION.md). Forces the game back to
 * PRIVATE server-side; the row itself is kept for audit, not hard-deleted. */
export function deleteSandboxGame(id: number) {
  return refreshCatalogAfter(
    apiFetch(`/api/admin/sandbox-games/${id}`, SandboxGameRecordSchema, {
      method: "DELETE",
    }),
  );
}

/** Permanently erases an already-soft-deleted, never-approved sandbox draft. Approval history
 * permanently reserves the slug and makes this operation return 409. */
export function purgeSandboxGame(id: number) {
  return refreshCatalogAfter(
    apiFetch(`/api/admin/sandbox-games/${id}/purge`, z.object({ purged: z.literal(true) }), {
      method: "DELETE",
    }),
  );
}
