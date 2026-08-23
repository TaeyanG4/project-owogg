import type { SandboxGameUseCaseFailure } from "@owogg/core";

/** Shared HTTP mapping for sandbox-game use-case failures, used by both the developer-facing
 * (devGames.ts) and admin-facing (adminSandboxGames.ts) routers. One table rather than two, so a
 * new failure code can't be mapped to different statuses depending on who hit it — and because
 * these are exhaustive `Record`s, adding a code to the union makes both routers fail to compile
 * until it's handled. */
export type SandboxGameFailureStatus = 400 | 403 | 404 | 409 | 413 | 422 | 500 | 503;

export const SANDBOX_GAME_FAILURE_STATUS: Record<
  SandboxGameUseCaseFailure["code"],
  SandboxGameFailureStatus
> = {
  GAME_NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,
  SLUG_TAKEN: 409,
  INVALID_SLUG: 400,
  INVALID_TITLE: 400,
  NOT_OWNER: 403,
  BUNDLE_TOO_LARGE: 413,
  BUNDLE_EMPTY: 400,
  ALREADY_DECIDED: 409,
  REASON_REQUIRED: 400,
  NO_APPROVED_VERSION: 409,
  VERSION_NOT_PUBLISHED: 409,
  VERSION_NOT_APPROVED: 409,
  // Publishing failed on our side (storage error), not because of anything wrong with the upload.
  PUBLISH_FAILED: 500,
  // 422: the request was well-formed and authorized, but the bundle's *contents* are unacceptable.
  BUNDLE_MALFORMED: 422,
  BUNDLE_INVALID_PATH: 422,
  BUNDLE_TOO_MANY_FILES: 422,
  BUNDLE_EXTRACTED_TOO_LARGE: 422,
  BUNDLE_MISSING_ENTRY: 422,
  SUBMISSION_LIMIT_REACHED: 409,
  NOTHING_TO_WITHDRAW: 409,
  MANIFEST_MISSING: 422,
  MANIFEST_INVALID: 422,
  INVALID_GENRE: 400,
  ALREADY_DELETED: 409,
  CANNOT_DELETE_APPROVED_GAME: 409,
  CANNOT_PURGE_APPROVED_GAME: 409,
  REVOKE_REQUIRES_APPROVED: 409,
  INVALID_MODE: 400,
  LOGO_REQUIRED: 422,
  LOGO_TOO_LARGE: 422,
  NOT_YET_DELETED: 409,
  // Stage C-2 (B2 canonical write-through): a rejected metadata mutation, not a server fault.
  SCORE_POLICY_WOULD_BECOME_INCOMPLETE: 400,
  AMBIGUOUS_SCORE_POLICY_ACTIVATION: 400,
  // The request itself was valid; keeping B2 in sync with D1 failed — this can happen before D1
  // is ever touched (a pre-read failure) or after (a save/parity failure), so the message must
  // stay neutral about what, if anything, was actually saved. A dependency failure either way,
  // safely retryable, not the client's fault.
  CANONICAL_SYNC_FAILED: 503,
};

export const SANDBOX_GAME_FAILURE_MESSAGE: Record<SandboxGameUseCaseFailure["code"], string> = {
  GAME_NOT_FOUND: "존재하지 않는 게임입니다.",
  VERSION_NOT_FOUND: "존재하지 않는 버전입니다.",
  SLUG_TAKEN: "이미 사용 중인 슬러그입니다.",
  INVALID_SLUG: "슬러그는 영문 소문자/숫자/-, 3~64자여야 합니다.",
  INVALID_TITLE: "제목은 1~60자여야 합니다.",
  NOT_OWNER: "본인이 등록한 게임만 업로드할 수 있습니다.",
  BUNDLE_TOO_LARGE: "번들 용량이 최대 허용치를 초과했습니다.",
  BUNDLE_EMPTY: "빈 파일은 업로드할 수 없습니다.",
  ALREADY_DECIDED: "이미 심사가 완료된 버전입니다.",
  REASON_REQUIRED: "사유를 입력해야 합니다.",
  NO_APPROVED_VERSION: "승인된 버전이 있어야 공개로 전환할 수 있습니다.",
  VERSION_NOT_PUBLISHED:
    "번들 배포가 완료되지 않은 버전입니다. 재배포 후 다시 시도하거나 새로 업로드하세요.",
  VERSION_NOT_APPROVED: "승인된 버전만 라이브로 지정할 수 있습니다.",
  PUBLISH_FAILED: "번들 배포에 실패했습니다. 잠시 후 재배포를 시도하세요.",
  BUNDLE_MALFORMED: "ZIP 파일을 읽을 수 없습니다. 정상적인 ZIP으로 다시 압축해 주세요.",
  BUNDLE_INVALID_PATH: "ZIP 안에 허용되지 않는 파일 경로가 있습니다(절대 경로/상위 경로 등).",
  BUNDLE_TOO_MANY_FILES: "ZIP 안의 파일 개수가 허용치를 초과했습니다.",
  BUNDLE_EXTRACTED_TOO_LARGE: "압축을 푼 전체 용량이 허용치를 초과했습니다.",
  BUNDLE_MISSING_ENTRY: "ZIP 최상위에 index.html이 없습니다.",
  SUBMISSION_LIMIT_REACHED:
    "현재 심사 중인 게임이 2개입니다. 기존 게임의 심사가 완료되거나 제출을 철회한 뒤 다시 시도해주세요.",
  NOTHING_TO_WITHDRAW: "철회할 심사 중인 제출이 없습니다.",
  MANIFEST_MISSING:
    "ZIP 최상위에 owogg.json이 없습니다. 모든 등록 및 버전 업로드에 Creator Manifest v1 파일을 포함하세요.",
  MANIFEST_INVALID:
    "owogg.json이 Creator Manifest v1 규격에 맞지 않거나 기존 게임의 slug와 일치하지 않습니다.",
  INVALID_GENRE: "genre는 비어 있지 않은 문자열이어야 합니다.",
  ALREADY_DELETED: "이미 삭제된 게임입니다.",
  CANNOT_DELETE_APPROVED_GAME:
    "이미 승인된 버전이 있는 게임은 직접 삭제할 수 없습니다. 관리자에게 문의하세요.",
  CANNOT_PURGE_APPROVED_GAME:
    "승인 이력이 있는 게임은 과거 기록 보호를 위해 슬러그를 영구 보존해야 하므로 완전 삭제할 수 없습니다.",
  REVOKE_REQUIRES_APPROVED: "승인된 버전만 철회할 수 있습니다.",
  INVALID_MODE: 'mode는 "single" 또는 "multi"여야 합니다.',
  LOGO_REQUIRED:
    "ZIP 최상위에 로고 이미지(owogg.logo.png/jpg/jpeg/webp/svg 중 하나)가 없습니다. 게임 등록에는 로고가 필요합니다.",
  LOGO_TOO_LARGE: "로고 이미지 용량이 최대 허용치를 초과했습니다.",
  NOT_YET_DELETED: "먼저 삭제(비공개 전환)된 게임만 완전 삭제할 수 있습니다.",
  SCORE_POLICY_WOULD_BECOME_INCOMPLETE:
    "이미 점수가 설정된 게임의 필수 점수 항목(단위/방향/최소/최대값)을 비울 수 없습니다.",
  AMBIGUOUS_SCORE_POLICY_ACTIVATION:
    "점수 미설정 게임에 점수를 설정하려면 단위/방향/최소/최대값을 이번 요청에서 모두 함께 입력해야 합니다.",
  CANONICAL_SYNC_FAILED:
    "게임 정보 동기화(B2)에 실패해 변경을 완료하지 못했습니다. 잠시 후 같은 요청을 다시 시도해주세요.",
};
