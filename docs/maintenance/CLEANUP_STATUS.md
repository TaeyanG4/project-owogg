# Repository Cleanup Status

상태: 현재 기준 문서

마지막 검증: 2026-08-23

- Completion Campaign 시작 기준 main: `8752dcf0409a02b75e5a4ed550dab4f5dae7fff2`
- F-5 시작 기준 main: `2b77ca4509051305d31ecdf8839a25003a3456ed`
- Historical inventory: [LEGACY_LEDGER.md](LEGACY_LEDGER.md)

이 문서는 F-0 inventory 이후 F-5까지 repository에서 완료한 정리와, 의도적으로 유지하거나
증거를 기다리는 compatibility surface를 구분합니다. `LEGACY_LEDGER.md`는 F-0 시점의 조사
기록이며 현재 판정의 권한 원천이 아닙니다.

상태의 의미는 다음과 같습니다.

- `REMOVED`: replacement와 소비자 추적을 확인한 뒤 repository surface를 제거했습니다.
- `KEEP_REQUIRED`: 현재 runtime, build, control plane 또는 regression invariant에 필요합니다.
- `DEFER_PRODUCT_DECISION`: 제품/architecture 지원 정책이 먼저 결정되어야 합니다.
- `DEFER_PRODUCTION_EVIDENCE`: repository 밖의 배포·데이터 증거가 있어야 안전하게 제거할 수
  있습니다.
- `DEFER_EXTERNAL_COMPATIBILITY`: 외부 링크/API 사용 기간 또는 telemetry가 정해지지 않았습니다.

## 완료된 단계

| 단계     | 결과                                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-0      | PR #77에서 repository/runtime/build/persistence/문서 전 범위를 조사하고 Historical legacy ledger를 만들었습니다.                                                                  |
| F-1      | PR #78에서 현재 generic platform을 기준으로 architecture/database/authorization/game guide를 다시 정리하고 `docs:check`를 추가했습니다.                                           |
| F-2      | PR #79에서 repository-only evidence로 안전성이 확인된 stale 문구, dead Web helper, 중복 barrel, dormant R2 adapter를 제거했습니다.                                                |
| F-3A     | PR #80에서 `GAME_LOADERS`, `loadGame()`, source-package dynamic loader, Web loader generator/check surface와 전용 Web dependency를 제거했습니다.                                  |
| F-3B     | 변경 없는 audit gate로 수행했습니다. USER control plane과 convergence trigger, admin/session compatibility는 production evidence 없이 제거할 수 없음을 재확인했습니다.            |
| F-4/F-4B | PR #81에서 확정된 user ID가 있는 Discord 도전과제 링크를 `/users/:id`로 이동했습니다. 나머지 compatibility/API/type/example surface는 의미와 증거에 따라 유지 또는 defer했습니다. |
| F-5      | 제거 구조의 재도입 guard를 최종 점검하고 `sandboxGameAdapter` guard를 보강했으며, 이 current status 문서와 docs index를 연결했습니다.                                             |

## REMOVED

| 단위                                            | 완료 결과                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publisher별 runtime과 오래된 경로의 긍정형 설명 | `StaticGameRegistry`, `CreatorGameHost`, `transitionalCreatorGameResolver`, `sandboxGameAdapter`, `LegacyReactRuntime`, `/official-games`, `official-uploads`, release-map을 현재 동작처럼 설명하던 문구를 제거하거나 generic 구조로 고쳤습니다. 부정형 guard와 Historical 기록은 남습니다. |
| 미사용 Web dev helper                           | 호출자가 없던 `fetchDevGameDetail`과 `createDevGame`을 제거했습니다. 서버 compatibility endpoint는 별도 분류로 유지합니다.                                                                                                                                                                  |
| Core compatibility barrel                       | 중복 `repositories/interfaces.ts`와 duplicate root export를 제거하고 실제 `ports/repositories.ts`만 유지했습니다.                                                                                                                                                                           |
| Dormant R2 adapter                              | export, binding, composition, workflow consumer가 없던 `R2GameBundleRepository`를 제거했습니다. B2 구현은 유지됩니다.                                                                                                                                                                       |
| Web source game loader runtime                  | `gameLoaders.generated.ts`, `GAME_LOADERS`, `gameRegistry`, `loadGame()`, loader generator/check/test 책임과 네 official source game package의 Web dependency를 제거했습니다. Gameplay는 `GameHost` → `IframeRuntime` → generic versioned bundle만 사용합니다.                              |
| 확정 가능한 `/profile` 내부 consumer            | `/owogg achievements`가 이미 확보한 OwOGG `user.id`로 `/users/:id`를 가리키도록 이동했습니다. `/owogg profile`도 같은 current 경로를 사용합니다.                                                                                                                                            |
| Git/deploy official bootstrap authority         | 코드 배포가 게임 bytes와 live pointer를 덮어쓰던 bootstrap step과 package command를 제거했습니다. OWOGG publication authority는 관리자 센터의 인증된 ZIP 업로드입니다.                                                                                                                      |
| Git game catalog와 남은 소비자                  | Discord, 도전과제, 개인화, Streamer/서버 랭킹, 관리자 모니터링, 사용자 프로필을 D1/B2 public game catalog로 이전했습니다. `game-registry`, 생성 manifest/definition, registry generator/check/schema, 정적 Web registry를 삭제하고 재도입 guard를 추가했습니다.                             |

## KEEP_REQUIRED

| 단위                                           | 현재 필요한 이유                                                                                                                                   | 보존할 invariant / 재검토 조건                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Negative architecture/test coverage            | 제거된 runtime, route, release-map, source loader의 복귀를 CI에서 막습니다.                                                                        | 더 강한 동등 guard가 생기기 전에는 token guard와 `/official-games` 404 test를 유지합니다.                                                  |
| USER review/control plane                      | generic `games`/`game_versions`/`game_assets`와 developer/admin API가 신청, 두 review slot, approve/reject/revoke, audit, visibility를 담당합니다. | `READY != APPROVED`를 유지하고 runtime readiness로 review 권한을 대체하지 않습니다.                                                        |
| USER rolling-deploy compatibility mirror       | `sandbox_*` 물리 테이블은 이전 Worker revision과의 롤링 배포 호환을 위해 임시로 남아 있습니다.                                                     | Staging 전체 Game Creator smoke와 rollback window 종료 후 새 forward migration으로만 제거합니다.                                           |
| migrations `0029`~`0034`과 convergence trigger | old/new Worker deployment gap의 identity/version/asset write를 generic table로 수렴시키고 충돌 시 fail closed합니다.                               | 적용된 migration은 수정·삭제하지 않습니다. 제거가 필요하면 production cutover 증거, 새 forward migration, rollback plan이 모두 필요합니다. |

## DEFER_PRODUCT_DECISION

### 과거 Game Creator `GameOwner` / `GameDefinition` surface

- 현재 상태: `CreatorGameDefinition`, `CreatorGameOwner`, `isCreatorOwned`,
  `isCreatorGameDefinition`은 production consumer 없이 unit test와 `@owogg/core` root barrel에
  남아 있습니다.
- 지금 제거하지 않는 이유: source-only package의 root export가 외부에 약속된 계약인지 repository
  evidence만으로 결정할 수 없습니다.
- 종료 조건: `@owogg/core`의 지원 범위와 CREATOR union의 제품 의도를 결정하고, 외부 consumer가
  없거나 migration 경로가 있음을 확인합니다.
- 보존 invariant: 이 타입 surface를 정적 게임 목록이나 runtime/publication fallback으로 사용하지 않습니다.

### `examples/ball-dodge`와 manual deploy-smoke fixture

- 현재 상태: production validator를 재사용하는 수동 build/verify artifact이며 자동 CI consumer는
  없습니다.
- 지금 제거하지 않는 이유: maintainer/operator가 지원 예제나 수동 점검에 사용하는지는 repository로
  증명할 수 없습니다.
- 종료 조건: 지원 여부를 결정해 지원하면 소유자와 자동 검증을 명시하고, 미지원이면 대체 안내와 함께
  두 artifact의 관계를 정리합니다.
- 보존 invariant: CI 미사용만을 삭제 근거로 삼지 않으며 production deploy/smoke를 cleanup에서
  실행하지 않습니다.

## DEFER_PRODUCTION_EVIDENCE

### Generic publication/asset direct-write cutover

- 지금 종료할 수 없는 이유: USER publication과 logo write가 아직 sandbox control-plane row를 통해
  시작되고 migrations `0030`~`0033` trigger가 generic identity/version/asset으로 수렴시킵니다.
- 필요한 증거: 모든 production Worker가 direct generic write를 사용한다는 배포 증거, old Worker
  rollback window 종료, data parity, atomic write/rollback 검증.
- 종료 조건: generic command repository와 새 forward migration을 도입하고 기존 migration history는
  보존합니다.
- 보존 invariant: `READY != APPROVED`, USER review 독립성, exact authority와 conflict fail-closed.

### 환경 기반 admin credential fallback

- 지금 종료할 수 없는 이유: managed `admin_accounts`가 없는 환경의 bootstrap/recovery 경로이며 deploy가
  아직 `ADMIN_LOGIN_USERNAME`, `ADMIN_PASSWORD_PBKDF2`를 공급합니다.
- 필요한 증거: 모든 production environment의 managed admin bootstrap 완료, 비상 복구 절차,
  deploy secret/variable 제거 계획.
- 종료 조건: route fallback과 deploy inputs를 한 cutover에서 제거하고 회귀 테스트를 현재 모델로
  갱신합니다.
- 보존 invariant: admin authorization은 fail closed하며 lockout을 유발하는 부분 삭제를 하지 않습니다.

### Raw session-token fallback

- 지금 종료할 수 없는 이유: hashed lookup 실패 후 raw legacy row를 찾아 lazy migration하는 경로이며,
  unexpired raw session이 0개라는 production 증거가 없습니다.
- 필요한 증거: 최대 TTL을 지난 cutover 시점과 production raw-row 부재 또는 강제 migration 완료.
- 종료 조건: fallback과 전용 regression test를 함께 제거해도 active session이 무효화되지 않음을
  증명합니다.
- 보존 invariant: token 비교와 migration은 fail closed하며 raw auth token을 client/iframe에 노출하지
  않습니다.

## DEFER_EXTERNAL_COMPATIBILITY

### `/profile`

- 지금 제거할 수 없는 이유: old bookmark/OAuth/외부 링크 수명을 알 수 없고, user ID가 없는 일부 내부
  로그인 안내와 Wiki 링크에는 `/users/:id`를 안전하게 만들 정보가 없습니다.
- 현재 동작: 로그인 사용자는 `/users/:id`로 이동하고 로그아웃 사용자는 로그인 prompt를 받습니다.
- 종료 조건: user ID가 없는 내부 consumer의 명시적 로그인 동작을 정하고 internal consumer를 0으로
  만든 뒤, 외부 telemetry 또는 compatibility lifetime을 확정합니다.
- 보존 invariant: 공개 프로필은 `/users/:id`, 자기 설정/편집은 `/settings`이며 의미가 확실한 consumer만
  이동합니다.

### `/sandbox-games/:slug`

- 지금 제거할 수 없는 이유: repository 내부 gameplay consumer는 0개지만 old bookmark/external link
  사용 종료를 증명할 수 없습니다.
- 종료 조건: compatibility lifetime 또는 telemetry를 정한 뒤 redirect route와 regression test를 함께
  제거합니다.
- 보존 invariant: 유지 기간에는 slug를 보존해 `/games/:slug`로 `replace` redirect합니다.

### `POST /api/dev/games`

- 지금 제거할 수 없는 이유: Web UI는 bundle upload flow로 이동했지만 외부 API caller 정책과
  telemetry가 없습니다.
- 종료 조건: external caller 부재나 deprecation/migration 기간을 확인하고 endpoint, contract,
  route-specific test를 함께 제거합니다.
- 보존 invariant: 유지 기간에는 authorization, review-slot 제한과 request validation을 약화하지
  않습니다.

## 최종 architecture·security·persistence invariant

- Runtime read authority는 `ComposedRuntimeGameRegistry`가 generic D1 identity/version과 B2 canonical
  document/bundle을 조합하는 경로입니다.
- Web gameplay는 provider-neutral `GameHost`와 sandboxed `IframeRuntime`을 사용합니다.
- iframe에 `allow-same-origin`을 추가하지 않고 raw auth/session token을 전달하지 않습니다.
- Score acceptance는 signed single-use attempt와 canonical policy validation을 유지합니다.
- USER review authority와 generic runtime readiness를 합치지 않습니다: `READY != APPROVED`.
- applied D1 migration을 rewrite/delete/squash하지 않습니다.
- production deploy/write, B2 object 삭제, destructive migration은 이 cleanup campaign에서 수행하지
  않았습니다.

## Stale text 최종 판정

`StaticGameRegistry`, `CreatorGameHost`, `transitionalCreatorGameResolver`, `sandboxGameAdapter`,
`LegacyReactRuntime`, `GAME_LOADERS`, `loadGame(`, `/official-games`, `official-uploads`, `release map`,
`release-map`을 repository 전체에서 다시 확인했습니다.

- 실제 implementation/import/call/build/publication consumer: 0
- `scripts/architecture-rules*`: 제거 구조를 금지하는 negative guard/test
- API `/official-games` test: 제거 route가 404를 유지하는 negative regression
- current architecture/guide와 E2E comment: 제거 구조를 사용하지 않는다는 부정형 설명
- `LEGACY_LEDGER.md`: F-0 시점의 Historical 기록

따라서 Historical/negative occurrence는 stale positive consumer가 아니며 삭제 대상에서 제외합니다.
