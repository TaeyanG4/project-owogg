import {
  GameCreatorMeResponseSchema,
  GameCreatorApplicationRecordSchema,
  SandboxGameListResponseSchema,
  SandboxGameRecordSchema,
  SandboxGameVersionRecordSchema,
  SandboxGameUploadResponseSchema,
  type SandboxGameUploadResponse,
} from "@owogg/contracts";
import { apiFetch } from "../lib/api/client";
import { API_URL } from "../lib/api/config";
import { ApiClientError } from "../lib/api";

/** Game-Creator-facing sandbox game API (the Game Creator Center). Plain-session-gated on the
 * server (apps/api/src/routes/devGames.ts) — never requires the admin step-up flow. GAME_CREATOR
 * is a Program/Entitlement, not a Staff Role — see docs/AUTHORIZATION.md. */

export function fetchDevMe() {
  return apiFetch("/api/dev/me", GameCreatorMeResponseSchema);
}

/** Submits a self-serve Game Creator application. See canApplyForGameCreator's doc comment
 * (packages/core/src/domain/gameCreator.ts) — no OwO Plus gate exists yet, so this is currently
 * open to any logged-in user without an existing application or active access. */
export function applyForGameCreator(message: string | null) {
  return apiFetch("/api/dev/apply", GameCreatorApplicationRecordSchema, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export function withdrawGameCreatorApplication(applicationId: number) {
  return apiFetch(`/api/dev/apply/${applicationId}/withdraw`, GameCreatorApplicationRecordSchema, {
    method: "POST",
  });
}

export function fetchMyGames() {
  return apiFetch("/api/dev/games", SandboxGameListResponseSchema);
}

/** Withdraws a not-yet-decided submission, freeing the review slot it was holding (see
 * SANDBOX_GAME_POLICY.MAX_CONCURRENT_REVIEW_SLOTS). A 409 SUBMISSION_LIMIT_REACHED from an upload
 * attempt is the caller's cue that this — or waiting for a decision — is needed first. */
export function withdrawDevGameSubmission(gameId: number) {
  return apiFetch(`/api/dev/games/${gameId}/withdraw`, SandboxGameRecordSchema, {
    method: "POST",
  });
}

/** Games still occupying one of this developer's limited concurrent review slots — derived
 * client-side from the same list `fetchMyGames` already returns, rather than a dedicated summary
 * endpoint (see SandboxGameRecordSchema.reviewSlot). */
export function countActiveSubmissions(games: Array<{ reviewSlot: 1 | 2 | null }>): number {
  return games.filter((g) => g.reviewSlot !== null).length;
}

/**
 * Creator self-service full removal of their OWN game — only while it has never been approved
 * (see SandboxGameUseCases.deleteOwnGame). Distinct from adminApi.deleteSandboxGame, which is
 * ADMIN/OPERATOR-only and works on any game, approved or not. A raw fetch (not apiFetch) since the
 * route returns a small `{ deleted: true }` acknowledgement rather than a SandboxGameRecord.
 */
export async function deleteDevGame(gameId: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/dev/games/${gameId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    let detail: string | undefined;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      detail = body.error?.message;
      code = body.error?.code;
    } catch {
      // ignore parse failure — fall back to a generic message below
    }
    throw new ApiClientError("HttpError", detail || `삭제에 실패했습니다. (HTTP ${res.status})`, {
      status: res.status,
      ...(code ? { code } : {}),
    });
  }
}

/** Bundle upload is multipart, not JSON — bypasses apiFetch's JSON Content-Type default. */
export async function uploadDevGameVersion(gameId: number, file: File) {
  const form = new FormData();
  form.append("bundle", file);

  const res = await fetch(`${API_URL}/api/dev/games/${gameId}/versions`, {
    method: "POST",
    credentials: "include",
    body: form,
  });

  if (!res.ok) {
    let detail: string | undefined;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      detail = body.error?.message;
      code = body.error?.code;
    } catch {
      // ignore parse failure — fall back to a generic message below
    }
    throw new ApiClientError("HttpError", detail || `업로드에 실패했습니다. (HTTP ${res.status})`, {
      status: res.status,
      ...(code ? { code } : {}),
    });
  }

  const json = await res.json();
  return SandboxGameVersionRecordSchema.parse(json);
}

/**
 * Drag-and-drop registration: a single ZIP whose root contains Creator Manifest v1 `owogg.json`
 * (slug/title/genre) creates the game *and* its first version in one call — see
 * SandboxGameUseCases.createGameFromBundle. Same multipart shape as uploadDevGameVersion, so it
 * shares that function's error-mapping (MANIFEST_MISSING/MANIFEST_INVALID/SLUG_TAKEN etc. all
 * surface as `code` on the thrown ApiClientError).
 */
export async function uploadGameFromBundle(file: File): Promise<SandboxGameUploadResponse> {
  const form = new FormData();
  form.append("bundle", file);

  const res = await fetch(`${API_URL}/api/dev/games/upload`, {
    method: "POST",
    credentials: "include",
    body: form,
  });

  if (!res.ok) {
    let detail: string | undefined;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      detail = body.error?.message;
      code = body.error?.code;
    } catch {
      // ignore parse failure — fall back to a generic message below
    }
    throw new ApiClientError("HttpError", detail || `등록에 실패했습니다. (HTTP ${res.status})`, {
      status: res.status,
      ...(code ? { code } : {}),
    });
  }

  const json = await res.json();
  return SandboxGameUploadResponseSchema.parse(json);
}
