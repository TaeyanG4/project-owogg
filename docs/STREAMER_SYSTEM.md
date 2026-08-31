# Streamer 시스템 SSoT

이 문서는 OwOGG Streamer 연결·심사·관리 기능의 단일 진실 공급원입니다. 구현 기준은 이 문서가
포함된 최신 `staging` tree이며, Production 승격 전에는 같은 tree의 Staging acceptance를 다시 확인합니다.

## 1. 제품 정의

OwOGG에는 하나의 **Streamer** 상태만 존재합니다. 별도의 등급·배지·파트너 계층을 두지 않습니다.

- 사용자에게 제공하는 플랫폼은 YouTube, CHZZK, Twitch입니다. SOOP 식별자는 기존 데이터와 안전한
  실패 처리를 위해 내부 계약에만 예약하며 설정·랭킹·Wiki·관리자 UI에는 노출하지 않습니다.
- OAuth 소유권 확인과 OwOGG Streamer 승인은 서로 다른 상태입니다.
- 연결한 플랫폼 계정마다 독립적으로 같은 수동 심사를 받아야 합니다.
- canonical 채널은 최초 연결 사용자의 심사·감사 이력에 고정하며 다른 사용자에게 조용히 재할당하지 않습니다.
- 하나 이상의 플랫폼 계정이 승인되면 사용자 프로필은 Streamer입니다.
- 다른 플랫폼의 승인·거절은 이미 승인된 플랫폼의 결정을 덮어쓰지 않습니다.
- 예약 실행 기반 심사는 현재 범위에서 동작하지 않습니다. 수동 흐름을 완성한 뒤 별도 요구사항과 실제
  provider 계약을 검토해 마지막 단계로 설계합니다.

## 2. 상태 모델

### 2.1 사용자 단위

| 상태         | 의미                                                      |
| ------------ | --------------------------------------------------------- |
| `UNVERIFIED` | 승인된 플랫폼이 없고 신청이 대기 또는 거절된 상태         |
| `VERIFIED`   | 소유권이 유효하고 Streamer 승인을 받은 플랫폼이 하나 이상 |
| `SUSPENDED`  | 운영자가 Streamer 프로그램 노출을 일시 또는 무기한 중단   |

`SUSPENDED` 해제 시 승인된 플랫폼이 남아 있으면 `VERIFIED`, 없으면 `UNVERIFIED`로 돌아갑니다.

### 2.2 플랫폼 계정 단위

두 상태를 분리해서 저장합니다.

1. 소유권 상태: `UNVERIFIED | VERIFIED | REJECTED`와 만료 시각
2. Streamer 승인 상태: `PENDING | APPROVED | REJECTED`

승인 조건은 소유권이 `VERIFIED`이고 만료 시각이 존재하며 현재보다 미래인 플랫폼 계정입니다. 승인 후
소유권이 무효화되면 해당 플랫폼의 승인도 철회하고, 다른 승인 플랫폼이 없을 때만 사용자 단위 상태를
`UNVERIFIED`로 바꿉니다.

### 2.3 심사 단위

심사 row는 항상 하나의 `streamer_platform_account_id`를 대상으로 합니다.

| 필드      | 값                                                          |
| --------- | ----------------------------------------------------------- |
| 유형      | `INITIAL`, `RECONSIDERATION`, `OWNERSHIP_REVERIFY`          |
| 작업 상태 | `QUEUED`, `ON_HOLD`, `APPROVED`, `REJECTED`, `CANCELLED`    |
| 요청 출처 | `USER`, `ADMIN`, `MIGRATION`                                |
| 결정      | `STREAMER_APPROVED`, `STREAMER_REJECTED`, `REAUTH_REQUIRED` |
| 동시성    | claim lease와 optimistic `row_version`                      |
| 추적      | `correlation_id`, 공개 사유 코드, 비공개 내부 메모          |

활성 심사는 플랫폼 계정당 하나만 허용합니다. 재심은 과거 row를 다시 열지 않고 `parent_review_id`를
가리키는 새 row로 만듭니다. terminal 결정은 job당 하나만 기록합니다.

## 3. 수동 심사 흐름

```text
사용자가 플랫폼 소유권 확인
  → 플랫폼 계정 approval=PENDING
  → INITIAL 심사 QUEUED 생성
  → 운영자 claim
  → 필요 시 지표 수동 갱신 / hold / 재인증 요청
  → 승인 또는 거절
  → 플랫폼 계정 상태와 사용자 Streamer 상태 재계산
  → immutable 감사 원장 기록
```

### 3.1 승인

- 소유권이 현재 `VERIFIED`인지 서버에서 다시 확인합니다.
- 심사에 고정된 정책 버전과 증거 snapshot을 결정 row에 기록합니다.
- 지표를 갱신하거나 결정을 내려도 진행 중인 심사의 정책 버전은 active version으로 바뀌지 않습니다.
- 해당 플랫폼만 `APPROVED`로 전이합니다.
- 사용자 프로그램이 정지 상태가 아니면 사용자 상태를 `VERIFIED`로 전이합니다.

### 3.2 거절

- 해당 플랫폼만 `REJECTED`로 전이합니다.
- 다른 승인 플랫폼이 있으면 사용자 Streamer 상태를 유지합니다.
- 승인 플랫폼이 없으면 사용자 상태를 `UNVERIFIED`로 전이합니다.

### 3.3 보류·재심·재인증

- 보류 종료 시각은 요청값 또는 active policy의 기본 보류시간을 사용합니다.
- 재심은 active job이 없고 cooldown이 지난 플랫폼에 새 row로 생성합니다.
- 재인증 요청은 소유권을 승인으로 추정하지 않으며, 사용자가 다시 공식 연결을 완료해야 합니다.
- 거절된 플랫폼의 OAuth를 다시 실행하는 것만으로는 새 심사를 만들지 않으며 정식 재심 흐름을 거칩니다.

## 4. 정책

정책값은 D1의 immutable version과 singleton active pointer로 관리합니다. JSX, API route, Cron 또는
번역 문자열에 업무값을 하드코딩하지 않습니다.

| 필드                           | 용도                                 |
| ------------------------------ | ------------------------------------ |
| `minimumAudience`              | 수동 심사 참고 최소 시청자 수        |
| `minimumChannelAgeDays`        | 수동 심사 참고 최소 채널 운영일      |
| `ownershipValidityDays`        | 소유권 유효기간                      |
| `reverificationNoticeDays`     | 만료 전 재인증 안내 시작일           |
| `verificationIntentTtlMinutes` | OAuth 연결 intent 유효시간           |
| `claimLeaseMinutes`            | 심사 담당자 claim 유효시간           |
| `reviewSlaHours`               | 신규 수동 심사 처리 목표시간         |
| `holdDefaultHours`             | 보류 기본시간                        |
| `reconsiderationCooldownDays`  | 재심 요청 최소 간격                  |
| `providerTimeoutSeconds`       | 소유권 확인·운영자 지표 요청 timeout |

정책 저장은 `expectedVersion`, 변경 사유와 함께 새 immutable version을 만들고 active pointer를 원자적으로
교체합니다. API는 D1에 저장된 각 필드의 최소값·최대값·증가 단위와 필드 간 제약을 다시 검증합니다.
자동 적용 예약, 자동 후보, 유지 기준, 자동 재검증 정책은 현재 모델에 없습니다.

## 5. Provider 경계

- Provider는 소유권 연결과 운영자의 명시적 지표 갱신 요청만 담당합니다.
- 채널 URL·handle·사용자 입력 ID는 소유권 증거로 사용하지 않습니다. token에 결박된 공식 `me` 계열
  API가 반환한 canonical platform user/channel ID만 저장합니다.
- 사용자 OAuth token은 장기 저장하지 않습니다.
- timeout, 5xx, schema drift를 승인 또는 거절로 해석하지 않습니다.
- 신규 연결 pause는 D1 `streamer_provider_settings`에서 관리합니다.
- pause는 새 OAuth 시작뿐 아니라 이미 시작된 callback도 막습니다.
- Provider 운영 화면은 OAuth 소유권 연결과 운영자 수동 지표 갱신 capability를 분리해 표시합니다.
- credential 값, token, provider raw response와 사용자 email은 관리자 API나 감사 로그에 노출하지 않습니다.
- YouTube는 Google OAuth 뒤 공식 [`channels.list(mine=true)`](https://developers.google.com/youtube/v3/docs/channels/list),
  Twitch는 user access token으로 식별자 query가 없는 공식
  [`GET /helix/users`](https://dev.twitch.tv/docs/api/reference/#get-users), CHZZK는 Naver
  [`account-interlock`](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization) 뒤
  [`GET /open/v1/users/me`](https://chzzk.gitbook.io/chzzk/chzzk-api/user)를 사용합니다.
- Twitch 본인 프로필 조회에는 사용자 권한 scope가 필요하지 않으므로 OAuth 요청에 이메일 scope를 추가하지
  않습니다.
- 위 세 OAuth 요청은 D1 `streamer_verification_intents`에 브라우저 `state`와 OwOGG session token의
  SHA-256 hash만 저장합니다. intent는 OwOGG user, 정확한 session, platform, 정책 TTL에 결박하고 callback
  시작 시 원자적으로 한 번만 소비합니다. 다른 사용자·다른 session·platform 바꿔치기·만료·재사용은
  provider code 교환 전에 거부합니다.
- CHZZK 연결은 현재 Open API의 `account-interlock` 및 camelCase token 계약을 사용하고 callback의
  `state`를 token 교환에도 그대로 전달합니다.
- [SOOP 공식 인증 계약](https://developers.sooplive.co.kr/docs/api/auth-token)의 현재 브라우저 callback은
  OwOGG가 발급한 `state`를 돌려주는 계약이 없습니다.
  따라서 공격자가 자기 SOOP authorization code를 다른 OwOGG 사용자의 callback에 주입하는 login-CSRF를
  확실히 차단할 수 없습니다. 임의 채널 입력이나 별도 인증번호 방식으로 대체하지 않고 API는
  fail-closed로 유지하며 사용자 UI에서는 항목 자체를 노출하지 않습니다. Provider가 `state` 또는 동등한
  안전한 callback 결박(PKCE 포함)을 공식 지원하고 실제 Staging acceptance를 통과할 때만 다시 검토합니다.

## 6. 관리자 화면

`/admin/streamers`는 다음 여섯 영역을 제공합니다.

| 영역          | 기능                                                         |
| ------------- | ------------------------------------------------------------ |
| 운영 개요     | 상태 집계와 긴급 수동 심사 목록                              |
| 스트리머 목록 | 사용자·플랫폼·승인 상태 검색, 상세, 정지·복구·소유권 관리    |
| 심사 작업함   | 플랫폼별 작업, claim/release/hold, 지표 갱신, 승인·거절·재심 |
| 정책 설정     | 수동 심사 기준과 운영시간 값 변경, version history           |
| Provider 운영 | 연결 capability와 credential 상태, 신규 연결 pause/resume    |
| 감사 이력     | 공개 사유와 내부 메모를 분리한 append-only 원장              |

### 6.1 Pagination

목록이 있는 모든 영역은 서버 pagination을 사용합니다.

- 허용 page size: `10 | 20 | 30 | 50`
- 운영 개요 심사 목록, 스트리머 목록, 심사 작업함, 정책 history, 감사 이력에 동일하게 적용합니다.
- 검색·플랫폼·승인 상태·담당자·작업 상태·감사 대상 필터는 page slice 전에 서버에서 적용합니다.
- page 변경과 page size 변경은 bounded `LIMIT/OFFSET` query만 실행합니다.
- page size 변경 시 page를 1로 되돌립니다.

## 7. 권한

| 권한                          | 허용 범위                                       |
| ----------------------------- | ----------------------------------------------- |
| `streamers.view`              | dashboard, 목록, 상세, 감사 읽기                |
| `streamers.review`            | claim, hold, 지표 갱신, 플랫폼별 승인·거절·재심 |
| `streamers.manage`            | 승인 철회, 소유권 무효화, 프로그램 정지·복구    |
| `streamers.policy.manage`     | 수동 심사 정책 저장                             |
| `streamers.operations.manage` | Provider 신규 연결 pause/resume                 |

`ADMIN`은 모든 권한을 가집니다. 초기 role policy는 `MODERATOR`에 view/review, `OPERATOR`에 다섯 권한을
부여하며 `SYSTEM_DEVELOPER`에는 자동 부여하지 않습니다.

## 8. 관리 API

- `GET /api/admin/streamers/workspace`
  - 모든 list의 page/pageSize와 검색·필터 query를 검증합니다.
- `POST /api/admin/streamers/actions`
  - typed action, target, reason, internal note, expected row version을 검증합니다.
  - mutation은 trusted Origin과 elevated admin session을 먼저 확인합니다.

주요 action은 다음과 같습니다.

- review: create, cancel, claim, release, hold, approve, reject, request reauth, refresh metrics,
  create reconsideration
- platform/program: revoke approval, invalidate ownership, suspend, restore
- policy: save a new version
- provider: pause/resume new connections

## 9. 공개 API와 노출

- 공개 프로필과 Streamer 랭킹은 사용자 상태가 `VERIFIED`이고, 소유권과 Streamer 승인이 모두 유효한
  플랫폼 계정만 사용합니다.
- 계층형 배지나 등급 필터는 제공하지 않습니다.
- 사용자 자신의 `/api/streamers/me`에는 연결 플랫폼별 소유권과 승인 상태를 표시합니다.
- 승인되지 않은 플랫폼은 공개 프로필과 랭킹에 노출하지 않습니다.

## 10. Migration 및 과거 호환

- 기존 migration 파일은 배포 이력이므로 수정하지 않습니다.
- `0051`은 `0039`의 `creator_*` 쓰기 호환 뷰와 활성 프로필의 과거 등급 컬럼을 제거합니다.
- 과거 등급값과 자동 심사·감사 row는 명시적인 `streamer_legacy_*` archive table로 옮겨 보존하며,
  runtime repository와 관리자 API는 archive를 읽거나 쓰지 않습니다.
- 신규 migration은 현재 소유권이 검증되어 공개 Streamer로 노출되던 플랫폼을 `APPROVED`로 보수적으로
  backfill해 기존 사용자의 공개 상태를 갑자기 제거하지 않습니다.
- 새 연결은 항상 `PENDING`과 플랫폼별 수동 심사로 시작합니다.
- OAuth intent에는 raw state/session을 저장하지 않으며, 사용 완료 row는 재사용할 수 없습니다.
- 새 관리 API의 유일한 작업·감사 원장은 `streamer_platform_reviews`와
  `streamer_admin_audit_log`입니다.

## 11. 검증 Gate

### 환경별 OAuth 등록 계약

Staging과 Production은 같은 provider app, client ID, client secret, API key를 공유하지 않습니다.
YouTube·Twitch·CHZZK에 환경별 앱을 각각 준비하고 GitHub에도 서로 다른 접두사로 등록합니다. GitHub
Actions가 이 값을 Worker의 generic runtime binding으로 매핑하는 지점만 공통입니다.

| 배포 환경  | Variable 저장 위치              | Secret 저장 위치              | 접두사        | API origin                  |
| ---------- | ------------------------------- | ----------------------------- | ------------- | --------------------------- |
| Staging    | `staging` Environment variables | `staging` Environment secrets | `STAGING_`    | `https://api-stg.owogg.com` |
| Production | Repository variables            | Repository secrets            | `PRODUCTION_` | `https://api.owogg.com`     |

각 환경의 위 Variable 저장 위치에 아래 값을 등록합니다. `{PREFIX}`는 위 표의 접두사입니다.

| Variable                             | 값/조건                                  |
| ------------------------------------ | ---------------------------------------- |
| `{PREFIX}STREAMER_ENABLED_PROVIDERS` | 전체 기능 검증 시 `YOUTUBE,TWITCH,CHZZK` |
| `{PREFIX}YOUTUBE_CLIENT_ID`          | 해당 환경의 Google OAuth Web client ID   |
| `{PREFIX}YOUTUBE_REDIRECT_URI`       | 아래 표의 해당 환경 YouTube callback     |
| `{PREFIX}TWITCH_CLIENT_ID`           | 해당 환경의 Twitch application client ID |
| `{PREFIX}TWITCH_REDIRECT_URI`        | 아래 표의 해당 환경 Twitch callback      |
| `{PREFIX}CHZZK_CLIENT_ID`            | 해당 환경의 CHZZK application client ID  |
| `{PREFIX}CHZZK_REDIRECT_URI`         | 아래 표의 해당 환경 CHZZK callback       |

Staging의 아래 Secret은 `staging` Environment secrets에, Production의 아래 Secret은 Repository
secrets에 등록합니다. 값은 채팅, 문서, PR, 로그, 일반 Variable에 복사하지 않습니다.

| Secret                          | 용도                                   |
| ------------------------------- | -------------------------------------- |
| `{PREFIX}YOUTUBE_CLIENT_SECRET` | YouTube OAuth code 교환                |
| `{PREFIX}YOUTUBE_API_KEY`       | 운영자가 요청한 YouTube 수동 지표 갱신 |
| `{PREFIX}TWITCH_CLIENT_SECRET`  | Twitch OAuth와 수동 지표 갱신          |
| `{PREFIX}CHZZK_CLIENT_SECRET`   | CHZZK OAuth와 수동 지표 갱신           |

Production job은 GitHub `production` Environment를 사용하지 않습니다. Production 비민감값은
Repository variables에, 민감값은 Repository secrets에만 두며 `PRODUCTION_*` 접두사로 Staging 값과
구분합니다. 별도의 승인 Gate가 필요해질 때만 Environment 도입을 독립된 운영 변경으로 검토합니다.

CHZZK 앱은 두 환경 모두 API Scope에서 `채널 정보 조회`와 `유저 조회`를 선택합니다. CHZZK API 문서의
`유저 정보 조회`가 콘솔의 `유저 조회`에 해당합니다. 전자는 운영자의 수동 지표 갱신에 사용하는
`GET /open/v1/channels` Client 인증을, 후자는 OAuth 사용자의 채널 소유권 확인에 사용하는
`GET /open/v1/users/me` Access Token 인증을 허용합니다. 그 밖의 관리자·방송·채팅·활동 제한 권한은
선택하지 않습니다.

callback은 provider 콘솔과 GitHub Variable에 정확히 같은 값을 등록합니다.

| Provider | Staging callback                                                  | Production callback                                           |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| YouTube  | `https://api-stg.owogg.com/api/streamers/verify/youtube/callback` | `https://api.owogg.com/api/streamers/verify/youtube/callback` |
| Twitch   | `https://api-stg.owogg.com/api/streamers/verify/twitch/callback`  | `https://api.owogg.com/api/streamers/verify/twitch/callback`  |
| CHZZK    | `https://api-stg.owogg.com/api/streamers/verify/chzzk/callback`   | `https://api.owogg.com/api/streamers/verify/chzzk/callback`   |

운영자가 직접 수행해야 하는 순서는 다음과 같습니다.

1. [Google OAuth Web app](https://developers.google.com/identity/protocols/oauth2/web-server)과
   [YouTube Data API credential](https://developers.google.com/youtube/registering_an_application),
   [Twitch application](https://dev.twitch.tv/docs/authentication/register-app),
   [CHZZK application](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization)을 Staging과 Production용으로
   각각 준비합니다.
2. 위 callback을 각 app에 등록합니다. Staging app에는 Production callback을, Production app에는
   Staging callback을 섞지 않습니다.
3. Staging Google OAuth consent screen에는 acceptance에 사용할 테스트 계정을 등록합니다. Production은
   실제 사용자 공개 전에 필요한 publishing status, scope 검토와 정책 정보를 완료합니다.
4. GitHub `staging` Environment에는 `STAGING_*` Variable과 Secret을 등록합니다. Production의
   `PRODUCTION_*` Variable과 Secret은 각각 Repository variables와 Repository secrets에 등록합니다.
   Staging과 Production에는 서로 다른 provider app과 credential을 사용합니다.
5. 먼저 Staging 배포·provenance와 세 provider의 실제 OAuth 왕복, 수동 지표 갱신, 플랫폼별 독립 심사를
   검증합니다.
6. 동일 tree의 Staging 검증이 끝나고 사용자가 해당 릴리스의 Production 승격을 명시적으로 승인한 뒤에만
   `staging → main`으로 승격해 Production preflight와 배포를 실행합니다.
7. Production에서도 세 provider의 `configured=true`, 실제 OAuth 왕복과 callback origin을 별도로
   확인합니다. Staging 결과를 Production acceptance로 대신하지 않습니다.

2026-09-01 이름 감사 기준으로 Staging의 `STAGING_*` Variable/Secret과 Production의
`PRODUCTION_*` Repository variable 일곱 개 및 Repository secret 네 개를 등록했습니다. 잘못 두었던
`production` Environment의 같은 이름 Variable은 Repository 값과 일치함을 확인한 뒤 제거했습니다.
새 Production workflow는 Environment 값이나 과거 generic 이름을 읽지 않습니다. Production 배포 검증이
끝나기 전에는 과거 항목을 삭제하지 않으며, 이후 별도 승인된 정리 대상으로 분류합니다.

### 로컬 구현 완료

- fresh/upgrade migration과 중복 active review guard 통과
- 두 플랫폼을 연결한 한 사용자의 심사가 서로 독립적으로 승인·거절되는 테스트 통과
- 다른 승인 플랫폼이 있을 때 한 플랫폼 거절이 사용자 Streamer 상태를 제거하지 않는 테스트 통과
- page size 10/20/30/50, filter-before-pagination API 테스트 통과
- permission, Origin, stale row version, claim lease, terminal decision 경쟁 테스트 통과
- canonical 채널 재할당 방지, 정책 constraint, 심사 정책 pin, callback pause 테스트 통과
- OAuth 사용자·session·platform 결박, state 만료·재사용, 타 사용자 canonical 채널 탈취 방지 테스트 통과
- YouTube·Twitch·CHZZK token-bound canonical identity adapter 테스트 통과; SOOP fail-closed 보류 테스트 통과
- 전체 `pnpm verify` 통과
- 스트리머 인증 Wiki의 데스크톱·390px 모바일 렌더와 브라우저 오류 없음 확인

### Staging

로컬 완료만으로 배포 완료라고 표현하지 않습니다. `docs/STAGING.md`에 따라 Staging D1 migration,
CI/CD, Access를 통한 실제 Web 진입, API/Web provenance, 플랫폼별 수동 심사 acceptance를 모두 확인해야
`Staging 검증 완료(Production 승격 대기)`입니다.

Staging Actions는 Repository-level Production credential을 읽지 않습니다. GitHub `staging`
Environment의 `STAGING_STREAMER_ENABLED_PROVIDERS`와 provider별 `STAGING_*_CLIENT_ID`,
`STAGING_*_CLIENT_SECRET`, `STAGING_*_REDIRECT_URI`를 preflight한 뒤 Worker runtime 이름으로만
매핑합니다. YouTube는 운영자의 수동 지표 갱신을 위해 `STAGING_YOUTUBE_API_KEY`도 요구합니다.
선택한 provider의 값이 하나라도 없거나 callback이 `api-stg.owogg.com`의 정확한 경로가 아니면 배포 전에
실패합니다. 활성 목록의 허용값은 `YOUTUBE`, `TWITCH`, `CHZZK`이며 SOOP은 fail-closed로 거부합니다.

이 단계에서 YouTube·Twitch·CHZZK의 실제 provider 계정 OAuth 왕복과 인증된 설정·관리자 화면의 API 연동을
브라우저로 확인합니다. SOOP은 실제 계정 acceptance 대상이 아니며 fail-closed API 회귀 테스트와 공개
UI 비노출 테스트만 수행합니다.

### Production

Production Actions job은 GitHub Environment를 사용하지 않고 Repository variables와 Repository
secrets에서 `PRODUCTION_*` 값을 읽습니다. 원격 D1 migration보다 먼저
`PRODUCTION_STREAMER_ENABLED_PROVIDERS`와 선택된 provider의 `PRODUCTION_*` 자격증명 및 정확한
`api.owogg.com` callback을 검증합니다. SOOP, 빈 목록, 중복/알 수 없는 provider, Staging callback,
목록에 없는 provider의 잔여 credential은 배포 전에 실패합니다.

Production provider 등록이나 preflight 구현 완료는 Production 배포 승인이 아닙니다. 위 Staging 검증과
릴리스별 명시적 승격 승인, Production 배포·provenance·실계정 OAuth acceptance가 모두 별도 Gate입니다.

## 12. 현재 작업 상태

- UI 검토 Gate는 통과했습니다.
- 제품 모델은 단일 Streamer와 플랫폼별 수동 심사로 확정했습니다.
- 기존 예시 프리뷰와 등급 UI는 제거했습니다.
- migration·API·실제 datasource 연결과 관리자 UI 구현 및 로컬 통합 검증을 완료했습니다.
- YouTube·Twitch·CHZZK callback은 OwOGG 사용자·정확한 session·플랫폼·일회용 intent에 결박했습니다.
- SOOP은 현재 공식 OAuth callback만으로 본인 결박을 증명할 수 없어 공개 UI에서 숨기고 API는
  fail-closed로 유지합니다.
- Staging과 Production workflow의 환경별 provider credential 매핑, callback·누락·SOOP 활성화
  preflight, API readiness smoke 연결을 완료했습니다. 환경별 접두사로 credential 공유와 fallback을
  막습니다.
- 전체 자동 검증과 인증 Wiki의 데스크톱·모바일 렌더 검증을 완료했습니다.
- 외부 provider 콘솔의 Staging/Production 앱 생성과 14개 credential 준비를 완료했으며, CHZZK는
  `채널 정보 조회`와 `유저 조회` scope로 등록했습니다. GitHub의 Staging Environment 설정과 Production
  Repository variables/secrets 등록도 완료했습니다. 실제 provider 계정 OAuth 왕복과 인증된
  설정·관리자 화면의 브라우저 acceptance를 환경별로 진행합니다.
- Staging이나 Production에는 아직 반영하지 않았습니다.
