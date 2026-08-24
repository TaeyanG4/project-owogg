# OwOGG 데이터베이스

상태: 기준 문서

마지막 검증: 2026-08-24

최신 마이그레이션: `0039_streamer_terminology.sql`

기준 소스:

- `packages/db/migrations/`
- `packages/db/src/d1/`
- `packages/db/src/storage/`
- `apps/api/src/container.ts`
- `.github/workflows/deploy.yml`
- [`ERD.md`](ERD.md) — 도메인별 관계도와 전체 물리 테이블·호환 뷰 사전

Cloudflare D1의 실제 schema와 제약조건은 migration 파일이 유일한 권한 원천입니다. 이 문서는
현재 `0000_initial_schema.sql`부터 `0039_streamer_terminology.sql`까지의 역할을 설명합니다.

## 마이그레이션 범위

| 범위          | 주제                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| `0000`–`0005` | 사용자, 점수, identity/merge, progression                                  |
| `0006`–`0009` | Discord link, guild, guild XP                                              |
| `0010`–`0014` | 방송 채널 profile, metrics, review(당시 `creator_*` 역사 명칭)             |
| `0015`–`0018` | admin 인증/계정, locale, 활동 연속 기록                                    |
| `0019`–`0023` | 게임 설정, 난이도 점수, 프로필 공개 범위, 모니터링, moderation             |
| `0024`–`0028` | USER sandbox game, staff/program, soft delete, mode/logo, 일회성 attempt   |
| `0029`        | generic `games` identity와 USER backfill                                   |
| `0030`        | USER identity write convergence                                            |
| `0031`        | 공통 `game_versions`, slug/live-version 불변식, version 수렴               |
| `0032`        | generic score acceptance에 필요한 relational binding                       |
| `0033`        | generic `game_assets`, USER logo convergence                               |
| `0034`        | USER control/review 필드의 generic authority 전환과 구 Worker 호환 미러    |
| `0035`        | Game Creator Manifest v1 결과 원장, score projection, 게임별 도전과제 해금 |
| `0036`        | live-version 리더보드 세대와 OWOGG 완전 삭제 감사 로그                     |
| `0037`        | OAuth provider별 avatar 후보와 사용자 avatar 선택                          |
| `0038`        | 관리자 역할별 기능 권한 정책과 통합 관리자 센터 접근                       |
| `0039`        | 방송 채널 도메인의 `streamer_*` 명명 전환과 롤링 배포 호환 계층            |

기존 migration은 변경, squash, 삭제하지 않습니다. 프로덕션 배포는 API보다 먼저
`pnpm d1:migrate:prod`를 실행합니다.

## 접근 경계

```text
Hono route
→ packages/core use case / port
→ packages/db D1 repository
→ D1
```

route에서 SQL을 직접 실행하는 것이 기본 구조가 아닙니다. 읽기 일관성, transaction/batch, row
mapping은 repository가 담당합니다. B2 canonical/bundle은 D1 row와 별도 저장소이지만 core의
port를 통해 조합됩니다.

## 공통 Game Platform 테이블

### `games`

Generic game identity의 권한 원천입니다.

- 숫자 `id`와 유일한 `slug`
- `publisher_type = OWOGG | USER`
- USER publisher의 relational `publisher_user_id`
- visibility와 soft-deletion 상태
- 현재 `live_version_id`
- 현재 live version에 종속된 `leaderboard_generation`
- USER control-plane metadata와 review slot

DB trigger는 live version이 같은 game의 `game_versions` row를 가리키도록 강제합니다. OWOGG
publisher authority는 서버/배포 과정이 기록하는 relational fact이며 이름이나 slug로 추론하지
않습니다.

`live_version_id`가 다른 version으로 바뀔 때만 `leaderboard_generation`이 증가합니다. `scores` row도
승인 시점의 동일 generation을 저장하며 공개·개인·Streamer·Discord 게임 랭킹 쿼리는 현재 game
generation과 일치하는 row만 읽습니다. 따라서 version rollout은 과거 score를 물리 삭제하지 않고도
현재 leaderboard를 초기화합니다.

### `game_versions`

Publisher-neutral bundle identity와 publication 사실을 저장합니다.

- `id`, `game_id`, source/object identity, `content_hash`, bundle bytes
- `UPLOADED | PUBLISHING | READY | FAILED`
- publication된 manifest key, 크기, 파일 수, timestamp/error
- USER moderation status, reviewer, review timestamp/reason

불변 publication target은 `(gameId, versionId, contentHash)`입니다. `READY`만 runtime 제공 후보가
되며 live pointer, visibility, kill switch, canonical/manifest validation도 모두 통과해야 합니다.

### `game_assets`

게임 단위 provider-neutral 자산 메타데이터입니다. 현재 `LOGO`가 사용되며 object bytes는 B2에
있습니다. 자산은 game 단위이고 version bundle과 분리됩니다.

### `game_results`와 `user_game_achievements`

`0035`부터 `owogg.json` Game Creator Manifest v1 계약으로 보고된 완료 사실은 `game_results`에 먼저
기록됩니다. 서버는 live canonical 계약을 기준으로 outcome, score, progression, metrics, events를
검증하며, 범위 정책이 `clamp`인 값은 보정 사실과 사유를 함께 남기되 보상·랭킹 대상에서는
제외합니다. 랭킹이 활성화된 유효 score만 기존 `scores` 테이블에 `result_id`로 연결된 projection을
생성합니다. `user_game_achievements`는 이 결과 원장을 기반으로 게임별 manifest achievement를
멱등 해금합니다.

### `official_game_deletion_audit_log`

OWOGG 공식 게임 완전 삭제의 game ID, slug, 관리자, version/object 수와 시각을 identity 삭제 뒤에도
보존하는 append-only 기록입니다. 실제 삭제는 먼저 OWOGG row를 PRIVATE/soft-deleted 상태로 격리하고
B2를 멱등 정리한 다음, exact `(game_id, slug, publisher_type)` 조건으로 D1을 purge합니다. USER row는
이 경로의 조건을 만족할 수 없습니다.

## USER 제어 영역과 호환 테이블

### `sandbox_games`

`0034` 이후 권한 원천이 아닙니다. 이전 Worker revision이 migration과 새 Worker 배포 사이에도
동작하도록 남겨 둔 배포 호환 미러입니다.

- developer user ownership
- review slot과 editable metadata
- visibility, live version compatibility fields
- `logo_key` compatibility write surface
- soft-delete timestamp

### `sandbox_game_versions`

`0034` 이후 심사 상태의 권한 원천은 `game_versions`입니다. 이 테이블은 이전 Worker용 호환
미러이며 audit 관계와 contract migration 전환 기간 때문에 물리적으로만 남아 있습니다.

- review status: `PENDING_REVIEW | APPROVED | REJECTED | WITHDRAWN`
- reviewer, reject/revoke 사유, audit 관계
- source archive와 publication compatibility fields

`D1SandboxGameRepository`라는 기존 class/API 이름은 외부 계약 호환을 위해 유지하지만 조회와 신규
권한 쓰기는 `games`, `game_versions`, `game_assets`를 사용합니다. 구 테이블 쓰기도 같은 D1 batch에
미러링하며, 이전 Worker의 구 테이블 쓰기는 trigger가 generic authority로 수렴시킵니다.

## 두 개의 독립 상태축

```text
Publication axis: UPLOADED → PUBLISHING → READY | FAILED
Review axis:      PENDING_REVIEW → APPROVED | REJECTED | WITHDRAWN
```

`READY`는 bundle의 파일과 manifest가 완전히 publication되었다는 뜻입니다. `APPROVED`는 관리자가
USER 버전을 검토했다는 뜻입니다. 승인 시점에 version은 이미 `READY`여야 하지만 그 역은
성립하지 않습니다.

```text
READY != APPROVED
```

실패한 publication은 같은 numeric version과 source archive를 사용해 republish할 수 있습니다.
검토 결정과 publication failure는 별도입니다.

## `0034` expand/switch와 후속 contract

`0034_unified_game_control_plane.sql`은 USER metadata/review 상태를 generic rows에 backfill하고 parity
guard를 통과시킨 뒤 application read authority를 전환합니다. `sandbox_*`는 별도 게임 모델이 아니라
이전 배포 호환 미러입니다.

구 테이블과 동기화 trigger를 삭제하는 contract migration은 이 변경의 Staging 배포·Game Creator
등록/심사/공개/rollback smoke가 끝난 다음 릴리스에서만 추가합니다. expand와 drop을 한 배포에 넣으면
D1 migration이 새 Worker보다 먼저 실행되는 동안 이전 Worker가 깨지므로 금지합니다.

## 주요 비게임 도메인

### 사용자 공개 identity

- `users.nickname`은 Google/Discord 이름과 분리된 사용자의 공개 별명이며 중복을 허용합니다. 변경은
  서버 정책으로 30일에 한 번만 허용합니다.
- 공개 식별 태그는 별도 가변 문자열을 저장하지 않고 안정적인 `users.id`를 사용해
  `nickname #id`로 표시합니다.
- `oauth_accounts.avatar_url`은 연동된 provider별 검증된 프로필 이미지 후보를 보존합니다.
  `users.avatar_provider`가 Google/Discord 중 사용자가 선택한 provider를 가리키며,
  `users.avatar_url`은 공개 조회가 사용할 현재 선택 결과입니다. 클라이언트가 임의 이미지 URL을
  제출하지 않고 서버가 연동 계정의 저장된 후보만 선택합니다.
- 점수 row의 nickname/avatar snapshot은 감사·이력용으로 유지하되, 현재 leaderboard는 `users`를
  join하여 최신 별명과 선택 avatar를 표시합니다.

- **Identity/auth**: `users`, provider identity/link/merge, user/admin sessions, managed admin
  accounts와 permission grants
- **Score/progression**: score rows, difficulty, attempt consumption, XP ledger, achievements,
  streak
- **Personalization**: favorites, recently played, settings/profile visibility
- **Discord**: link challenges, guild registration/manager, play context, guild XP attribution
- **Streamer**: streamer profile, platform account, metrics, verification/review
- **Operations**: game kill switch, moderation, monitoring indexes, staff/program entitlement

관계와 전체 물리 테이블·호환 뷰 사전은 [D1 ERD](ERD.md)를 확인합니다. 정확한 column, index,
foreign key, trigger는 해당 migration과 `packages/db/src/d1` query를 확인해야 합니다. 이 문서는 SQL
원문을 복제하지 않습니다.

## runtime 읽기 조합

Public game은 단일 table만 읽어 완성하지 않습니다.

```text
D1 games
+ D1 live READY game_versions
+ D1 game_assets
+ B2 canonical document
+ B2 immutable manifest/bundle
→ RuntimeGameRegistry / public projection
```

generic row나 canonical/manifest가 불완전하면 legacy sandbox metadata로 fallback하지 않고 제공을
거부합니다. 자세한 불변식은 [Game Platform Architecture](GAME_PLATFORM_ARCHITECTURE.md)를
참조하세요.

## 변경 규칙

- 새 schema 변경은 새 순차 migration으로 추가합니다.
- 이미 적용 가능한 migration을 고치거나 번호를 재사용하지 않습니다.
- compatibility trigger를 지우기 전에 모든 기존 write/read 소비자를 증명합니다.
- `pnpm docs:check`는 migration directory의 가장 최신 filename과 이 문서의 `Latest migration`
  metadata를 비교합니다.
