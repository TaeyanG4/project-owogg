# OwOGG Generic Multiplayer Relay 전환 계획

상태: 구현 중인 단일 기준 계획

기준일: 2026-08-30

기준 브랜치: `staging` (작업 브랜치는 최신 Staging에서 분기)

이 문서는 OwOGG 온라인 멀티플레이를 게임별 server ruleset/driver 방식에서 공용 WebSocket
Relay 방식으로 전환하는 유일한 활성 계획입니다. 이전 M1/M2 driver, managed-template, Creator
template beta 계획 문서는 삭제했으며 새 구현의 근거로 사용하지 않습니다.

공개 authoring 규격과 내부 canonical은 모두 `schemaVersion: 1` 하나만 유지합니다. 새 버전 번호를
추가하지 않고 v1을 확장하며 구 manifest/canonical reader 호환성은 목표에 포함하지 않습니다.

---

## 1. 최종 제품 결정

### 1.1 실행 축

- 공개 transport: `websocket`
- runtime 종류: `relay | worker | container`
- 첫 출시에서 활성화 가능한 조합: `websocket + relay`
- `worker`와 `container` 요청은 형태를 식별할 수 있어도 심사 저장·profile 활성화 전에
  `MULTIPLAYER_RUNTIME_NOT_AVAILABLE`로 거부한다.
- runtime 종류 추가는 같은 `owogg.json` v1 안의 additive capability 확장으로 처리한다.

### 1.2 책임 경계

OWOGG가 담당한다.

- D1/B2의 exact game/version/content hash 확인
- 방 생성·코드 입장·Ready·방장 시작·퇴장·재접속
- parent-owned join ticket, WebSocket과 iframe MessagePort
- participant/seat/role 권위와 connection generation
- sender spoof, duplicate, replay, stale generation 차단
- payload/rate/byte/target/room-lifetime 제한
- broadcast/direct delivery와 선택적 bounded opaque snapshot
- hibernation, slow-consumer 격리와 운영 kill switch

게임 ZIP이 담당한다.

- 게임 규칙, 상태 머신, 물리, 턴, 충돌 해결
- host 또는 peer netcode
- payload 내부 schema와 application-level revision
- 승패·무승부·재경기 표시
- 로컬 상태와 Relay snapshot 내용

Relay가 검증하지 않는다.

- 불법 행동과 게임 규칙 위반
- client physics, winner와 hidden information의 진실성
- host가 만든 상태·snapshot·결과의 공정성
- bot, collusion 또는 application-level cheat

따라서 Relay 온라인 결과는 항상 `UNVERIFIED`이며 score leaderboard, reward, XP, MMR, ranked,
score-based achievement에 연결하지 않는다. 서버 권위 게임이 필요한 경우 이후 Hosted Worker 또는
승인 Container runtime으로 분리한다.

### 1.3 지원 인원

- 첫 Relay 계약은 2~8명이다.
- UI의 16-slot 준비 코드는 실제 지원 근거가 아니다.
- 8명을 넘는 확장은 fanout, slow-client, payload, DO duration과 reconnect 부하 측정 뒤 contract,
  D1, protocol, UI를 함께 변경한다.

---

## 2. 목표 `owogg.json` v1 요청

아래는 Phase 1에서 strict parser/schema/contract test로 고정할 목표 형태다. creator 입력은 권한이
아니라 exact-version runtime 심사 요청이다.

```json
{
  "schemaVersion": 1,
  "game": {
    "playModes": ["local-multi", "online-multi"]
  },
  "multiplayer": {
    "version": 1,
    "transport": {
      "kind": "websocket",
      "protocolVersion": 1
    },
    "runtime": {
      "kind": "relay"
    },
    "players": {
      "min": 2,
      "max": 8
    },
    "features": {
      "reconnect": "resume",
      "directMessages": true,
      "hostSnapshot": true,
      "joinInProgress": false,
      "spectators": false
    }
  }
}
```

다음은 public manifest에 넣지 않는다.

- game slug별 ruleset key/revision
- board, win length, reaction rounds, paddle field 같은 게임 규칙
- Worker binding, endpoint, secret, WebSocket URL
- server rate/byte/storage 상한
- reward, ranked 또는 verified-result 권한
- 임의 executable server code

승인 profile은 최소한 다음을 server-owned 값으로 고정한다.

- `gameId`, `gameVersionId`, `contentHash`, request hash와 profile revision
- transport/runtime/protocol version
- min/max players와 허용 visibility/join policy
- reconnect, host departure와 snapshot policy
- max message bytes, messages per second, room bytes, snapshot bytes와 room TTL
- `resultTrust: UNVERIFIED`
- enabled/disabled 상태

`rulesetKey`, `rulesetRevision`, `resolvedConfigJson`, M1/M2 class와 game-specific driver ID는 최종
profile에서 제거한다.

---

## 3. Relay Security Baseline

Relay runtime은 다음을 모두 만족해야 한다.

1. ticket과 socket은 parent GameHost만 소유하고 iframe에는 MessagePort만 전달한다.
2. server가 `participantId`, `seatIndex`, `role`을 attachment에서 부착한다.
3. client payload의 sender/host/seat 주장은 무시한다.
4. `generation + connectionGeneration + clientSeq + serverSeq`를 검증한다.
5. stale connection, duplicate/replay sequence와 이미 소비된 ticket을 거부한다.
6. JSON-safe payload, 단일 message bytes, 초당 count/bytes와 room aggregate를 제한한다.
7. direct target은 같은 active generation의 참가자만 허용한다.
8. host-only operation과 snapshot write 권한을 server role로 확인한다.
9. snapshot은 opaque이지만 크기, update rate, hash와 generation을 제한한다.
10. reconnect 시 최신 bounded snapshot과 이후 server sequence만 재전달한다.
11. slow consumer는 해당 socket만 격리하고 room 전체를 막지 않는다.
12. 정상 relay message마다 D1 row를 만들지 않는다.
13. 게임 tick/timer를 실행하지 않아 idle DO가 hibernate할 수 있어야 한다.
14. room expiry/reconnect deadline처럼 플랫폼 lifecycle에 필요한 bounded alarm만 허용한다.
15. host close/result payload는 UI용 unverified summary일 뿐 영속 경쟁 결과가 아니다.
16. 참가자별 ping은 parent 전용 auto-response heartbeat로 측정하고 최소 30초 간격의 bounded report만
    DO에 전달한다. latency control은 게임 iframe과 application sequence/rate 예산에서 분리한다.
17. application `messagesPerSecond`는 1초 burst capacity의 token bucket으로 적용해 지속 전송률은
    제한하면서 정상 20Hz timer jitter가 고정 window 경계에서 연결을 닫지 않게 한다.

초기 host departure 정책은 `close`로 고정한다. host migration은 참가자 권위·snapshot 소유권·split
brain 정책이 별도로 검증된 뒤 additive feature로 연다.

---

## 4. 현재 코드 분류

### 4.1 유지·재사용

- 방 create/join/leave/Ready/start lifecycle
- D1 instance/participant/lease와 0~7 seat allocation
- Lobby UI와 stateless Hibernation signal object
- profile/version discovery와 exact-version room pin
- parent-owned bridge, ticket과 one-time connection generation
- socket hibernation attachment, payload/rate/queue/backpressure guard
- PlayConfig, gs2 verifier, single/local result와 leaderboard 경계
- D1/B2 public catalog와 ZIP publication

### 4.2 Relay 기준 리팩터링 완료 대상

- `packages/game-sdk/src/contracts/multiplayerManifest.ts`
- `packages/core/src/modules/multiplayer/domain/multiplayerCapability.ts`
- `packages/core/src/modules/multiplayer/domain/multiplayerProfile.ts`
- `packages/core/src/modules/multiplayer/domain/multiplayerProfileRequest.ts`
- `packages/core/src/modules/multiplayer/domain/multiplayerJoinTicket.ts`
- `packages/core/src/modules/multiplayer/application/multiplayerAdmissionUseCases.ts`
- `packages/core/src/modules/multiplayer/application/managedMultiplayerProfileReviewUseCases.ts`
- `apps/api/src/multiplayer/MultiplayerInstanceObject.ts`
- `packages/game-sdk/src/bridge/multiplayerProtocol.ts`
- `packages/game-sdk/src/bridge/multiplayerClient.ts`
- `apps/web/app/features/game/runtime/MultiplayerIframeRuntime.tsx`
- `packages/core/src/modules/multiplayer/application/multiplayerRoomUseCases.ts`
- Admin profile review/activation API와 게임별 exact-version 운영 UI (별도 전역 큐 UI는
  2026-08-30 제거)

### 4.3 Relay cutover에서 삭제 완료

- `apps/api/src/multiplayer/rulesets/MultiplayerRulesetDriver.ts`
- `apps/api/src/multiplayer/rulesets/OmokM1Driver.ts`
- `apps/api/src/multiplayer/rulesets/ReactionM2Driver.ts`
- `apps/api/src/multiplayer/rulesets/PaddleM2Driver.ts`
- `apps/api/src/multiplayer/rulesets/registry.ts`
- `packages/core/src/modules/multiplayer/rules/omokRules.ts`
- `packages/core/src/modules/multiplayer/rules/omokActionLedger.ts`
- `packages/core/src/modules/multiplayer/rules/reactionDuelRules.ts`
- `packages/core/src/modules/multiplayer/rules/paddleDuelRules.ts`
- `packages/core/src/modules/multiplayer/rules/supportedRulesets.ts`
- `packages/core/src/modules/multiplayer/application/officialMultiplayerProfileUseCases.ts`
- `OMOK_V1`, `official:omok`, fixed managed-template activation과 관련 test/fixture

Relay 계약·runtime·회귀 테스트를 먼저 통과시킨 뒤 삭제했으며 대체 구현 없는 선삭제는 수행하지 않았다.

### 4.4 일반화·이름 변경 완료

- `seatIndex: 0 | 1`, left/right player와 singular opponent를 2~8인 roster로 바꾼다.
- `requestedByOpponent`를 participant request set/quorum으로 바꾼다.
- `MultiplayerLegacyFlowGate`는 `SelectedTopologyAuthorityGate`처럼 실제 역할로 이름을 바꾼다.
- runtime resolution의 `LEGACY`는 `GENERIC`으로 바꾼다.
- verified session source 이름은 token wire prefix와 분리해 `verifiedGameSession`으로 정리했다.

### 4.5 삭제하면 안 되는 false positive

- 경쟁 싱글게임의 reviewed verifier는 leaderboard 신뢰 경계이며 multiplayer driver와 무관하다.
- `gs2`는 manifest/schema 버전이 아니라 server-verified session token의 wire prefix다.
- historical migration은 runtime compatibility code가 아니다.
- applied migration, audit row와 D1/B2 identity는 이름에 legacy가 있어도 소비자를 확인하기 전 삭제하지
  않는다.

---

## 5. DB 전환 원칙

- 이미 적용된 `packages/db/migrations/*`는 수정하거나 삭제하지 않는다.
- 현재 dirty tree의 `0024`~`0033` 변경은 사용자 소유로 간주해 이 작업에서 건드리지 않는다.
- 다음 사용 가능한 번호의 forward migration으로 generic runtime profile을 추가하거나 table을 rebuild한다.
- Staging에서 old multiplayer profile/room/match row 수를 먼저 read-only 확인한다.
- 데이터가 0건이어도 destructive Staging migration은 별도 배포 승인 뒤 실행한다.
- runtime reader/writer가 generic profile로 전환된 뒤에만 구 ruleset columns/table을 제거한다.
- migration history 자체를 물리적으로 squash하려면 모든 D1 환경을 재생성하는 별도 승인 작업으로 분리한다.

---

## 6. 단계와 가중 진행도

전체 목표는 unified v1, single/local verifier, generic Relay, 레거시 제거, Staging 검증과 현재 등록 게임
재작성까지 120점으로 둔다.

| 단계        | 작업                                        | 점수 | 상태 | 완료 Gate                                         |
| ----------- | ------------------------------------------- | ---: | ---- | ------------------------------------------------- |
| 완료 기반   | unified v1, PlayConfig, gs2 verifier/result |   67 | 완료 | 현재 local 검증 기록 유지                         |
| 재사용 기반 | room/lobby/D1/ticket/bridge/reconnect       |   13 | 완료 | game-specific 부분 분리 inventory 완료            |
| Phase 0     | dirty tree/SSoT/삭제 경계 동결              |    1 | 완료 | 이 문서와 문서 index가 새 계획만 가리킴           |
| Phase 1     | generic manifest request/control gate       |    4 | 완료 | fixed template/ruleset 없는 strict parse/review   |
| Phase 2     | Relay data plane와 security baseline        |    8 | 완료 | broadcast/direct/sequence/snapshot/reconnect 검증 |
| Phase 3     | Bridge/SDK/N-player UI와 lifecycle          |    5 | 완료 | 2~8인, singular opponent 제거                     |
| Phase 4     | Admin/D1 generic profile 전환               |    3 | 완료 | content hash pin과 runtime availability gate      |
| Phase 5     | driver/template/Omok/legacy naming 정리     |    3 | 완료 | 금지 식별자가 active runtime에서 0건              |
| Phase 6     | generic fixture/load/Staging E2E            |    6 | 진행 | 코드 변경 없는 임의 ZIP과 두 사용자 E2E           |
| Phase 7     | 모든 등록 구 게임 v1 ZIP 재작성             |   10 | 진행 | 검증 ZIP과 SHA-256 inventory 전달                 |

Phase 0 시작 전 기준은 80/120점, 67% 완료·33% 남음이었다. Phase 0 완료 기준은 81/120점,
67.5% 완료·32.5% 남음이다. Phase 1 완료 기준은 85/120점, 70.8% 완료·29.2% 남음이다. 각 Phase가
끝날 때 완료율, 계획 준수, 계획 변경과 검증 범위를 이 문서의 각 Phase 기록에 남긴다. Phase 2 완료
기준은 93/120점, 77.5% 완료·22.5% 남음이고 Phase 3 완료 기준은 98/120점, 81.7% 완료·18.3% 남음이다.
Phase 4 완료 기준은 101/120점, 84.2% 완료·15.8% 남음이다. Phase 5 완료 기준은 104/120점,
86.7% 완료·13.3% 남음이다.

---

## 7. 구현 순서

### Phase 0 — SSoT와 안전 경계

1. 이 문서를 활성 계획으로 등록한다.
2. 구 driver 계획 문서에 superseded 표시를 넣는다.
3. dirty tree의 사용자 소유 변경과 삭제 대상을 분리한다.
4. historical migration 불변 원칙을 기록한다.
5. 코드·DB·ZIP은 아직 삭제하지 않는다.

### Phase 1 — Public request contract와 control gate

1. fixed template union을 transport/runtime/features 요청으로 교체한다.
2. 공개 JSON Schema와 SDK type을 같은 strict shape로 맞춘다.
3. 요청을 exact game version에 묶고 canonical serialization/hash로 저장한다.
4. Phase 1 시점에는 generic profile schema가 없었으므로 새 요청을 구 M1/M2 ruleset profile로 변환하지
   않고 `PROFILE_SCHEMA_NOT_AVAILABLE`로 fail closed한다. 이 임시 gate는 Phase 4의 Relay profile
   schema와 별도 activation으로 대체한다.
5. relay만 요청 가능하게 하고 worker/container와 아직 지원하지 않는 Relay feature는 mutation 전에
   fail closed한다.

Phase 1 구현 중 계획의 책임 배치를 명확히 조정했다. explicit `contentHash`를 새 generic profile에
저장하고 room/ticket까지 전파하는 작업은 D1/profile schema를 실제로 교체하는 Phase 4와 해당 값을
소비하는 Phase 2~3에서 수행한다. Phase 1은 기존 immutable `gameVersionId`에 요청을 고정하고 request
hash를 보존한다. 이 분리는 구 ruleset profile에 새 요청을 억지로 끼워 넣지 않기 위한 순서 조정이며,
최종 content hash pin 요구사항을 제거한 것은 아니다.

### Phase 2 — Relay data plane

1. `RELAY_SEND` broadcast/direct와 server-attached sender metadata를 추가한다.
2. monotonically increasing client/server sequence와 replay guard를 추가한다.
3. host-only bounded opaque snapshot과 reconnect recovery를 추가한다.
4. payload/rate/byte/target/slow-consumer 제한을 적용한다.
5. driver action/state/tick/terminal 경로를 호출하지 않는 Relay branch를 완성한다.
6. per-message D1 write와 game timer가 없음을 검증한다.

Phase 2는 2026-08-29 로컬 구현과 검증을 완료했다.

- join ticket을 ruleset claims와 Relay claims의 strict union으로 분리했다. Relay claims는
  `rulesetKey`/`rulesetRevision` 없이 server-owned runtime policy만 전달한다.
- `MultiplayerInstanceObject` 안의 Relay 분기와 독립 `RelayRuntimeSession`을 추가했다. Relay helper는
  DO SQLite의 `relay_authority`/`relay_runtime` 두 테이블만 사용하며 D1 action/result ledger나 게임
  timer를 열지 않는다.
- broadcast/direct, server-attached sender, client/server sequence, 동일 generation target 확인,
  profile별 payload/rate/room-byte 제한과 slow-consumer 격리를 적용했다.
- host-only 16 KiB 이하 opaque snapshot을 SHA-256 hash와 함께 DO SQLite에 보존해 hibernation/eviction
  뒤 reconnect sync에 사용한다.
- host 이탈은 즉시 방을 닫고, 일반 참가자는 30초 reconnect grace 뒤 `PARTICIPANT_LEFT`로 방을 닫는다.
  만료 뒤 발급된 늦은 reconnect ticket도 alarm 지연과 무관하게 거부한다. room TTL은 하나의 bounded
  alarm으로 처리한다.
- Phase 2 runtime branch는 fail-closed 상태로 존재한다. 실제 generic profile 저장·content hash pin과
  Relay ticket 발급은 Phase 4에서 연다. 기존 ruleset branch는 Phase 5 cutover/삭제 전까지만 회귀
  호환 경로로 남긴다.
- 계획 범위나 순서는 바꾸지 않았다. explicit content hash의 최종 authority가 Phase 4라는 Phase 1의
  책임 배치를 그대로 지켰다.

### Phase 3 — Bridge, SDK와 N-player UX

1. iframe bootstrap에서 ruleset을 제거하고 runtime/self/roster/capabilities를 전달한다.
2. SDK에 send/broadcast/direct/snapshot/subscription API를 제공한다.
3. 2인 left/right surface를 generic roster로 교체한다.
4. rematch는 request set/quorum 또는 새 generation start로 일반화한다.
5. 같은 ZIP의 local-multi와 online-multi authority 격리를 유지한다.

Phase 3은 2026-08-29 로컬 구현과 검증을 완료했다.

- iframe bootstrap에서 `rulesetKey`/`rulesetRevision`을 제거하고 credential-free
  runtime/self/seat-ordered 2~8인 roster/capabilities 계약으로 교체했다. 기존 authoritative runtime 표시는
  Phase 5 cutover 전 회귀용 임시 branch일 뿐 ruleset identity를 iframe에 노출하지 않는다.
- SDK와 주입형 `window.OWOGG.multiplayer`에 strict `send`/`broadcast`/`direct`/`snapshot`과 subscription을
  추가했다. runtime/generation/server sequence, JSON-safe shape와 byte/capability/host 권한을 iframe과
  parent 양쪽에서 검증한다.
- Web surface를 고정 left/right 카드에서 2~8인 roster grid로 바꾸고 participant별 연결 상태를 표시한다.
  Relay close 상태는 sticky terminal overlay로 처리한다.
- rematch 응답을 singular opponent boolean 대신 seat-ordered requested/required participant set과 full quorum
  상태로 바꿨다. D1의 rematch write는 이미 모든 현재 참가자의 READY quorum을 요구하므로 SQL을 중복
  변경하지 않고 공용 계약·projection·UI만 일반화했다. 별도 4인 partial-consent 회귀 테스트를 추가했다.
- `local-multi`의 generic lifecycle/gs2와 `online-multi`의 multiplayer bridge는 계속 상호 배타적이다.
- 계획 범위와 순서는 변경하지 않았다. 당시 다음 단계였던 generic profile/content hash authority는
  Phase 4에서 열었다.

### Phase 4 — Control plane와 D1

1. official Omok preset 대신 generic runtime review/activation을 제공한다.
2. profile request는 creator identity와 exact immutable version에 묶는다.
3. 새 forward migration과 repository parser를 적용하고 explicit content hash를 generic profile에 pin한다.
4. generic profile의 exact content hash를 room/ticket에 전파하고 admission에서 재확인한다.
5. old profiles는 활성화하지 않고 runtime unavailable/disabled로 fail closed한다.

Phase 4는 2026-08-30 로컬 구현과 검증을 완료했다.

- migration `0045`와 D1 repository를 generic `RELAY` profile authority로 전환했다. 요청·승인 profile·
  room instance·join ticket·public profile·iframe bootstrap·DO authority는 모두 exact
  `(gameId, gameVersionId, contentHash, profileRevision)`을 확인한다.
- 관리자가 요청을 승인하면 disabled profile만 생성된다. exact-version review/activation API와 D1 안전
  경계는 유지한다. 게임 관리 화면의 전역 Relay 심사 패널은 내부 도구 UI와 책임이 겹쳐 제거하고,
  현재 라이브 버전의 요청·프로필 상태와 승인·활성화 조작은 해당 게임의 관리 카드 안으로 이동했다.
  이 UI 정리는 자동 승인이나 manifest 자체 권한으로의 정책 변경이 아니다.
- 현재 활성 가능한 조합은 `websocket + relay`뿐이다. worker/container와 지원되지 않는 Relay capability는
  review 전에 fail closed하고, generic profile은 `PRIVATE + OPEN`만 허용한다. 따라서 일회용 invite API도
  OPEN room에서 `FORBIDDEN`으로 닫힌다.
- migration은 기존 ruleset profile을 disable하고 새 legacy insert/enable을 막는다. runtime reader는
  `profile_kind = 'RELAY'`만 조회하므로 구 profile은 새 room/ticket 권한이 될 수 없다.
- Phase 5 삭제 전 회귀 경계를 유지하기 위해 Workers의 구 Omok/Reaction/Pong driver 시나리오 24개는
  임시 skip 처리했다. generic Relay Workers 시나리오 13개는 계속 실행된다. Phase 5에서는 skip 이름만
  남기지 않고 해당 driver/test/helper/import를 함께 삭제한다.
- 계획 범위와 순서는 변경하지 않았다. 구현 중 public bootstrap까지 explicit content hash를 전파하고,
  승인 profile 재조회 API를 추가해 별도 activation이 transient UI state에 의존하지 않도록 보강했다.

### Phase 5 — Legacy 제거

1. Relay가 같은 회귀 시나리오를 통과한 뒤 driver/rules/registry를 삭제한다.
2. fixed templates, OMOK preset, game-specific server config와 관련 UI를 삭제한다.
3. tests를 game name이 없는 relay fixtures로 바꾼다.
4. active docs에서 M1/M2 driver와 Creator managed-template beta를 제거한다.
5. core exports와 architecture guard에 금지 식별자 검사를 추가한다.

Phase 5는 2026-08-30 로컬 구현과 검증을 완료했다.

- 게임별 driver/rules/registry와 official Omok preset·fixture, fixed template 및 서버 action/finalization
  경로를 삭제했다. 활성 멀티플레이는 공용 Relay control/data plane만 사용한다.
- active rematch API·repository·UI 계약을 제거했다. 재대결은 향후 게임이 Relay 메시지로 자체 구현하거나
  새 room/generation을 시작하는 transport 바깥 정책으로 남긴다.
- 구 action/result/reward D1 물리 테이블과 `0041`의 구 profile 컬럼은 적용된 migration 불변 원칙에 따라
  삭제하지 않았다. 활성 runtime consumer는 없으며, 참조 테이블까지 함께 재구성하는 별도 forward
  migration 전까지 historical schema로만 유지한다.
- active source 금지 식별자와 per-message D1 ledger 복원을 막는 architecture guard를 추가했다. Core
  607개, DB 253개, SDK 92개, Web 176개, API 395개, Workers 17개, script 63개 회귀와 루트
  `pnpm verify`가 통과했다.
- 계획의 범위와 순서는 변경하지 않았다. 다음 단계는 game-name-free 4인 fixture와 공격·부하·Staging
  증거를 만드는 Phase 6이다.

### Phase 6 — 무종속성 증명

1. 임의 slug의 turn-like, simultaneous, realtime-like fixture를 같은 Relay로 실행한다.
2. 실제 4인 입장/Ready/start/broadcast/direct/leave/reconnect를 검증한다.
3. 네 번째 새 ZIP을 플랫폼 source 변경 없이 추가한다.
4. spoof, stale, duplicate, oversized, rate, cross-room target와 snapshot 권한을 공격 테스트한다.
5. 2~8인 fanout, hibernation과 비용을 측정한다.
6. 별도 승인 뒤 Staging 두 사용자 browser E2E를 수행한다.

Phase 6은 2026-08-30 로컬 검증 슬라이스를 진행 중이다.

- 하나의 game-agnostic Relay profile로 실제 4인 입장, Ready/start quorum, turn-like broadcast,
  simultaneous-like direct, realtime-like broadcast, 연결 손실·resume, 명시적 leave/abort를 관통했다.
- 8명이 각각 broadcast한 8개 메시지를 전체 roster가 받아 총 64개 fanout delivery를 검증했다. server
  sequence는 1~8로 단조 증가했고 D1 action write는 0건이었다.
- spoofed sender, stale generation, duplicate sequence, oversized payload/snapshot, rate/room-byte,
  cross-room target, non-host snapshot 공격 회귀를 실행한다.
- `examples/relay-protocol-probe`는 플랫폼 active source에 slug binding 없이 manifest v1과
  `window.OWOGG.multiplayer`만 사용하는 2~8인 ZIP이다. production bundle 전처리 검증을 통과한 현재
  재현 가능한 ZIP SHA-256은 `dfd02698c262aeb107e4492ed0e73e5a642b7e20a9a947c45d0e13037135661`이다.
- 공개 게임과 Relay protocol fixture를 혼동하지 않도록 `game_settings.catalog_role`의 서버 소유
  `GAME | INTERNAL_TOOL` 분류를 추가했다. manifest는 이 값을 선언하지 못하며, 내부 도구는 public
  catalog에서 제외되고 관리자 전용 탭의 공용 대기실·Relay 실행 UI에서 점검한다. fixture slug는
  active platform source에 결합하지 않는다.
- Staging 두 사용자 browser E2E, hibernation 전후 실제 wall-time/요청량, 2~8인 지속 부하·비용 측정은
  아직 수행하지 않았다. 공식 가격과 현재 per-message storage 경로를 반영한 계산기와 로컬 전용 실행
  runbook `docs/runbooks/multiplayer-relay-load-gate.md`를 추가했다. 운영·보안 runbook은 저장소 정책에
  따라 배포 tree에 포함하지 않으며, attachment metadata 과금은 실제 metrics 확인 항목으로 남겼다.
  따라서 Phase 6 점수는 아직 반영하지 않고 104/120점, 86.7% 완료·13.3% 남음으로 유지한다.

사용자 지시에 따라 남은 Phase 6 부하·hibernation 증거보다 Phase 7을 먼저 구현하고, tester scroll 수정과
Phase 7 변경을 한 번의 Staging 배치로 검증한다. 이는 구현 순서 변경이며 최종 Gate나 Production 승인
경계를 줄인 것이 아니다.

### Phase 7 — 등록 구 게임 재작성

1. 시작 시점의 D1/B2 live 게임 목록을 read-only로 동결한다.
2. 각 게임을 unified `owogg.json` v1로 다시 작성한다.
3. online 게임은 Relay SDK를 사용하고 single/local 경쟁 게임은 필요한 경우 gs2 verifier를 사용한다.
4. standalone, ZIP layout, strict manifest, production bundle 금지와 authority 테스트를 수행한다.
5. 등록용 ZIP과 SHA-256 inventory를 전달한다.
6. live 삭제·재등록은 사용자가 수행하며 에이전트는 별도 승인 없이 D1/B2를 변경하지 않는다.

Phase 7은 2026-08-30 로컬 구현과 산출물 검증을 완료했고 Staging Gate를 진행 중이다.

- Staging 관리자 D1 기반 목록을 새로고침해 GAME 5개 `official-omok`, `reaction-time`, `aim-test`,
  `typing-test`, `memory-test`와 INTERNAL_TOOL 1개 `relay-protocol-probe`를 동결했다. 내부 도구는
  삭제·게임 재등록 대상이 아니다.
- 5개 모두 root 6-file standalone ZIP source와 unified manifest v1로 재작성했다. 오목은 같은 ZIP의
  `local-multi + online-multi`이며 자유 오프닝 렌주 금수와 online application rule/state/win 처리는
  ZIP 안에만 있다.
- 최초 conformance fixture 중심 재작성은 제품 UI·상호작용·로고를 불필요하게 버린 범위 판단 오류로
  확인했다. historical 게임의 UI·상호작용·로고와 재사용 가능한 로직은 복원하고, 신뢰할 수 없는
  client score/random/session 연결부만 seed/evidence/Relay 경계로 교체했다.
- 모든 게임은 `await OWOGG.whenReady()` 뒤 공개 descriptor를 읽는다. 에임과 타자의 실제 선택지만
  게임 내부에 표시하고, difficulty/variant가 각각 한 개뿐인 반응속도·기억력은 선택기를 숨겨 바로
  시작한다. 오목은 manifest의 `playModes`에서 local/online 런처를 만들고 score/leaderboard를 사용하지
  않는다. 다섯 게임 모두 한국어·영어, 소리 설정과 재시작을 게임 내부에서 제공한다.
- 경쟁 싱글 4종은 `reaction-time-v1`, `aim-test-v1`, `typing-test-v1`, `memory-test-v1` reviewed
  verifier가 seed/config/evidence를 검증하고 서버에서 점수를 계산한다. 이는 Relay driver가 아니라
  leaderboard 신뢰 경계이며 intended slug/revision 불일치를 fail closed한다.
- 브라우저 규칙과 서버 verifier parity, manifest, ZIP path/size, 금지 network API, Bridge 호출,
  deterministic rebuild를 검증했다. 재현 SHA와 bytes는 `examples/official-games-v1/inventory.json`에
  고정했다.
- 1280×900 및 390px 폭 로컬 browser 검증에서 다섯 게임의 내부 선택기·언어·소리·local 전환,
  반응속도 호흡, 오목 재대결과 가로 overflow가 없음을 확인했고 browser console 오류는 0건이었다.
- 관리자 공식 게임 업로드는 ZIP 여러 개를 선택해 직렬 게시하고, 개별 실패를 격리해 파일별 결과를
  표시한다. 최종 ZIP은 `project-owogg-games/<slug>/<slug>_v1.zip`에 불변 백업하며 같은 버전명의 내용이
  달라지면 덮어쓰지 않고 빌드를 실패시킨다.
- 삭제된 game workspace의 tsconfig/lock importer와 Web의 반응속도 전용 tier 결과 UI를 제거했다.
  active Relay runtime에는 게임 slug/driver/ruleset 종속이 없다.
- 루트 `pnpm verify`와 별도 strict ZIP 검증이 모두 통과했다.
- 남은 Gate는 단일 Staging 배포, 사용자의 다중 ZIP 등록·업데이트, 오목 exact-version profile
  승인/활성화와 5종 browser acceptance다. 이 Gate 전에는 Phase 7 점수 10점을 완료로 반영하지 않는다.

---

## 8. 최종 완료 판정

다음을 모두 만족해야 generic Relay가 완료된 것으로 본다.

- active runtime에 `official:omok`, `OMOK_V1`, `turn-grid`, `reaction-arena`,
  `realtime-paddle`가 없다.
- `switch(gameSlug)`, `switch(rulesetKey)`, `switch(templateId)`로 runtime을 선택하지 않는다.
- 새 Relay ZIP 등록에 API/Core/Web source 수정이 필요하지 않다.
- 2~8인 contract와 4인 실제 integration이 통과한다.
- worker/container 요청은 review/activation 전에 fail closed한다.
- idle room은 hibernate하며 relay message마다 D1 action row를 만들지 않는다.
- Relay 결과가 leaderboard/reward/XP/MMR로 흐르지 않는다.
- local-multi와 online-multi를 같은 ZIP에서 선택할 수 있다.
- `pnpm format`, `pnpm verify`, relevant Workers/browser tests가 통과한다.
- Staging 배포 SHA/provenance와 두 사용자 E2E가 확인된다.

로컬 검증, Staging 배포, Staging acceptance와 Production 승격은 서로 다른 완료 상태로 보고한다.
Production은 별도 명시적 승인이 없으면 변경하지 않는다.
