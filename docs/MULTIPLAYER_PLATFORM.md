# OwOGG Multiplayer Platform 구현 계획

상태: 구현 중인 기준 계획

마지막 검증: 2026-08-27

기준 브랜치: `staging` (구현은 최신 `staging` 기반 `feature/*`/`fix/*` 브랜치)

이 문서는 OwOGG 멀티플레이 플랫폼의 구현 범위, 보안 불변식, 단계별 완료 조건과 운영 Gate를
추적하는 단일 계획 문서입니다. 현재 구현 사실은 코드, D1 migration, Wrangler 설정과 배포
워크플로가 우선하며, 이 문서의 미완료 항목을 구현된 기능으로 해석하지 않습니다.

기존 `MULTIPLAYER_GAME_DESIGN.md`는 Reaction Duel만을 다룬 과거 제안입니다. 해당 문서와 이
문서가 충돌하면 이 문서를 따릅니다.

---

## 1. 범위와 완료 정의

### V1에서 구현한다

- 공통 `MultiplayerInstance` 도메인과 exact game-version pin
- 서버가 승인한 version-scoped multiplayer profile
- 서버 권위형 M1/M2 게임 규칙
- GameHost 소유 WebSocket과 sandbox iframe용 양방향 Bridge
- SQLite-backed Durable Object + WebSocket Hibernation 기반 공통 transport/lifecycle shell
- M1 Simple reference: 오목
- M2 Event reference: Reaction Duel
- M2 Continuous reference: Pong
- 4인 fanout/access reference
- M1 Advanced reference: hidden information과 동시 응답을 검증하는 게임
- 결과, 업적, 통계, XP의 server-authoritative finalization
- canonical 승패 기록은 보존하되 멀티플레이 점수 리더보드·랭킹은 제공하지 않음
- Creator용 managed multiplayer template와 `owogg.json` v2 beta 경로
- Staging 격리, diagnostics, 부하·비용 계측과 kill/drain 운영 경로

### V1에서 구현하지 않는다

- M0 게임 자체. 기존 local multiplayer 호환성만 회귀 테스트로 보호한다.
- M3 rollback runtime
- M4 high-fanout dedicated runtime
- M5 persistent world runtime
- M6 distributed world runtime
- Creator가 업로드하는 임의 `server.ts`, WebSocket URL, API URL 또는 서버 plugin
- 멀티플레이 점수 리더보드, Elo/MMR, ranked/현금성 보상
- text/voice chat, spectator, 자동 matchmaking, Elo/MMR, full replay
- Git workspace, 정적 registry 또는 deploy bootstrap을 통한 runtime 게임 등록

### Multiplayer V1 종료 조건

다음이 모두 Staging에서 실제 검증되어야 한다.

```text
기존 single/local-multi 회귀 없음
+ M1 Simple
+ M1 Advanced
+ M2 Event realtime
+ M2 Continuous realtime
+ 4인 fanout
+ PUBLIC/UNLISTED/PRIVATE access
+ diagnostics
+ exactly-once result/achievement/XP
+ exact version/ruleset lease
+ Creator managed-template beta
```

로컬 `pnpm verify` 성공은 구현 완료일 뿐 Staging 검증 완료가 아니다. 실제 배포 상태 표현과
승격 절차는 `STAGING.md`를 따른다.

---

## 2. 변경 불가능한 보안·권위 불변식

1. D1/B2는 게임 identity, version, publication, official 표시와 영속 결과의 runtime authority다.
2. Durable Object는 D1이 승인한 Instance 내부의 진행 중 match만 조정한다. 게임이나 profile을
   스스로 만들 수 없다.
3. iframe은 신뢰하지 않는다. 승자, score, XP, achievement, clock, position 또는 hidden state를
   권위 값으로 제출할 수 없다.
4. GameHost만 세션, API, join ticket, WebSocket을 소유한다. iframe에는 credential, API URL,
   WebSocket URL 또는 global user ID를 전달하지 않는다.
5. `allow-same-origin`을 sandbox에 추가하지 않는다.
6. 게임 CSP는 현재 엔진 호환 계약인 `connect-src 'self' blob:`을 유지한다. API/WS origin을
   추가하지 않고 `play` hostname의 API/WS route를 서버에서 거절한다.
7. Creator archive는 official 여부, ruleset, backend, reward policy 또는 서버 코드를 결정하지 않는다.
8. 모든 server ruleset은 Worker build에 포함된 정적 allowlist다. generic RPC, `eval`, runtime
   script loading을 제공하지 않는다.
9. active match가 사용하는 game version, profile revision, ruleset revision과 protocol version을
   in-place 수정하지 않는다.
10. terminal match의 D1 commit 전에는 canonical result와 reward를 확정하지 않는다.
11. 관리형 멀티게임은 score leaderboard, rank, Elo/MMR에 참여하지 않는다. 승·패·무승부는
    canonical match history로만 보존한다.
12. aborted, self-match 또는 eligibility 미달 match에는 0 XP event도 생성하지 않는다.
13. secret, raw ticket, password, hidden state와 arbitrary payload를 로그에 남기지 않는다.

---

## 3. M0~M6와 Runtime을 분리하는 3축 모델

`MultiplayerClass`, simulation model과 runtime backend는 서로 다른 축이다.

```text
Capability Class: M0 | M1 | M2 | M3 | M4 | M5 | M6
Simulation Model: local | turn | event | realtime | rollback | world
Runtime Backend: local | durable-object | dedicated | cluster
```

Creator와 game bundle은 class/backend를 선택하지 않는다. safe capability와 managed template을
요청하면 플랫폼이 class를 검증·결정하고 runtime resolver가 내부 backend를 고른다.

| Class | 의미                                    | Reference                  | V1 상태                    |
| ----- | --------------------------------------- | -------------------------- | -------------------------- |
| M0    | 네트워크 없는 local multiplayer         | 한 키보드/기기 2인         | 게임 미구현, 호환성만 보호 |
| M1    | 턴·행동·이벤트 기반 authoritative match | 오목, 카드, 마작           | 구현                       |
| M2    | 소규모 event/continuous realtime        | Reaction, Pong, 2~8인 파티 | 구현                       |
| M3    | latency-critical deterministic rollback | 격투                       | Gate만 유지                |
| M4    | medium-scale high-fanout instance       | Arena                      | Gate만 유지                |
| M5    | persistent world와 zone/shard           | Minecraft-lite             | architecture note만 유지   |
| M6    | distributed large world                 | MMO                        | architecture note만 유지   |

플레이어 수는 class hard rule이 아니다. V1의 8인 제한은 안전 상한일 뿐이며 class resolver는 다음
측정값을 사용한다.

- simulation frequency
- fanout과 message rate
- CPU/tick duration
- state/snapshot size
- reconnect와 persistence 복잡도
- latency SLO
- load-test 결과

V1 runtime resolver는 M1/M2를 공통 Durable Object transport/lifecycle shell에 연결할 수 있지만,
domain class에 Cloudflare나 D1 이름을 하드코딩하지 않는다.

---

## 4. Control Plane과 Live Runtime

```text
OwOGG Web / GameHost
 ├─ Auth, create, join, invite, ticket ── API Worker ── D1
 ├─ WebSocket ───────────────────────── MultiplayerInstanceObject
 │                                       └─ allowlisted official/template ruleset
 └─ MessageChannel ───────────────────── sandbox game iframe

B2: exact version static bundle
D1: game/version/profile/instance/participant/result/reward
DO: authorized active instance sockets and live authoritative state
```

### 영속 authority

- D1 `games`/`game_versions`: identity, owner, publisher, visibility, READY/live/deleted state
- B2 immutable bundle: `(gameId, versionId, contentHash)`
- D1 multiplayer profile: exact version에 승인된 capability/ruleset/reward snapshot
- D1 match/finalization/reward ledger: canonical terminal history

### 활성 authority

- 한 Instance에 하나의 Durable Object
- lobby, connections, ready state, active match state, sequence와 backpressure
- M1 accepted action 또는 phase boundary를 DO SQLite에 저장
- M2 continuous tick은 memory에서 실행하고 D1에 frame/tick을 저장하지 않음
- DO가 재시작된 active realtime match는 V1에서 `ABORTED_INFRA`, reward 없음

---

## 5. Version-scoped trusted multiplayer profile

V1 profile 최소 계약:

```ts
interface ApprovedMultiplayerProfileV1 {
  gameId: number;
  gameVersionId: number;
  sourceRequestHash: string | null;

  profileRevision: number;
  protocolVersion: 1;
  resolvedClass: "M1" | "M2";
  simulationModel: "turn" | "event" | "realtime";
  runtimeBackend: "durable-object";

  rulesetKey: string;
  rulesetRevision: number;

  lifecycle: "match" | "continuous";
  persistence: "match";
  latencyProfile: "relaxed" | "interactive";
  reconnectPolicy: "none" | "rejoin" | "resume";

  minPlayers: number;
  maxPlayers: number;
  allowedVisibility: readonly ("PUBLIC" | "UNLISTED" | "PRIVATE")[];
  allowedJoinPolicies: readonly ("OPEN" | "INVITE_ONLY")[];

  maxActionBytes: number;
  maxStateBytes: number;
  actionRateLimit: number;

  rewardPolicyId: string | null;
  enabled: boolean;
}
```

권위 pin은 다음 tuple 전체다.

```text
gameVersionId
+ profileRevision
+ rulesetKey@rulesetRevision
+ protocolVersion
```

새 Instance는 현재 live/READY/enabled exact version만 사용한다. live version 변경 뒤에도 기존
Instance는 version lease 동안 exact asset과 ruleset을 계속 사용할 수 있다. kill switch와 forced
delete는 lease보다 우선하며 관련 match를 audit 가능한 reason으로 abort한다.

---

## 6. `owogg.json`과 Creator multiplayer

### v1 호환

- 기존 manifest v1 `game.mode: "multi"`는 local/coarse metadata다.
- v1만으로 online multiplayer를 활성화하지 않는다.
- D1 approved profile이 없으면 public API는 online multiplayer를 노출하지 않는다.
- 기존 v1 single/local game의 결과·플레이 흐름은 유지한다.
- approved online profile에는 generic score session과 `/api/scores/:slug` 리더보드를 열지 않는다.

### 계획된 v2 request

`owogg.json` v2는 권한이 아니라 Creator의 요청이다.

```json
{
  "$schema": "https://owogg.com/schemas/manifest/v2.json",
  "schemaVersion": 2,
  "game": {
    "slug": "creator-omok",
    "title": "Creator Omok",
    "genre": "board",
    "mode": "multi",
    "playModes": ["online-multi"]
  },
  "multiplayer": {
    "kind": "managed-template",
    "template": { "id": "turn-grid", "version": 1 },
    "players": { "min": 2, "max": 2 },
    "requirements": {
      "simulation": "turn",
      "lifecycle": "match",
      "persistence": "match",
      "latency": "relaxed",
      "reconnect": "resume",
      "hiddenInformation": false,
      "simultaneousResponse": false,
      "joinInProgress": false,
      "spectators": false
    },
    "config": {
      "boardWidth": 15,
      "boardHeight": 15,
      "winLength": 5
    },
    "client": { "protocolVersion": 1 }
  }
}
```

Creator manifest에 허용하지 않는다.

```text
resolvedClass / runtimeBackend / backendClass
arbitrary rulesetKey / latest template version
rewardPolicy / XP amount / official / verified
multiplayer score leaderboard / rank / Elo / MMR
API URL / WebSocket URL / external server
server code / schema URL / secret
```

Upload 흐름:

```text
ZIP upload
→ strict manifest v2 parse
→ managed template/config semantic validation
→ exact USER-owned game version
→ multiplayer profile request PENDING_REVIEW
→ automated contract/security tests
→ admin review
→ server-resolved approved profile
→ Staging validation
→ enabled
```

V1 구현은 OWOGG-owned official profile부터 시작한다. Creator beta는 오목, Reaction, Pong과 M1
Advanced에서 template 경계가 검증된 뒤 공개한다. Creator는 custom server code를 올릴 수 없다.

---

## 7. Instance, participant와 match lifecycle

### 서로 독립인 축

```text
visibility: PUBLIC | UNLISTED | PRIVATE
joinPolicy: OPEN | INVITE_ONLY
lifecycle: MATCH | CONTINUOUS
runtimeBackend: internal only
```

`public_code`는 random opaque locator이며 authorization secret이 아니다. `INVITE_ONLY`는 별도
single/limited-use invite token을 요구한다. password는 OPEN/INVITE와 abuse 정책을 검증한 후의 후속
기능으로 남긴다.

### Instance 상태

```text
CREATED → LOBBY → STARTING → ACTIVE → CLOSING → CLOSED
                                  └──(+1 generation)──→ LOBBY
                    └───────────────→ ABORTED
CREATED/LOBBY ─────────────────────→ EXPIRED
```

### Match 상태

```text
PENDING → ACTIVE → FINALIZING → COMMITTED
             └───────────────→ ABORTED
```

한 Instance에는 한 generation당 active match 하나만 둔다. 같은 Instance에서 rematch가 필요하면
`CLOSING → LOBBY` 전이와 같은 원자적 write에서 generation을 정확히 1 증가시킨다. 다른 전이는
generation을 바꿀 수 없다.

### 참가자 연결

- `(instance_id, user_id)` unique
- Instance-scoped opaque participant ID 사용
- 재접속마다 connection generation 증가
- 이전 ticket/socket/iframe generation의 message 거절
- V1 Reaction은 reconnect `none`: disconnect 즉시 abort
- M1 Advanced는 reconnect `resume`
- lobby host는 authority가 아니다. host leave 정책은 profile/lifecycle에 따라 close 또는 deterministic
  transfer로 결정하고 구현 전 acceptance에 고정한다.

---

## 8. D1 데이터 모델과 원자성

계획 테이블:

| 테이블                               | 목적                                 | 필수 제약                            |
| ------------------------------------ | ------------------------------------ | ------------------------------------ |
| `multiplayer_profile_requests`       | Creator exact-version 요청/심사      | version unique, request hash         |
| `multiplayer_profiles`               | 승인된 trusted profile               | game/version/profile revision unique |
| `multiplayer_instances`              | Instance metadata와 version snapshot | random public code unique            |
| `multiplayer_participants`           | membership/role/generation           | instance+user unique                 |
| `multiplayer_invites`                | hashed invite와 use counter          | token hash unique                    |
| `multiplayer_matches`                | generation별 match/finalization      | instance+generation unique           |
| `multiplayer_match_players`          | canonical participant result         | match+user unique                    |
| `multiplayer_match_actions`          | M1 action idempotency                | match+user+clientActionId unique     |
| `multiplayer_reward_outbox`          | exactly-once reward                  | match+user+policy unique             |
| `multiplayer_instance_admin_actions` | 관리자 강제 종료 감사                | operation ID unique                  |
| `game_version_leases`                | active exact-version serving         | version+instance unique              |

SQLite foreign key만으로 game/version ownership을 표현하기 어려우면 기존 game-version migration의
trigger 관례를 재사용한다.

### 원자적 write 요구

- Instance create는 HTTP idempotency key를 사용한다.
- capacity increment, participant insert와 invite use increment를 guarded batch로 묶는다.
- CAS update 0행은 SQL failure가 아니므로 모든 후속 statement도 선행 `changes()`에 조건부로 실행한다.
- M1 action ledger는 payload hash, expected/applied revision과 결과를 보관한다.
- 동일 clientActionId + 동일 payload는 저장된 결과를 반환한다.
- 동일 clientActionId + 다른 payload는 abuse/conflict로 거절한다.
- stale revision은 typed error와 최신 projected revision/state를 반환한다.
- public code와 invite token 생성은 collision retry를 갖는다.
- 초대 URL은 token을 HTTP query가 아닌 fragment에만 두고, 참가 성공 시 parent history에서 제거한다.
  기존 query 링크는 전환 기간 동안 읽기 호환만 제공한다.

### Finalization과 reward

```text
DO terminal state + FINALIZING outbox durable commit
→ D1 match/player/result + reward outbox idempotent commit
→ DO COMMITTED
→ client TERMINAL_COMMITTED
→ progression reward worker exactly-once 적용
```

DO와 D1은 하나의 transaction이 아니므로 alarm/backoff와 reconciliation이 필요하다. D1 commit 전에는
`TERMINAL_PENDING`만 표시한다.

기존 progression repository의 event insert와 aggregate update는 멀티 reward에 사용하기 전에 하나의
원자적 적용 경로로 보강한다. `source_id`는 `<matchId>:<userId>`이며 game cap 계산에는 canonical
game slug를 사용한다.

---

## 9. Server ruleset과 runtime driver

공통 shell은 다음만 소유한다.

```text
auth/ticket/socket
connection generation
message envelope/limits
instance/match lifecycle
storage/finalization
diagnostics/backpressure
```

게임별 module은 다음을 소유한다.

```text
state/action schema
legal action validation
turn/tick transition
viewer projection
terminal outcome
disconnect policy
```

초기에는 `omokRules`, `reactionDuelRules`, `pongRules`를 명시적으로 구현한다. 실제 중복이 확인되기
전에 generic state engine, runtime plugin API 또는 arbitrary action framework를 만들지 않는다.

최소 내부 계약:

```ts
interface MultiplayerRuleset<State, Action, View> {
  createInitialState(context: ServerContext): State;
  parseAction(input: unknown): Action;
  applyAction(
    state: State,
    actor: Actor,
    action: Action,
    context: ServerContext,
  ): Transition<State>;
  tick?(state: State, context: ServerContext): Transition<State>;
  project(state: State, viewer: Viewer): View;
  getTerminalResult(state: State): TerminalResult | null;
}
```

clock과 RNG는 서버 context로 주입하고 테스트에서 deterministic하게 대체한다. `Math.random()`과
client timestamp를 authoritative 판정에 사용하지 않는다.

### Runtime별 동작

- M1 turn: accepted action마다 compact DO state/action revision을 저장하고 idle hibernation
- M2 event: phase/deadline을 먼저 저장하고 짧은 active timer 사용
- M2 continuous: 실제 match 중에만 profile-bounded tick, input coalescing과 snapshot backpressure
- active continuous DO 재시작: V1 `ABORTED_INFRA`, canonical reward 없음

---

## 10. WebSocket, ticket과 iframe Bridge

### Join ticket

별도 domain-separated secret 또는 전용 `MULTIPLAYER_TICKET_SECRET`을 사용한다.
환경별 active key ID/secret pair를 분리하고, 회전 시에만 직전 pair 하나를 검증용으로 함께 둔다. key ID는
1~32자 URL-safe 값이고 secret은 공백 없는 32 UTF-8 byte 이상의 무작위 값이어야 한다. Staging,
Production과 `GAME_SESSION_SECRET` 사이에서 값을 재사용하지 않는다.

필수 claim:

```text
iss / aud / kid / iat / exp / jti
instanceId / participantId / userId
gameVersionId / profileRevision
match generation / connection generation / role
```

- session expiry/ban/suspension 검증 뒤에만 발급
- outer Worker가 signature, expiry, Host, Origin, path와 rate limit을 검증한 뒤에만 DO 조회
- DO가 nonce를 durable하게 원자 소비
- URL query에 bearer ticket을 넣지 않음
- browser transport는 `Sec-WebSocket-Protocol` spike로 검증하고 raw header logging을 금지
- transport 안전성을 증명하지 못하면 instance-path-scoped HttpOnly short-lived cookie 방식 검토

Transport spike 완료 조건:

- 실제 지원 browser가 exact subprotocol 값을 손실 없이 전송한다.
- Cloudflare edge와 애플리케이션 log, analytics, error trace 어디에도 ticket 원문이 남지 않는다.
- proxy가 subprotocol header를 보존하고 선택된 application protocol만 응답한다.
- 만료, 재사용, 잘못된 audience/instance/path와 이전 connection generation을 모두 거절한다.
- URL, referrer, browser history 또는 iframe message에 ticket이 노출되지 않는다.
- 하나라도 증명하지 못하면 query parameter로 우회하지 않고 scoped HttpOnly cookie 대안을 검증한다.

### Common protocol

Client → Host/Server:

```text
MULTI_READY
MULTI_ACTION
MULTI_INPUT
MULTI_LEAVE
```

Server/Host → Game:

```text
MULTI_INIT
MULTI_CONNECTED
MULTI_PLAYER_JOINED
MULTI_PLAYER_LEFT
MULTI_SYNC
MULTI_STATE
MULTI_EVENT
MULTI_ACTION_REJECTED
MULTI_TERMINAL_PENDING
MULTI_TERMINAL_COMMITTED
MULTI_DISCONNECTED
MULTI_ABORTED
```

모든 envelope는 protocol version, match generation과 monotonic sequence를 가진다. exact key parser,
message-specific validator, UTF-8 byte/depth cap, per-port/socket/instance rate limit을 적용한다.
`MULTI_ACTION_REJECTED`, `MULTI_DISCONNECTED`, `MULTI_ABORTED`의 code는 SDK가 선언한 allowlist만
허용한다. 임의의 exception message, stack, DB/인프라 원인을 game iframe에 전달하지 않는다.

초기 상한:

```text
client action ≤ 4 KiB
iframe projected state/event ≤ 16 KiB
V1 participants ≤ 8
```

이 값은 class 정의가 아니라 보수적 platform hard cap이며 profiling과 보안 검토 없이 높이지 않는다.

### Bridge

- 기존 game completion Bridge와 multiplayer channel을 논리적으로 분리한다.
- online multiplayer attempt는 generic Game Session을 발급하지 않는다.
- `GAME_COMPLETE`, `GAME_EVENT`, client score/metric/progression을 reward/achievement에 사용하지 않는다.
- `window.OWOGG.multiplayer` 또는 동등한 안정 API에 ready/action/input/leave와 state/event subscription을
  제공한다.
- 공식 연결 상태와 canonical result는 iframe 밖 parent-owned overlay로 표시한다.

### 기존 완료·점수·업적 경계 inventory

멀티플레이 profile repository가 연결되는 단계에서 다음 지점을 하나의 authoritative admission gate로
묶는다. 이 목록은 Phase 0의 차단 설계이며 아직 기존 single/local 실행 동작을 변경하지 않는다.

| 경계                                                                                                    | 멀티플레이 적용 규칙                                                                                            |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/games.ts`의 `POST /:slug/session`                                                  | enabled approved multiplayer exact version에는 generic Game Session을 발급하지 않는다.                          |
| `packages/core/src/application/gameScoreAcceptanceUseCases.ts`                                          | token·score 정규화 전에 authoritative multiplayer profile을 확인하고 client score 경로를 거절한다.              |
| `packages/core/src/application/gameResultAcceptanceUseCases.ts`                                         | result 정규화·저장 전에 동일 gate를 적용하고 canonical committed result만 별도 경로로 수락한다.                 |
| `apps/api/src/routes/games.ts`의 game result/score route와 `apps/api/src/routes/scores.ts` legacy route | 모든 공개 입력이 위 core admission gate를 우회하지 못하게 한다.                                                 |
| `apps/api/src/routes/scores.ts`의 `GET /:gameId`                                                        | enabled approved multiplayer exact version은 과거 점수가 있어도 빈 leaderboard만 반환한다.                      |
| `apps/web/app/features/game/runtime/gameBridgeHost.ts`                                                  | `GAME_EVENT`/`GAME_COMPLETE`는 single/local legacy channel에만 남기고 multiplayer channel로 전달하지 않는다.    |
| `apps/web/app/features/game/gameResultFlow.ts`                                                          | online multiplayer attempt에서는 generic session/result flow를 시작하지 않는다.                                 |
| progression/achievement/XP consumer                                                                     | D1 canonical match commit 뒤 생성된 idempotent reward outbox만 소비한다. iframe event를 사실로 사용하지 않는다. |

Gate는 game slug나 manifest의 self-declared mode가 아니라 `game_version_id`에 귀속된 enabled approved
profile로 결정한다. profile 조회 실패를 single-player 허용으로 fallback하지 않는다.

---

## 11. Anti-cheat와 abuse control

| 위협                          | 강제 방어                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------- |
| client winner/score/XP 위조   | server terminal state만 canonical result                                     |
| position/speed/collision 위조 | direction/button intent만 수락하고 server simulation                         |
| replay/duplicate              | nonce, generation, sequence, action id와 payload hash                        |
| client clock 조작             | server receive time/deadline 사용                                            |
| hidden state leak             | viewer projection, reconnect/log에도 full state 금지                         |
| spam/bot                      | HTTP/user/IP/socket/instance/ruleset별 rate limit과 semantic limit           |
| slow consumer                 | bounded queue, coalesce/resync/close 정책                                    |
| 임의 DO wake-up               | outer signature 검증 뒤 DO routing                                           |
| room enumeration              | opaque public code, 일정한 error, lookup limiter                             |
| XP farming                    | self-match 금지, distinct account, 최소 match 조건, daily cap, server policy |
| 악성 game bundle              | sandbox, reciprocal Host guard, Bridge cap/rate limit                        |
| public room abuse             | block/report reference, server display name, V1 chat/voice 금지              |

Reaction Duel은 network path 차이 때문에 high-value competitive 결과로 취급하지 않고 client latency
보정을 승자 판정에 사용하지 않는다. collusion과 다중 계정을 완전히 방지한다고 주장하지 않는다.

---

## 12. Admin, moderation과 account lifecycle

`/admin/games`에 exact version multiplayer profile 심사를 통합한다.

- OWOGG upload는 server-side `publisher_type=OWOGG`만 V1 profile 후보
- `OMOK_V1`은 `official-omok` slug에만 적용되며 다른 공식 멀티게임에 재사용하지 않음
- 관리형 관리자만 현재 live version의 프로필을 활성화/비활성화하고 변경자를 감사 필드에 기록
- 관리자 응답과 화면에는 secret/resolved config를 노출하지 않고 `leaderboardEnabled: false`를 명시
- Creator request는 USER ownership을 유지하고 별도 review 상태 사용
- profile enable/disable, new-join drain, force-abort kill switch
- active version/ruleset lease 수 표시
- profile request와 resolved profile diff 표시
- reward policy는 관리자만 선택

계정 정지/병합/삭제 정책:

- suspension/ban 시 ticket 발급 거절, 필요 시 active socket 종료
- active participant가 있는 account merge는 먼저 match/socket 처리
- participant/result/reward FK remap과 테스트 추가
- 삭제 사용자의 장기 match audit은 정책에 따라 익명화하고 reward ledger 일관성 유지

---

## 13. 비용·성능 가드

### 금지

```text
D1 polling을 Production realtime transport로 사용
D1에 position/tick/frame 저장
idle room setInterval
변화 없는 full snapshot 반복
application ping으로 DO를 불필요하게 계속 깨움
per-frame raw logging
```

### 권장

- lobby/turn waiting은 Hibernation API 사용
- protocol ping/auto-response 사용
- M2 input은 최신 방향 state로 coalesce
- snapshot은 변화가 있을 때만 보내고 slow client는 resync
- realtime DO storage는 phase/terminal과 최소 checkpoint만 기록
- invite/ticket nonce와 closed live state에 TTL
- expired D1 row cleanup과 DO finalization alarm을 idempotent하게 구현

초기 M2 continuous profiling 출발점:

```text
server tick: 10~20 Hz부터 측정
snapshot: 50~100 ms부터 측정
client render: 60 FPS interpolation
```

고정 품질값이 아니라 tick budget과 비용을 측정하는 출발점이다.

경기별로 다음을 수집하여 `cost per 1,000 matches`를 계산한다.

```text
DO active milliseconds
WebSocket inbound count / outbound bytes
DO SQLite rows read/written
D1 rows read/written
finalization retry/lag
action/tick p50/p95/p99
disconnect/ABORTED_INFRA
```

동시 instance/player 안전 상한과 월 비용 Gate는 Staging load 결과를 보고 Production 전에 정한다.

---

## 14. Diagnostics와 resilience

Diagnostics는 M class가 아니라 공통 플랫폼 기능이다.

```text
WebSocket connect time
RTT current/p50/p95
jitter
application ping timeout
disconnect/reconnect
action accepted/rejected/conflict/duplicate
snapshot bytes/rate/coalescing
tick duration/overrun
finalization lag/retry
reward success/duplicate/failure
```

WebSocket/TCP가 하위 packet loss를 재전송으로 숨길 수 있으므로 UI에는 정확한 network packet-loss
수치라고 표시하지 않고 `application ping timeout/loss`로 표현한다.

복구 정책:

- lobby/M1: attachment + DO SQLite state로 재구성
- attachment에는 최소 identity/generation만 저장
- persisted state에 `stateSchemaVersion` 저장
- active ruleset revision은 모든 lease가 끝날 때까지 Worker build에서 제거 금지
- M2 continuous active restart는 안전한 infra abort
- alarm은 precise game timer가 아니라 TTL/finalization retry에 사용
- reconciliation job은 D1 pending finalization/reward를 복구

---

## 15. 테스트 계층과 단계 Gate

### 모든 변경의 기본 루프

```text
작은 구현 단위
→ 관련 unit test
→ D1/DO integration test
→ affected workspace test/typecheck
→ pnpm format
→ pnpm verify
→ git status/diff 검토
```

실패한 단계에서 다음 phase로 진행하지 않는다.

### Unit

- profile/capability validation과 class resolver
- ruleset transition, illegal action와 terminal result
- viewer projection과 hidden-state non-disclosure
- protocol exact-shape/size/depth parser
- reward eligibility와 abort policy
- deterministic clock/RNG

### D1 integration

- profile/game-version ownership
- idempotent instance create
- concurrent capacity/invite use
- duplicate participant
- action duplicate/payload mismatch/stale revision
- match terminal exactly once
- reward outbox와 XP aggregate recovery
- account merge/delete와 kill/delete lease

### Durable Object/Workers integration

- 실제 Workers runtime용 별도 Vitest suite
- two WebSockets와 Origin/ticket 검증
- duplicate/replayed/expired ticket
- socket attachment와 hibernation/re-instantiation
- old generation takeover
- disconnect/slow client/backpressure
- terminal D1 retry와 alarm

### Browser E2E

두 개의 독립 인증 browser context로 다음을 검증한다.

```text
create → join → ready → play → committed result → leave/rematch
```

iframe에 cookie/ticket/API URL/global user ID가 전달되지 않는지 확인한다.

### Network/Staging matrix

```text
normal
+50 ms / +100 ms / +150 ms latency
jitter
offline → online
background tab
slow client
```

### Load

- M2 Pong 2/4/8 players 또는 해당 profile 최대 인원
- p95 tick duration과 overrun
- message/s, snapshot size, queue/backpressure
- DO overload/error와 D1 final write
- cost per 1,000 matches

---

## 16. 구현 Phase와 추적 상태

상태 표기: `[ ]` 미착수, `[~]` 진행 중, `[x]` 완료.

### Phase 0 — SSoT와 실제 계약 확정

- [x] 이 문서 작성과 기존 Reaction 문서 superseded 표시
- [x] M0 회귀 범위와 M1~M6 Gate 계약 타입 확정
- [x] profile/request/protocol/lifecycle/error code ADR
- [x] `owogg.json` v2는 설계만 고정하고 아직 public schema로 배포하지 않음
- [x] ticket transport spike 계획과 logging 검증 조건
- [x] 현재 production result/event/achievement 경로 차단 지점 목록화
- [x] baseline `pnpm verify`

완료 Gate: 기존 게임 동작이 바뀌지 않고 미결정 보안 정책이 구현자 추측으로 남지 않는다.

### Phase 1 — D1/Core correctness foundation

- [x] trusted profile/request domain과 class/runtime resolver
- [x] additive migration, repository/port/container wiring
- [x] exact-version/ruleset lease와 active TTL sweep
- [x] instance/participant/invite/action ledger
- [x] match finalization/reward outbox
- [x] progression 원자성 보강
- [x] account merge/delete/admin kill 정책
- [x] concurrency/idempotency integration tests

완료 Gate: concurrent/duplicate/failure injection에서 state와 reward가 정확히 한 번 반영된다.

### Phase 2 — 비활성 DO/Bridge infrastructure

- [x] Node-safe API app와 Worker entrypoint 경계 정리
- [x] SQLite-backed `MultiplayerInstanceObject`
- [x] top-level + `env.staging` self-binding
- [x] feature-disabled route, inert lifecycle과 exact-version legacy flow gate
- [x] join ticket/Origin/Host/nonce
- [x] 양방향 multiplayer Bridge와 parent-owned overlay
- [x] Workers Vitest suite와 Staging contract 확장

완료 Gate: 기능이 꺼진 상태에서 기존 API/game serving 회귀가 없고 Staging/Production namespace가
분리된다.

로컬 상태: 구현과 `pnpm verify` 완료. 실제 Staging Gate는 §18의 1~3번 설정·승인 후 확인한다.

### Phase 3 — M1 Simple 오목

- [x] official `omokRules`
- [x] create/join/invite/ready/action/sync
- [x] server winner와 typed conflict resync
- [x] reconnect resume
- [x] 검증 가능한 official 오목 ZIP source/build와 v1 무랭킹 manifest
- [x] 관리형 관리자 전용 exact-version `OMOK_V1` 활성화/비활성화 제어면
- [x] exact version ZIP을 `/admin/games`로 Staging D1/B2에 게시
- [~] 결과 ledger 로컬 검증 완료, reward는 별도 Staging Gate 전까지 비활성 유지
- [~] score/leaderboard 미생성·미노출 로컬 검증 완료, Staging acceptance 대기
- [ ] 두 사용자 browser E2E

Staging 상태(2026-08-27): `official-omok` exact version을 D1/B2에 게시했고 현재 live version의
`OMOK_V1` 프로필이 `leaderboardEnabled: false`로 활성화된 것을 관리자 화면에서 확인했다. 최초
활성화 응답은 D1의 인덱스 유지 비용까지 포함하는 `rows_written`을 단일 행 변경 수로 오인해 거짓
충돌을 반환했으며, 판정 기준을 `changes` 우선으로 수정하고 인덱스 포함 메타데이터 회귀 테스트와
전체 `pnpm verify`를 통과했다. 수정본 Staging 재배포와 실제 무랭킹·두 사용자 acceptance가 남아 있다.

후속 로컬 수정(2026-08-27): 방 코드와 초대 링크 복사를 분리하고 전체 링크 붙여넣기 시 코드·토큰을
자동 인식하도록 했다. `INVITE_ONLY` 방의 public code는 locator일 뿐 입장 권한이 아니므로 code-only
입장은 계속 거부한다. 15초 parent heartbeat는 Durable Object auto-response로 처리해 idle instance를
깨우지 않으며, 일시적 단절에는 최대 3회의 제한적 자동 재연결을 적용했다. official 오목 bundle은
iframe 내부 스크롤을 제거하고 반응형 보드 프레임·격자 끝선·화점 5개를 정리했다. 대상 테스트와
전체 `pnpm verify`, 1280×720·390×844·390×600 시각 QA는 통과했으나 이 tree는 아직 Staging에
반영하지 않았다. 코드 배포 뒤 갱신된 official 오목 ZIP을 D1/B2에 새 exact version으로 게시하고
프로필 재확인 후 두 사용자 acceptance를 다시 수행한다.

완료 Gate: 동시/중복 action으로 corruption이 없고 iframe이 결과·업적·XP를 위조할 수 없다.

### Phase 4 — M2 Event + Diagnostics

- [ ] `reactionDuelRules`
- [ ] READY/random GO/server receive order
- [ ] reconnect none/disconnect abort
- [ ] high-value win reward 금지
- [ ] diagnostics와 network matrix
- [ ] DO Hibernation과 finalization retry

완료 Gate: two socket, timer, disconnect/infra abort와 D1 commit 경로가 Staging에서 검증된다.

### Phase 5 — M2 Continuous Pong

- [ ] authoritative server tick
- [ ] bounded input sequence와 coalescing
- [ ] snapshot/interpolation/backpressure
- [ ] active restart infra abort
- [ ] tick/snapshot/cost profiling

완료 Gate: normal/latency/jitter/background/slow-client matrix와 부하 Gate를 통과한다.

### Phase 6 — Access 확대 + 4인 M2

- [ ] PUBLIC/UNLISTED/PRIVATE + OPEN/INVITE_ONLY
- [ ] instance full과 4인 fanout
- [ ] join/leave/ready/start/end
- [ ] host leave/transfer 정책 검증
- [ ] block/report reference와 slow-client isolation
- [ ] 필요성이 입증된 경우에만 password 후속 설계

완료 Gate: 4명이 안정적으로 lifecycle을 완료하고 한 slow client가 전체 instance를 막지 않는다.

### Phase 7 — M1 Advanced

- [ ] 3/4인 hidden-information reference
- [ ] simultaneous response window와 deterministic priority
- [ ] server-only hand/deck
- [ ] reconnect viewer projection
- [ ] logs/analytics hidden-state non-disclosure
- [ ] duplicate response와 final reward idempotency

완료 Gate: 다른 참가자 정보가 live/reconnect/log 어디에서도 유출되지 않는다.

### Phase 8 — Creator managed-template beta

- [ ] manifest v2 SDK/parser/schema/canonical projection
- [ ] template registry와 strict config validators
- [ ] profile request/review/Admin UI
- [ ] Creator Center template form/local two-player preview
- [ ] USER identity 유지와 server-approved runtime profile
- [ ] no custom server/URL/reward security tests

완료 Gate: Creator ZIP이 서버 권한을 스스로 얻지 못하고 approved exact version만 online 활성화된다.

---

## 17. M3~M6 착수 Gate

### M3 Rollback

다음이 실제로 모두 필요할 때만 시작한다.

- roadmap에 deterministic rollback game 존재
- M2 Production RTT/jitter 데이터 확보
- deterministic simulation reference와 state hash 필요
- input log/replay/desync format 요구 확인

WebRTC는 선택사항이며 첫 구현은 WebSocket relay일 수 있다.

### M4 High-fanout

DO load data에서 high fanout, sustained tick overrun, large entity count 또는 비용/CPU headroom 부족이
실제로 확인될 때 dedicated runtime adapter를 추가한다.

### M5 Persistent world

`PERSISTENT`, world/zone/shard/player-state capability vocabulary만 유지하고 runtime은 구현하지 않는다.

### M6 Distributed world

gateway, world/zone server, distributed persistence와 fleet adapter architecture note만 유지한다. 특정
vendor나 DB를 domain contract에 저장하지 않는다.

---

## 18. 외부 설정·승인 중단 지점

에이전트는 다음 단계에서 자동 진행하지 않고 사용자에게 정확한 입력·승인을 요청한다.

1. Staging GitHub Environment에 `MULTIPLAYER_TICKET_KEY_ID`와 32바이트 이상 무작위
   `MULTIPLAYER_TICKET_SECRET` 등록. 최초에는 두 `PREVIOUS` 값을 비워 두고
   `STAGING_MULTIPLAYER_ENABLED=false` 유지
2. Cloudflare DO lifecycle/binding을 실제 Staging Worker에 최초 적용
3. Staging D1 migration 적용, feature branch의 staging merge/push
4. Staging 배포 및 secret/DO/D1 준비 상태를 확인한 뒤 `STAGING_MULTIPLAYER_ENABLED=true` 전환·재배포
5. Staging `/admin/games`에서 reference ZIP 게시 또는 심사 계정 준비
6. Cloudflare Access를 통과하는 두 실사용 Staging 계정/브라우저 검증
7. Production inert lifecycle baseline, migration, secret 또는 feature enable
8. `staging → main` Production 승격

로컬 코드, migration, Wrangler template, 테스트와 문서는 승인 전까지 준비할 수 있다. 사용자 승인이
없는 `main` push, Production deploy/migration/secret 변경과 Discord global command sync는 금지한다.

---

## 19. 금지 목록

다음 구현이 보이면 중단하고 설계를 재검토한다.

```text
M0 reference 게임 신규 구현
game iframe에 API/WS URL 또는 credential 전달
allow-same-origin 추가
API/WS origin을 game CSP connect-src에 추가
generic MULTI_RPC / arbitrary JSON server dispatch
Creator server.ts 실행
client winner/XP/achievement 신뢰
D1 per-frame position/tick 저장 또는 Production polling
M1/M2 class에 Cloudflare/D1 이름 하드코딩
manifest가 runtime backend/ruleset/reward 선택
active profile/ruleset semantics in-place 수정
검증되지 않은 config/코드의 Staging·Production 승격
M3~M6 선행 구현
Git/static catalog runtime fallback 복원
```
