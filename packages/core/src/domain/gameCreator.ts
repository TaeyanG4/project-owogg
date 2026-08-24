import type { StaffRole } from "./staffRoles.js";

/**
 * Game Creator program policy (pure domain constants). No D1/Hono here — persistence lives in
 * packages/db, HTTP wiring lives in apps/api. See docs/AUTHORIZATION.md and
 * docs/GAME_CREATION_GUIDE.md §3.6.
 *
 * GAME_CREATOR is deliberately NOT a Staff Role (see domain/staffRoles.ts) — a game creator is a
 * regular OwOGG user approved to use the sandbox game upload/publish pipeline, never an
 * administrator, and never gets a password/Google step-up session. This module's two record
 * types capture the two things that can be true about a user's relationship to the program:
 *
 *   - {@link GameCreatorAccessStatus}: do they currently have upload access at all (ACTIVE), or
 *     did they once and had it taken away (REVOKED)? A missing row means "never granted".
 *   - {@link GameCreatorApplicationStatus}: the self-serve "please approve me" request a user can
 *     submit, independent of the admin-direct grant path (GameCreatorUseCases.grant) that
 *     predates this file and still works unchanged — an admin/operator can still invite someone
 *     directly without them ever filing an application.
 */

export const GAME_CREATOR_ACCESS_STATUSES = ["ACTIVE", "REVOKED"] as const;
export type GameCreatorAccessStatus = (typeof GAME_CREATOR_ACCESS_STATUSES)[number];

export const GAME_CREATOR_ACCESS_AUDIT_ACTIONS = ["GRANTED", "REVOKED", "REINSTATED"] as const;
export type GameCreatorAccessAuditAction = (typeof GAME_CREATOR_ACCESS_AUDIT_ACTIONS)[number];

export const GAME_CREATOR_APPLICATION_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
] as const;
export type GameCreatorApplicationStatus = (typeof GAME_CREATOR_APPLICATION_STATUSES)[number];

/**
 * Policy hook for "may this user submit a Game Creator application right now" — deliberately not
 * wired to any subscription/billing check. No OWO_PLUS (or any) subscription system exists
 * anywhere in this codebase today (confirmed by a repository-wide search — there is no
 * subscription table, route, or contract), so hard-coding an OwO Plus gate here would either be
 * dead code or, worse, silently block every application. A future OwO Plus eligibility check is
 * meant to replace this single function body without touching any call site
 * (GameCreatorUseCases.apply is the only caller). See docs/AUTHORIZATION.md's
 * "현재 구현 vs 향후 계획" section.
 *
 * 2026-08-18 운영 결정: 셀프서비스 신청을 **임시로 닫아둡니다** — 프로그램을 실제로 운영할 준비가
 * 아직 안 되어 있어, 지금 신청을 받아도 심사할 계획이 없습니다(추후 업데이트 예정). 이 값을
 * `false`로 바꾸는 것만으로 다시 열 수 있도록, 이 함수 본문 하나만 바뀌면 되게 설계되어 있습니다 —
 * 호출부(GameCreatorUseCases.apply)나 계약(GameCreatorMeResponseSchema.canApply)은 전혀 손대지
 * 않습니다. 관리자 직접 임명(GameCreatorUseCases.grant)과 스태프 암묵 부여
 * (hasImplicitGameCreatorAccess)는 이 정책과 무관하게 계속 동작합니다 — "신청"만 닫혀 있을 뿐,
 * 프로그램 자체가 없어진 게 아닙니다.
 */
export function canApplyForGameCreator(): boolean {
  return false;
}

/**
 * ADMIN/OPERATOR/SYSTEM_DEVELOPER get Game Creator access **implicitly**, without a separate
 * admin-grant or self-serve application — added 2026-08-18 so ops/dev staff can use the sandbox
 * game upload/review/publish pipeline for testing and support without an extra manual grant step.
 * MODERATOR is deliberately excluded. This is a product decision rather than an incidental side
 * effect of the editable role-permission policy.
 *
 * This does NOT make GAME_CREATOR a Staff Role or fold it into the role tree — it stays a
 * Program/Entitlement whose axis is independent of Staff Role (docs/AUTHORIZATION.md §0). This is
 * simply a policy rule that says "holding one of these three roles also satisfies the Game
 * Creator program's access check," the same way an admin-direct grant or an approved application
 * would — none of those three paths change what GAME_CREATOR *is*.
 *
 * Callers OR this together with the real `game_creator_access` row status — it never replaces
 * that check, and revoking a MODERATOR's or a plain USER's actual grant still works exactly as
 * before.
 */
export function hasImplicitGameCreatorAccess(staffRole: StaffRole | null): boolean {
  return staffRole === "ADMIN" || staffRole === "OPERATOR" || staffRole === "SYSTEM_DEVELOPER";
}
