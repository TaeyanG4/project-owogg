# OwOGG 인가 모델

상태: 기준 문서

마지막 검증: 2026-08-21

기준 소스:

- `packages/core/src/domain/staffRoles.ts`
- `packages/core/src/domain/gameCreator.ts`
- `packages/core/src/modules/game/domain/gamePublisher.ts`
- `packages/core/src/application/gameCreatorUseCases.ts`
- `apps/api/src/auth/`
- `apps/api/src/routes/myAccess.ts`
- `apps/api/src/routes/admin*.ts`
- `apps/api/src/routes/devGames.ts`
- `packages/db/migrations/0015_admin_auth.sql`
- `packages/db/migrations/0016_admin_accounts.sql`
- `packages/db/migrations/0025_staff_roles_and_game_creator_program.sql`

OwOGG 권한은 하나의 role hierarchy로 설명할 수 없습니다. Identity, staff role, program
entitlement, permission, game publisher authority는 서로 다른 질문에 답합니다.

## 개념 구분

| 개념                | 질문                                 | 현재 표현                                            |
| ------------------- | ------------------------------------ | ---------------------------------------------------- |
| Identity            | 로그인한 사용자가 누구인가?          | user/session/provider identity                       |
| Staff role          | 운영 조직에서 어떤 역할인가?         | `ADMIN`, `OPERATOR`, `MODERATOR`, `SYSTEM_DEVELOPER` |
| Program entitlement | 특정 사용자 기능을 쓸 자격이 있는가? | GAME_CREATOR access, streamer profile                |
| Permission          | 이 운영 동작을 실행할 수 있는가?     | role default + individual grant                      |
| Publisher authority | 이 게임을 누가 publish했는가?        | `{type:"OWOGG"}` 또는 `{type:"USER", userId}`        |

표시 이름, Game Creator 이름, slug, UI label은 어느 권한의 증거도 아닙니다.

## Identity와 session

일반 OwOGG session은 사용자 identity를 증명합니다. 관리자 기능은 일반 session만으로 열리지 않으며
관리자 자격/step-up/admin credential을 거친 별도 관리자 session과 route별 permission 검사를
사용합니다.

관리형 `admin_accounts`가 현재 관리자 identity의 일반 경로입니다. `ADMIN_USER_IDS`와 환경 기반
admin login fallback도 여전히 compatibility 경로로 사용됩니다. 이 fallback은
`MIGRATE_THEN_DELETE` 대상이지 문서 단계에서 제거할 수 있는 dead code가 아닙니다. 구체적인 secret
설정 runbook은 현재 저장소에 없으므로 이 문서가 미검증 운영 절차를 대신하지 않습니다.

## Staff role

`admin_accounts.role`은 다음 네 값 중 하나입니다.

- `ADMIN`: 보호되는 최상위 역할. permission catalog 전체를 암묵적으로 보유합니다.
- `OPERATOR`: 운영 기능을 부여할 수 있는 운영자 역할입니다.
- `MODERATOR`: moderation 기능을 부여할 수 있는 모더레이터 역할입니다.
- `SYSTEM_DEVELOPER`: 내부 진단/개발 기능을 부여할 수 있는 시스템 개발자 역할입니다.

역할은 숫자 서열로 비교하지 않습니다. 역할별 별도 센터도 두지 않습니다. 세 역할 모두
`/admin`의 통합 관리자 센터를 사용하며, D1 `admin_role_permissions`에 저장된 역할 정책에 따라
메뉴와 API 기능이 결정됩니다. 아래 표는 migration 0038이 저장하는 초기값이며 ADMIN이 관리자
계정 화면에서 변경할 수 있습니다.

## Permission 목록과 역할 정책 초기값

현재 catalog:

```text
admin.center.access
users.view
users.suspend
users.ban
users.score_moderation
games.moderate
sandbox_games.review
sandbox_games.delete
game_creators.manage
streamers.review
system.monitor
system.dev.access
roles.manage
```

| Permission                            | OPERATOR | MODERATOR | SYSTEM_DEVELOPER |
| ------------------------------------- | :------: | :-------: | :--------------: |
| `admin.center.access`                 |   yes    |    yes    |       yes        |
| `users.view`, `users.suspend`         |   yes    |    yes    |        no        |
| `users.ban`, `users.score_moderation` |   yes    |    no     |        no        |
| `games.moderate`                      |   yes    |    no     |        no        |
| `sandbox_games.review`                |   yes    |    yes    |        no        |
| `sandbox_games.delete`                |   yes    |    no     |        no        |
| `game_creators.manage`                |   yes    |    no     |        no        |
| `streamers.review`                    |   yes    |    yes    |        no        |
| `system.monitor`                      |   yes    |    no     |       yes        |
| `system.dev.access`                   |    no    |    no     |       yes        |

`users.suspend`는 `/admin/users`에서 서버가 계산하는 `7일`·`30일`·`180일` 임시정지와 조기
해제를 허용합니다. `users.ban`은 자동 만료되지 않는 영구 밴과 해제를 허용합니다. 두 조치는
기존 로그인 세션을 즉시 폐기하며 Protected `ADMIN`에는 적용할 수 없습니다. 세부 운영 규칙과
감사 로그는 [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md) §5를 따릅니다.

ADMIN은 역할 정책을 쓰지 않고 `PERMISSIONS` 전체를 보유합니다. `roles.manage`도 ADMIN의
암묵적 권한으로만 성립합니다. 역할 정책 조회·수정 API는 활성 managed ADMIN만 사용할 수 있고,
변경은 `ROLE_PERMISSIONS_UPDATED` 감사 로그에 남습니다.

## 개별 permission 부여

유효 permission은 `admin_role_permissions`의 역할 정책과 `admin_permission_grants`의 계정별
예외 권한 합집합입니다. 공통 접근은 역할 정책에서 관리하고, 같은 역할 안에서도 특정 계정에만
필요한 예외가 있을 때 개별 permission을 추가합니다.

`roles.manage`는 `isDelegatablePermission()`과 use case에서 모두 위임을 거부합니다. 따라서 다른
role이 자신이나 타인의 role/permission을 확대할 수 없습니다. Web에서 메뉴를 숨기는 것은 편의일
뿐이며 API route가 `requirePermission`으로 다시 검사합니다.

## 보호되는 ADMIN

`isProtectedStaffRole(role)`은 `ADMIN`에만 true입니다.

- 일반 사용자 moderation route는 대상이 ADMIN이면 actor가 누구든 제재를 거부합니다.
- managed admin account 관리 route는 ADMIN 전용이며 다른 ADMIN을 관리할 수 있습니다.
- 자기 자신 변경/revoke와 마지막 활성 ADMIN의 강등/비활성화는 별도 invariant로 거부됩니다.

이 규칙은 일반 login/logout을 막는 것이 아니라 privilege 관리와 moderation에서 lockout/escalation을
방지합니다.

## GAME_CREATOR 프로그램

GAME_CREATOR는 Staff Role이 아닙니다. 일반 사용자에게 game upload/control-plane 사용 자격을 주는
별도 entitlement입니다.

Access를 만족하는 현재 경로:

1. `game_creator_access.status === ACTIVE`
2. `ADMIN`, `OPERATOR`, `SYSTEM_DEVELOPER` role의 implicit access

`MODERATOR`는 implicit access 대상이 아닙니다. Admin/operator의 direct grant/revoke와 신청 승인
흐름은 persistence/audit를 사용하며 staff role 자체를 변경하지 않습니다.

### 셀프서비스 신청은 현재 닫힘

현재 코드의 사실은 다음과 같습니다.

```ts
export function canApplyForGameCreator(): boolean {
  return false;
}
```

따라서 `/api/dev/me`와 `/api/me/access`의 `canApply`는 신규 사용자에게도 false이고,
`GameCreatorUseCases.apply`는 self-service 신청을 거부합니다. 이는 2026-08-18의 임시 운영 결정이며
OWO_PLUS gate가 아닙니다.

중요하게도 닫힌 것은 **신청 제출**뿐입니다. 다음은 계속 동작합니다.

- 기존 ACTIVE entitlement
- admin의 direct grant
- 위 세 staff role의 implicit access
- 기존 pending application의 관리/결정 경로

이 구분 없이 “누구나 신청 가능” 또는 “GAME_CREATOR 프로그램 전체가 비활성”이라고 쓰면 둘 다
현재 구현과 맞지 않습니다.

## STREAMER 프로그램

채널 소유권과 Featured 심사를 다루는 streamer system은 GAME_CREATOR upload entitlement와
다릅니다. 한 사용자가 둘 다 가질 수 있지만 하나가 다른 하나를 암묵적으로 부여하지 않습니다.
[Streamer System](STREAMER_SYSTEM.md)이 채널 검증의 세부 문서입니다.

## 구독

OWO_PLUS subscription table/route/contract는 현재 구현되어 있지 않습니다. 미래 subscription을
GAME_CREATOR 신청 조건으로 사용할지 역시 현재 authorization fact가 아닙니다. 구현 전 proposal을
현재 정책처럼 기록하지 않습니다.

## 게임 publisher 권한

게임 publisher는 generic `games` identity의 relational authority입니다.

관리자 UI는 `/admin/games`의 **게임 관리 및 심사** 화면으로 통합되어 있습니다. 이 화면 안에서도
OWOGG 업로드·전체 게임 안전 제어(`games.moderate`)와 사용자 제작 게임 심사
(`sandbox_games.review`)는 독립 권한으로 검사합니다. `/admin/sandbox-games`는 이전 링크 호환용이며
새 문서나 메뉴의 진입점으로 사용하지 않습니다.

```ts
type GamePublisher = { type: "OWOGG" } | { type: "USER"; userId: number };
```

- `OWOGG`는 elevated admin publication route가 assertion하는 authority이며 public caller가 선택하는
  값이 아닙니다.
- `USER.userId`는 정확한 OwOGG user identity입니다.
- slug, title, developer display name, canonical text는 소유권/인가 판정에 사용하지 않습니다.
- public “공식” 배지는 canonical v2의 `publisher.official` 메타데이터입니다. 이것은 표시값일 뿐
  권한 원천이 아니며 Game Creator 요청/manifest가 선택할 수 없습니다.
- runtime registry는 publisher에 따라 다른 serving 구현을 선택하지 않습니다.

`POST /api/admin/games/upload`만 OWOGG publisher를 생성·갱신할 수 있습니다. deploy workflow와
Game Creator route는 OWOGG authority나 live version을 선택하지 않습니다.

## route별 권한 검사 예시

- `/api/dev/*`: 일반 session + Game Creator access + ownership/admin 조건
- `/api/admin/sandbox-games/*`: admin session + `sandbox_games.review` 또는 delete permission
- `/api/admin/games/upload`: elevated admin session + `games.moderate`; publisher는 서버가 OWOGG로 고정
- `/api/admin/game-creators/*`: `game_creators.manage`
- `/api/admin/accounts/*`: managed ADMIN과 `roles.manage` invariant
- public game/score: publisher label이 아니라 generic game/version/session/canonical policy

인가 판단은 항상 server가 수행합니다. Client의 access response와 menu visibility는 server 판정을
설명하는 projection일 뿐 권한 원천이 아닙니다.
