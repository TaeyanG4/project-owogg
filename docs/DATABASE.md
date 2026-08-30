# OwOGG 데이터베이스

상태: 기준 문서

마지막 검증: 2026-08-31

최신 마이그레이션: `0048_oauth_identity_registration_guard.sql`

기준 소스:

- `packages/db/migrations/`
- `packages/db/src/d1/`
- `packages/db/src/storage/`
- `apps/api/src/container.ts`
- `.github/workflows/deploy.yml`
- [`ERD.md`](ERD.md) — 도메인별 관계도와 전체 물리 테이블·호환 뷰 사전

Cloudflare D1의 실제 schema와 제약조건은 migration 파일이 유일한 권한 원천입니다. 이 문서는
현재 `0000_initial_schema.sql`부터 `0048_oauth_identity_registration_guard.sql`까지의 역할을 설명합니다.

## 마이그레이션 범위

| 범위          | 주제                                                                        |
| ------------- | --------------------------------------------------------------------------- |
| `0000`–`0005` | 사용자, 점수, identity/merge, progression                                   |
| `0006`–`0009` | Discord link, guild, guild XP                                               |
| `0010`–`0014` | 방송 채널 profile, metrics, review(당시 `creator_*` 역사 명칭)              |
| `0015`–`0018` | admin 인증/계정, locale, 활동 연속 기록                                     |
| `0019`–`0023` | 게임 설정, 난이도 점수, 프로필 공개 범위, 모니터링, moderation              |
| `0024`–`0028` | USER sandbox game, staff/program, soft delete, mode/logo, 일회성 attempt    |
| `0029`        | generic `games` identity와 USER backfill                                    |
| `0030`        | USER identity write convergence                                             |
| `0031`        | 공통 `game_versions`, slug/live-version 불변식, version 수렴                |
| `0032`        | generic score acceptance에 필요한 relational binding                        |
| `0033`        | generic `game_assets`, USER logo convergence                                |
| `0034`        | USER control/review 필드의 generic authority 전환과 구 Worker 호환 미러     |
| `0035`        | Game Creator Manifest v1 결과 원장, score projection, 게임별 도전과제 해금  |
| `0036`        | live-version 리더보드 세대와 OWOGG 완전 삭제 감사 로그                      |
| `0037`        | OAuth provider별 avatar 후보와 사용자 avatar 선택                           |
| `0038`        | 관리자 역할별 기능 권한 정책과 통합 관리자 센터 접근                        |
| `0039`        | 방송 채널 도메인의 `streamer_*` 명명 전환과 롤링 배포 호환 계층             |
| `0040`        | 공개 게임별 고유 플레이·현재 북마크 집계를 위한 game-first covering index   |
| `0041`        | exact-version 멀티 profile, instance/match 원장, reward outbox와 lease      |
| `0042`        | committed match의 양방향 재대결 동의와 exact generation/lease 전환          |
| `0043`        | gs2 attempt의 first-evidence hash claim과 단일 terminal 전환                |
| `0044`        | gs2 세 점수 의미, verifier provenance, mode/revision과 원자 랭킹 projection |
| `0045`        | exact content hash에 묶인 generic Relay profile과 instance authority        |
| `0046`        | 서버 소유 GAME/INTERNAL_TOOL 분류와 공개 catalog 제외                       |
| `0047`        | KST 일·주·월 공개 랭킹과 활성 출석 조회용 covering/partial index            |
| `0048`        | Google/Discord 최초 등록 소유권 원장과 재가입·재연결 DB guard               |

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
generation과 canonical ruleset revision에 맞는 row만 읽습니다. 공개 게임 랭킹은 difficulty도 함께
분리합니다. `variant_id`는 플레이한 Mode의 provenance와 표시를 보존하지만 독립 leaderboard partition은
아닙니다. 따라서 version rollout 또는 ruleset revision 전환은 과거 score를 물리 삭제하지 않고도 현재
leaderboard를 초기화합니다.

공개 `/api/rankings`는 새 집계 테이블을 복제하지 않고 `scores`, `xp_events`, `users`를 권한 원장으로
직접 사용합니다. 게임 기록과 XP는 KST 일간·월요일 시작 주간·월간 경계로 제한하고,
게임 기록은 해당 기간의 사용자별 PB를 SQL window function으로 한 건만 선택합니다. XP는 해당
기간의 양수 ledger를 합산합니다. 연속 출석은 lazy 갱신된 오래된 값을 순위에 노출하지 않도록 KST
오늘 또는 어제 활동한 `current_streak`만 읽습니다. 일반/스트리머 범위는 같은 계산을 사용하며,
스트리머는 지원 플랫폼의 소유권 인증이 유효한 사용자로만 필터링합니다. 공개 identity는
현재 nickname/avatar/country를 join하며 country가 미지정·비공개·불명인 경우 API에서 `null`로 투영할 수
있습니다. 각 행은 값과 해당 값의 달성 일자를 함께 반환합니다.

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

`0035`부터 `owogg.json` Game Creator Manifest v1 계약으로 승인된 완료 사실은 `game_results`에 먼저
기록됩니다. non-PlayConfig `gs1`은 live canonical 계약으로 client facts의 outcome, score,
progression, metrics, events를 검증하고, `clamp` 보정 결과는 보상·랭킹에서 제외합니다.

`0044`의 verifier-backed `gs2` row는 `raw_score`, manifest precision을 적용한 `normalized_score`,
reward factor가 적용된 `competitive_score`, `variant_id`, `ruleset_revision`, `verifier_id`,
`evidence_hash`를 함께 기록합니다. 이 경로는 verifier 출력을 clamp하지 않고 선언 범위 밖이면 전체를
거부합니다. `scores.score`에는 competitive score를 투영하며 normalized gameplay facts는 도전과제·
진행도 판단에 사용합니다. `user_game_achievements`는 결과 원장을 기반으로 게임별 manifest achievement를
멱등 해금합니다.

### `game_result_verification_claims`

`0043`은 verifier-backed `gs2` attempt마다 처음 제출된 canonical evidence의 SHA-256 hash를 원자적으로
고정합니다. raw evidence는 저장하지 않습니다. claim identity는 `(attempt_id, user_id, game_id,
version_id, evidence_hash)`이며 exact version이 해당 game 소속인지 insert trigger가 재검증합니다.

상태는 `PROCESSING → VERIFIED | REJECTED` 한 번만 이동할 수 있습니다. `VERIFIED` 전환은 연결된
`game_results`가 같은 attempt/user/game/version인지, 선택적 `scores`가 그 result와 user를 투영하는지
trigger가 확인합니다. Phase 5-E부터 exact PROCESSING claim에 대해 attempt 소비, verifier-backed
`game_results`, 선택적 `scores`, result/score ID가 연결된 VERIFIED 전환을 하나의 D1 batch로
commit합니다. 어느 insert나 finalization이 실패해도 batch 전체가 rollback됩니다. 같은 evidence의
terminal replay는 저장된 서버 facts 또는 rejection code를 반환하고, 다른 evidence나 context로 같은
attempt를 바꾸려는 요청은 거부합니다. batch 시작 시 PUBLIC identity, exact current live version,
READY publish 상태와 D1 kill-switch를 다시 확인하므로 verifier 실행 도중 권위 상태가 바뀐 결과는
소비하거나 저장하지 않습니다. MVP에는 queue/cron/recovery worker가 없으므로 verifier 실행 뒤 Worker가
비정상 종료한 희귀 claim은 자동 복구하지 않고 새 attempt를 발급합니다.

### `official_game_deletion_audit_log`

OWOGG 공식 게임 완전 삭제의 game ID, slug, 관리자, version/object 수와 시각을 identity 삭제 뒤에도
보존하는 append-only 기록입니다. 실제 삭제는 먼저 OWOGG row를 PRIVATE/soft-deleted 상태로 격리하고
B2를 멱등 정리한 다음, exact `(game_id, slug, publisher_type)` 조건으로 D1을 purge합니다. USER row는
이 경로의 조건을 만족할 수 없습니다.

## Multiplayer foundation

`0041`과 `0042`는 초기 additive control-plane schema이고, `0045`가 현재 generic Relay profile
authority를 추가합니다. 게임별 live Relay 상태는 한 instance에 대응하는 Durable Object가 소유하고,
D1은 다음의 장기 권한 사실만 저장합니다.

- `multiplayer_profile_requests`: Creator/OWOGG upload가 exact version/content hash에 제출한 canonical
  request JSON, SHA-256과 단일 CAS 관리자 결정
- `multiplayer_profiles`: 서버가 해석한 immutable generic Relay profile revision; 승인 시 disabled로
  생성되고 별도 activation을 거치며 exact READY version당 enabled revision은 최대 하나
- `multiplayer_instances`, `multiplayer_participants`, `multiplayer_invites`: idempotent 생성, 정원,
  membership, generation과 hash-only invite 원장
- `multiplayer_matches`, `multiplayer_match_players`, `multiplayer_match_actions`: Phase 5 삭제 전 구
  server-ruleset runtime의 historical lifecycle/action 원장. generic Relay message는 이 원장에 쓰지 않음
- `multiplayer_rematch_requests`: 초기 server-ruleset 재대결 설계가 만든 historical table. Relay
  application/runtime은 읽거나 쓰지 않으며, 적용된 migration 이력 보존 때문에 물리 schema에만 남음
- `multiplayer_reward_outbox`: committed eligible player와 approved reward policy에 묶인 exactly-once
  전달 원장
- `game_version_leases`: 실행 중 instance가 사용하는 exact bundle의 삭제를 막는 lease
- `multiplayer_instance_admin_actions`: operation ID로 멱등 처리한 강제 종료의 append-only 관리자
  감사 원장

Profile semantic column은 update할 수 없고 변경 시 새 `profile_revision`을 만든다. Creator request는
manifest 권한이 아니며 publisher identity, approved request hash, exact content hash와 READY/APPROVED
version을 DB trigger가 다시 확인한다. Instance 생성도 현재 live READY version과 enabled Relay profile
snapshot이 일치해야 한다. Profile을 disable하면 기존 참가자의 reconnect는 유지하지만 신규
join/rejoin/invite는 거절한다. `0045`는 기존 ruleset profile을 disable하고 새 ruleset insert/enable을
막으며 runtime repository는 `profile_kind = 'RELAY'`만 읽는다. 만료 sweep은 lobby뿐 아니라
STARTING/ACTIVE/CLOSING instance도 `EXPIRED`로 바꾸고 match, invite와 lease를 같은 terminal trigger에서
정리한다.

Match는 `PENDING → ACTIVE → FINALIZING → COMMITTED` 순서를 건너뛸 수 없고 모든 player result가
committed되기 전에는 최종 commit할 수 없다. Reward row는 finalizing/committed match의 committed
eligible player에 대해서만 생성된다. iframe의 `GAME_COMPLETE`, score, XP 주장은 이 원장에 쓸 수
없다.

Relay 재경기는 플랫폼 결과/재대결 API가 아니라 게임 ZIP의 application payload와 UI가 담당합니다.
기존 `multiplayer_rematch_requests` trigger는 migration 이력에만 존재하고 현재 repository, API, DO,
Web runtime에는 consumer가 없습니다.

계정 병합은 같은 instance/match에 두 후보 계정이 함께 존재하는지와 두 Creator 계정의 review slot
충돌을 먼저 검사한다. 충돌이 없을 때 Creator access, USER game publisher와 multiplayer request owner를
Primary로 옮기고 participant `user_id`를 바꾸면 match player, action과 reward outbox가
`ON UPDATE CASCADE`로 함께 이동한다. 사용자 직접 삭제는 장기 multiplayer identity의 `RESTRICT` FK가
fail-closed로 막는다. 삭제/익명화 정책이나 공식 게임 purge는 active instance/match/lease를 먼저
종료하고 감사 정책을 적용해야 하며, FK나 immutable ledger trigger를 우회하지 않는다.

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
- `oauth_accounts`는 현재 활성 연결만 나타냅니다. `oauth_identity_registrations`는 최초 등록된
  `(provider, provider_user_id) ↔ user_id` 소유권을 연결 해제 뒤에도 보존합니다. DB trigger와 두
  unique key가 같은 Google/Discord identity의 다른 사용자 재가입과 한 사용자의 provider identity
  교체를 모두 거부합니다. 같은 identity로 다시 로그인하면 새 사용자를 만들지 않고 최초 사용자에
  재연결하며, 명시적 계정 통합만 등록 소유권을 Primary로 함께 이전합니다.
- 점수 row의 nickname/avatar snapshot은 감사·이력용으로 유지하되, 현재 leaderboard는 `users`를
  join하여 최신 별명과 선택 avatar를 표시합니다.

- **Identity/auth**: `users`, provider identity/link/merge, user/admin sessions, managed admin
  accounts와 permission grants
- **Score/progression**: score rows, difficulty, attempt consumption, XP ledger, achievements,
  streak
- **Personalization**: favorites, recently played, settings/profile visibility
- 공개 카탈로그의 `playerCount`는 `user_recent_plays`의 game slug별 행 수로, 한 인증 사용자가 같은
  게임을 여러 번 열어도 1명으로 집계합니다. `bookmarkCount`는 현재 `user_favorites` 행 수입니다.
  별도 가변 aggregate row를 두지 않아 원장과 통계가 어긋나지 않으며, `0040`의 `(game_id, user_id)`
  인덱스로 공개 조회를 지원합니다. 인기 점수는 Core 정책인 `playerCount + bookmarkCount × 3`입니다.
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
