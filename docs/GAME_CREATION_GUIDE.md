# OwOGG 게임 제작 가이드

상태: 가이드

마지막 검증: 2026-08-29

기준 소스:

- `packages/core/src/domain/sandboxGameBundle.ts`
- `packages/core/src/domain/gameCreatorManifest.ts`
- `packages/core/src/domain/gameCreatorResult.ts`
- `packages/core/src/domain/sandboxGames.ts`
- `packages/core/src/application/gamePublicationService.ts`
- `packages/core/src/application/sandboxGameUseCases.ts`
- `packages/core/src/application/officialGameUploadUseCases.ts`
- `apps/api/src/routes/devGames.ts`
- `apps/api/src/routes/adminSandboxGames.ts`
- `apps/api/src/routes/gameServing.ts`
- `apps/web/app/features/game/GameHost.tsx`
- `packages/game-sdk/src/bridge/`

OwOGG에는 두 개의 **입력/control-plane**이 있지만 하나의 production runtime이 있습니다.

| 입력                           | 목적                                    | Runtime 결과               |
| ------------------------------ | --------------------------------------- | -------------------------- |
| Admin Center ZIP upload        | OWOGG 게임 즉시 publication             | generic D1/B2 game/version |
| Game Creator Center ZIP upload | USER 게임 등록, publication, moderation | generic D1/B2 game/version |

두 경로 모두 최종적으로 generic `games`, `game_versions`, `game_assets`와 B2 canonical/bundle을
사용합니다. `StaticGameRegistry`, publisher별 host/runtime, `/official-games/*`는 현재 production
경로가 아닙니다.

공개 “공식” 표시는 `GameCanonicalDocument.publisher.official` 메타데이터입니다. 소유권과 API 인가는
D1의 서버 관리 관계만 사용하며 canonical/manifest 입력으로 판정하지 않습니다. Game Creator 경로는
업로드 내용과 무관하게 항상 `official: false`를 기록하고, 관리자 OWOGG endpoint만 `true`를 기록합니다.

## 1. 게임이 지켜야 하는 runtime 계약

업로드 bundle은 자체 실행 가능한 정적 Web build여야 합니다.

- root에 `index.html`이 있어야 합니다. 모든 파일이 단일 최상위 폴더에 감싸진 ZIP은 publication
  준비 과정에서 그 폴더를 벗겨냅니다.
- 파일 참조는 bundle 내부의 상대 경로를 사용해야 합니다.
- 서버 코드, filesystem 접근, 비밀값, OwOGG cookie 직접 접근을 기대하지 않습니다.
- 게임 결과는 자동 주입되는 `window.OWOGG` API로 host에 전달합니다.
- 게임은 difficulty 외의 사용자/session/token/API 정보를 받거나 직접 만들지 않습니다.

게임이 사용하는 기본 lifecycle API는 다음과 같습니다.

```js
OWOGG.start();
OWOGG.event("boss_defeated");
OWOGG.complete({
  outcome: "success",
  score: 12500,
  progression: { value: 7 },
  metrics: { kills: 32 },
});
// 화면의 재시작 버튼은 게임 안에 두고, 새 verifier/session 시도는 Host에 요청합니다.
OWOGG.restart();
OWOGG.cancel();
```

내부 MessageChannel handshake, ready, session token, API 요청은 Host가 처리합니다. 게임이 보낸
모든 fact는 server canonical manifest와 signed one-use session으로 다시 검증됩니다.

## 2. OWOGG 관리자 게임 게시

관리자 센터의 **게임 관리 및 심사** 화면(`/admin/games`)에서 Game Creator Center와 동일한
drag-and-drop 또는 파일 선택 방식으로 standalone ZIP을 등록합니다. API는 elevated admin session과
`games.moderate` permission을 확인한 뒤 publisher를 서버에서 `OWOGG`로 고정하고, bundle과 canonical을
B2에 기록한 후 D1 live version을 활성화합니다. 같은 화면의 사용자 제작 게임 심사 기능은
`sandbox_games.review` 권한을 별도로 검사합니다. 배포 workflow나 `games/*` source package를 사용하지
않습니다.

ZIP에는 `index.html`, `owogg.json`, `owogg.logo.*`가 필요합니다. 관리자와 USER 업로드는 완전히
동일한 Game Creator Manifest v1 입력을 사용합니다. publisher와 official 표시는 manifest에 선언할 수
없으며, 관리자 endpoint만 서버에서 `OWOGG` 권한을 부여합니다.

같은 화면의 OWOGG 행에는 **완전 삭제**가 있습니다. 이 작업은 `games.moderate`와
`sandbox_games.delete` 권한을 모두 요구하고, 입력한 slug가 정확히 일치할 때만 실행됩니다. 서버는
먼저 D1 identity를 PRIVATE/삭제 상태로 격리해 플레이와 새 결과를 차단한 뒤 다음 순서로 정리합니다.

```text
D1 quarantine
→ B2 version files + manifest + source ZIP + logo + canonical delete
→ D1 score/result/achievement/personalization/control rows purge
→ slug release
```

B2 삭제는 없는 object를 성공으로 취급하고 version별 GC marker를 기록하므로 일부 정리 뒤 실패해도
같은 요청을 재시도할 수 있습니다. 성공 후 같은 slug를 새 OWOGG identity로 다시 ZIP 등록할 수
있습니다. 기존에 획득한 global/guild XP는 사용자 보상이므로 회수하지 않습니다.

## 3. USER bundle 등록

### 3.1 새 게임 ZIP

Game Creator Center의 drag-and-drop 등록은 root에 다음 파일을 요구합니다.

```text
index.html
owogg.json
owogg.logo.png | .jpg | .jpeg | .webp | .svg
...game assets
```

`owogg.json` 최소 shape:

```json
{
  "$schema": "https://owogg.com/schemas/manifest/v1.json",
  "schemaVersion": 1,
  "game": {
    "slug": "my-game",
    "title": "My Game",
    "genre": "arcade",
    "tags": ["puzzle", "card-board"],
    "mode": "single",
    "playModes": ["single"]
  },
  "progression": { "type": "none" },
  "result": { "score": null }
}
```

공개 schema는 `https://owogg.com/schemas/manifest/v1.json` 하나뿐입니다. `game`, `input`,
`presentation`, `difficulties`, `progression`, `result`, `leaderboard`, `events`, `achievements`,
`multiplayer`, `playConfig`만 허용하며 알 수 없는 필드는 거부합니다. `game.playModes`는 필수이고
`single`, `local-multi`, `online-multi` 중 실제 지원 topology를 선언합니다. `mode: "single"`은
`["single"]`만, `mode: "multi"`는 `local-multi` 또는 `online-multi`를 하나 이상 허용합니다.
range는 `min < max`, `outOfRange` 기본값은 `clamp`입니다.

`game.genre`에는 `skill-test`, `board`, `puzzle`처럼 넓은 대표 장르 하나를 자유 문자열로 쓰고,
`game.tags`에는 `typing`, `reaction`, `card-board`처럼 세부 규칙·테마를 자유 문자열 배열로 씁니다.
고정된 4~5개 장르 allowlist는 없으며, 알려진 넓은 장르는 UI 언어로 번역하고 알 수 없는 장르는 최초
표기를 유지합니다. 기존 official의 세부 장르는 호환 정규화로 상위 장르에 묶입니다.

`playConfig`는 `single` 또는 `local-multi` 경로와 scored leaderboard를 요구합니다. 같은 ZIP에서
online도 제공하려면 `game.playModes`에 generic 경로와 `online-multi`를 함께 넣고 `multiplayer` 심사
요청을 선언할 수 있습니다. top-level result/leaderboard/PlayConfig는 `single`/`local-multi` 경로에만
적용됩니다. online은 승인된 exact-version Relay profile로 분리되고 결과는 항상 `UNVERIFIED`이므로
leaderboard, reward, XP, MMR, score 기반 도전과제에 연결되지 않습니다.

`multiplayer` 선언은 서버 실행 권한이 아닙니다. 업로드 시 요청은 exact
`(gameId, gameVersionId, contentHash)`와 canonical request hash에 묶여 `PENDING_REVIEW`로 저장됩니다.
관리자 승인은 먼저 disabled Relay profile만 생성하며, 별도 activation 뒤에만 새 방 생성과 ticket 발급이
가능합니다. 새 version/content hash는 이전 승인을 재사용하지 않습니다. 현재 server runtime은
`websocket + relay`, 2~8명, `PRIVATE + OPEN`만 활성화할 수 있고 worker/container,
join-in-progress/spectator는 지원 구현 전까지 fail closed합니다.

새 등록 endpoint는 `multipart/form-data`의 `bundle` file을 받는
`POST /api/dev/games/upload`입니다. catalog-only 수동 등록 경로는 없으며 ZIP drag-and-drop만
지원합니다.

### 3.2 새 버전 ZIP

기존 게임 소유자는 `POST /api/dev/games/:id/versions`에 같은 `bundle` field로 새 standalone
ZIP을 올립니다. 모든 버전에도 유효한 `owogg.json`이 필요하고 `game.slug`는 기존 게임과 같아야
합니다. 새 logo가 포함되면 교체하고, 없으면 기존 logo를 유지합니다.

### 3.3 부분 재업로드와 핵심 속성 편집

Game Creator Center와 관리자 게임 관리 화면은 게임별로 다음 작업을 제공합니다.

| 작업                    | USER 게임                                              | OWOGG 공식 게임                                  |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| 전체 ZIP                | 새 `PENDING_REVIEW` numeric version                    | 대상 slug 검증 후 새 READY/live version          |
| `owogg.json`만 재업로드 | 현재 source ZIP을 재구성한 새 `PENDING_REVIEW` version | 현재 source ZIP을 재구성한 새 READY/live version |
| 로고만 재업로드         | game-level asset 즉시 교체                             | game-level asset 즉시 교체                       |
| 핵심 속성 폼            | 수정한 manifest로 새 `PENDING_REVIEW` version          | 수정한 manifest로 새 READY/live version          |

핵심 속성 폼은 `game.title`, `shortDescription`, `description`, `genre`, `mode`만 다룹니다.
`tags`를 바꾸려면 현재는 `owogg.json` 재업로드 또는 전체 ZIP 업로드를 사용합니다.
`slug`는 D1의 영구 identity이므로 수정할 수 없습니다. 매니페스트/폼 수정은 이미 게시된 version prefix의
`owogg.json`을 덮어쓰지 않고 현재 source archive를 서버에서 재구성하여 새 버전을 만듭니다. 이 규칙으로
source ZIP, published files, B2 canonical이 서로 다른 내용을 가리키는 상태와 1년 immutable 캐시 오염을
막습니다.

로고는 version 파일이 아닌 game-level asset입니다. 교체 시 content-addressed B2 객체를 먼저 기록하고
D1 `game_assets` 포인터를 전환한 뒤 이전 객체를 정리합니다. 따라서 로고 교체만으로 live version이나
leaderboard generation은 바뀌지 않습니다. 반대로 공식 전체 ZIP/manifest/핵심 속성 변경은 새 live
version을 만들므로 기존 version 변경 규칙에 따라 leaderboard generation도 전환됩니다.

### 3.4 현재 bundle 안전 제한

`SANDBOX_GAME_POLICY`가 현재 다음 제한을 강제합니다.

| 항목                                 |    제한 |
| ------------------------------------ | ------: |
| compressed upload                    |  20 MiB |
| extracted bytes                      |  50 MiB |
| file count                           |     300 |
| path depth                           |      16 |
| new-game logo                        |   2 MiB |
| standalone `owogg.json`              | 256 KiB |
| Game Creator concurrent review slots |       2 |

절대 경로, drive path, `..`, 비정상 압축 비율, 누락된 `index.html`은 거부됩니다. publication은
request-time unzip serving을 하지 않고 검증된 파일을 version prefix에 개별 객체로 기록합니다.

## 4. 생명주기를 혼동하지 않기

### 4.1 소스/업로드 생명주기

```text
ZIP receive
→ archive metadata/path/size validation
→ normalized standalone files
→ source archive retained for USER retry
→ generic numeric identity/version allocation
```

USER source archive key는 content-addressed `uploads/<gameId>/<contentHash>.zip`입니다. 공개 파일은
별도의 version-scoped prefix를 사용합니다.

### 4.2 공통 publication 생명주기

```text
(gameId, versionId, contentHash)
→ PUBLISHING
→ games/<gameId>/<versionId>/<files>
→ games/<gameId>/<versionId>/.owogg-manifest.json  (last)
→ READY
```

파일 또는 manifest/DB 전이가 실패하면 version은 제공되지 않으며 `FAILED`로 기록됩니다. USER
관리자는 source archive로 같은 numeric version을 republish할 수 있습니다. release map이나
manifest-only publication은 현재 구조가 아닙니다.

### 4.3 USER review 생명주기

```text
PENDING_REVIEW
→ APPROVED | REJECTED | WITHDRAWN
APPROVED → revoke → PENDING_REVIEW
```

관리자 review API는 queue/detail, approve, reject, revoke, republish, live-version, metadata,
visibility, delete/purge를 제공합니다. Permission과 use-case invariant가 각 동작을 제한합니다.
특히 non-READY version은 승인할 수 없고, 승인된 version만 live로 선택할 수 있습니다.

```text
Publication READY != Moderation APPROVED
```

두 상태축 중 하나만 보고 게임이 public이라고 판단하면 안 됩니다. Generic runtime은 public
identity, live READY version, valid canonical, kill-switch 상태를 검사하고 USER control plane은
APPROVED/live/visibility 변경 자격을 관리합니다.

## 5. runtime 제공

```text
GET /play/:slug
→ RuntimeGameRegistry resolves generic identity/live version/canonical
→ redirect to /games/<gameId>/<versionId>/index.html
→ immutable version assets
```

`/games/:gameId/:versionId/*`는 exact numeric version과 manifest를 검증해 파일을 제공합니다.
`/official-games/*`는 404가 의도된 제거 경로입니다.

Web의 `GameHost`는 publisher를 보고 다른 host를 고르지 않습니다. public game/session을 가져오고
`IframeRuntime`을 구성하며 `window.OWOGG` fact를 result submission과 결과 UI에 연결합니다.

### 5.1 online-multi Relay SDK

승인된 Relay profile로 시작한 iframe에는 인증 token, WebSocket URL, user ID 또는 서버 ruleset 대신
`window.OWOGG.multiplayer`가 제공됩니다. `bootstrap`은 exact
`gameVersionId/contentHash/profileRevision/generation`과 함께 다음 공용 정보만 노출합니다.

- `runtime`: 현재 `relay`, protocol version, `resultTrust: "UNVERIFIED"`
- `self`: 서버가 정한 `participantId`, `seatIndex`, `HOST | PLAYER` 역할
- `roster`: seat 순서의 2~8인 참가자 목록
- `capabilities`: reconnect, broadcast, direct message, host snapshot 사용 가능 여부

게임은 먼저 listener를 등록하고 `ready()`를 호출합니다. 초기 handshake 전에 호출한 `ready()`는 bounded
queue에 보관되며, 이후 수신 메시지 안에서 최신 `bootstrap`을 읽을 수 있습니다.

```js
const relay = window.OWOGG.multiplayer;

const unsubscribe = relay.subscribe((message) => {
  const bootstrap = relay.bootstrap;
  if (!bootstrap || bootstrap.runtime.kind !== "relay") return;

  if (message.type === "MULTI_CONNECTED") {
    initializePlayers(bootstrap.self, bootstrap.roster);
  } else if (message.type === "RELAY_SYNC") {
    restoreSnapshot(message.snapshot);
  } else if (message.type === "RELAY_MESSAGE") {
    applyPeerMessage(message.sender, message.payload);
  } else if (message.type === "RELAY_REJECTED" || message.type === "RELAY_CLOSED") {
    handleRelayStatus(message);
  }
});

relay.ready();
```

연결 뒤에는 JSON-safe payload를 `broadcast(payload)`로 모든 참가자에게 보내거나, profile이 허용한 경우
`direct(participantId, payload)`로 특정 참가자에게 보냅니다. `send({ delivery, ... })`는 두 방식을 하나의
API로 호출하는 형태입니다. host이고 `capabilities.hostSnapshot`이 true일 때만
`snapshot(payload)`로 bounded reconnect snapshot을 교체할 수 있습니다. 방을 자발적으로 나갈 때는
`leave()`를 호출하고 더 이상 listener가 필요 없으면 `unsubscribe()`를 호출합니다.

활성 게임 화면의 공용 참가자 카드에는 OWOGG parent가 측정한 대략적인 왕복 ping이 표시됩니다. 첫
연결에서는 즉시 측정하고 이후 공유 갱신은 최소 30초 간격으로 제한합니다. heartbeat 응답은 Durable
Object auto-response 경로를 사용하며, bounded latency report는 게임 iframe에 노출되거나 application
`clientSeq`/`messagesPerSecond` 예산을 소비하지 않습니다. 게임 제작자가 별도 ping 프로토콜이나 UI를
구현할 필요는 없습니다.

Relay는 sender/seat/role, generation/sequence, target, payload 크기와 전송률을 검증하지만 payload 내부의
메시지 schema, 게임 규칙, 충돌 해결, 물리, hidden information, 승자를 검증하지 않습니다. 제작자는
application-level message type/revision, host 권한, 상태 동기화와 충돌 정책을 게임 코드에 구현해야 합니다.
`local-multi` 실행에는 Relay transport가 열리지 않으므로 같은 ZIP에서도 로컬 상태와 online 상태를
명시적으로 분리해야 합니다.

profile의 `messagesPerSecond`는 application envelope의 지속 전송률입니다. 서버는 같은 크기의 1초 burst
capacity를 가진 token bucket으로 제한하므로 정상적인 20Hz 전송이 브라우저 timer나 네트워크 jitter로
잠깐 뭉쳐도 고정 1초 경계 때문에 연결이 끊기지 않습니다. capacity를 초과하는 즉시 burst는 계속
거부합니다.

## 6. 결과 승인

PlayConfig가 없는 기존 generic 게임은 게임 시작 전 API가 exact slug/live version/difficulty에 묶인
signed one-use `gs1` session을 발급합니다. PlayConfig 게임은 사용자가 게임 안에서 `single` 또는
`local-multi`를 선택하고 허용된 difficulty/variant pair를 고르면 Host가 `gs2`를 요청합니다. 서버는
선택 topology와 canonical pair, reward factor, ruleset revision, verifier ID를 서명하고 공개
`startContext`만 iframe에 전달합니다. `gs2` token은 parent memory 밖으로 노출하지 않습니다.

게임은 주입된 객체가 존재하는 즉시 `playConfig`를 읽지 않고 먼저 `await OWOGG.whenReady()`를
호출해야 합니다. 그 뒤 공개된 `difficulties`, `variants`, `allowedConfigs`, 기본값만으로 게임 내부
설정 화면을 구성합니다. 축의 항목이 하나뿐이면 해당 선택기를 숨기고 기본값을 사용하며, 두 축 모두
하나뿐이면 선택 화면 없이 바로 시작 동작을 제공할 수 있습니다. 플랫폼 UI와 slug별 코드는 이 목록을
복제하지 않습니다. `owogg.json`에서 생략한 difficulty는 내부 canonical에서 `normal` 한 개로
정규화되므로 게임에는 난이도 선택기를 표시하지 않습니다.

모든 게임은 게임 내부에서 한국어와 영어 UI를 전환할 수 있어야 합니다. 이 언어 선택은 플레이 규칙이나
경쟁 점수를 바꾸는 PlayConfig 축이 아니므로 `difficulty`/`variant`에 넣지 않으며, ZIP이 번역 문자열과
전환 UI를 직접 소유합니다. 소리와 재시작 설정도 같은 원칙으로 게임 내부에 둡니다.

`owogg.json`은 선택지의 ID·표시명·기본값·허용 조합에 대한 단일 선언 권한이지 실행 가능한 게임 규칙은
아닙니다. 새 difficulty/variant ID가 실제 동작하려면 ZIP의 게임 로직이 그 ID의 플레이 규칙을 구현해야
하고, 경쟁 결과를 쓰는 PlayConfig 게임은 선택한 `verifierId`의 서버 verifier도 같은 ID와 evidence를
지원해야 합니다. 플랫폼 shell이나 slug별 UI 코드를 고칠 필요는 없지만, manifest만 바꿔서 존재하지
않는 규칙 또는 검증 알고리즘을 생성할 수는 없습니다.

Phase 5-D/E에서 trusted verifier registry, 게시/session gate, first-evidence hash claim, 검증 coordinator와
authoritative 결과 저장이 구현됐습니다. reviewed entry는 reference용 `verified-aim-test-v1`과 공식
재작성 게임용 `reaction-time-v1`, `aim-test-v1`, `typing-test-v1`, `memory-test-v1`입니다. 다른
verifier ID는 계속 fail closed이며 각 verifier도 canonical slug와 revision을 다시 확인합니다. `/result`는
evidence를 검증하고 서버 facts를 반환합니다. 요청은 64 KiB, canonical
evidence는 16 KiB·깊이 12·배열 1,024·객체 key 256·전체 node 4,096으로 제한되며 raw evidence는 저장하지
않습니다. online 선택은 `gs1`/`gs2`를 발급하지 않고 approved exact-version Relay profile과 Durable
Object transport를 사용하며, Relay 결과를 경쟁 결과로 승인하지 않습니다.

gs2의 `rawScore`는 verifier 원값, `normalizedScore`는 manifest 범위·precision을 통과한 게임 점수,
`competitiveScore`는 reward factor를 desc 점수에는 곱하고 asc 점수에는 나눈 뒤 같은 precision으로
반올림한 경쟁 점수입니다. verifier가 범위 밖 값을 반환하면 clamp하지 않고 결과 전체를 거부합니다.
attempt 소비, result, 선택적 score projection, claim terminal 전환은 한 D1 batch로 처리됩니다.
도전과제·진행도는 normalized gameplay facts를, 리더보드는 competitive score를 사용합니다. 결과 응답의
`difficultyId`/`variantId`도 서버 권위 값이며 GameHost는 이 값으로 결과 카드와 preview 범위를 갱신합니다.

업로드 가능한 최소 구현은 `examples/verified-aim-test`에서 확인할 수 있습니다. 이 예제는
`requestStart()`로 승인된 seed/config를 받고, 점수 대신 최대 10개의 순차 좌표·상대시간 evidence만
`complete()`로 보냅니다. build/verify 스크립트와 서버 verifier가 같은 결정론 test vector를 검증하지만,
이 참조 구현 자체가 사람과 자동화 클라이언트를 완전히 구별하는 anti-bot 보장은 아닙니다.

`examples/official-games-v1`에는 2026-08-30 Staging D1에서 동결한 공식 GAME 5종의 기존 UI·로고를
보존하면서 unified manifest v1과 evidence/Relay 경계로 이식한 소스 및 결정론 ZIP/SHA inventory가
있습니다. 이 디렉터리는 runtime registry가 아니며
등록은 관리자 ZIP 업로드를 통해서만 수행합니다. 온라인 오목 규칙은 ZIP에만 있고, 서버의 공식 4종
Verifier는 경쟁 싱글 결과 검증을 위한 별도 신뢰 경계입니다.

non-PlayConfig gs1 완료 후 server는 다음을 다시 검증합니다.

- 서명, 만료, one-use attempt
- game와 version binding
- difficulty binding
- 현재 live/READY/public/kill-switch 상태
- B2 canonical `owogg.json`의 outcome/score/progression/metric/event 선언과 range

`outOfRange: "reject"` 값은 결과 전체를 거부합니다. `clamp` 값은 보정해 `game_results`에
`adjusted=true`로 저장하지만 leaderboard, Game Creator achievement, XP/보상에서는 제외합니다.
정상 score만 `scores`에 투영되며 leaderboard는 이 서버 승인 점수만 읽습니다.

`games.leaderboard_generation`은 현재 live version의 리더보드 세대입니다. OWOGG 재업로드 또는 USER
승인/롤포워드/롤백으로 live version ID가 바뀌면 세대가 한 번 증가하고, 이후 승인 점수는 새 세대에
기록됩니다. 공개 리더보드, 개인 최고 기록, Streamer/Discord 게임 랭킹은 현재 세대만 읽으므로 새
버전의 리더보드는 빈 상태에서 시작합니다. PlayConfig 랭킹은 difficulty와 current ruleset revision도
일치해야 하며 variant는 별도 랭킹을 만들지 않고 `Mode` 열에 표시합니다. 이전 점수 row는 감사·이력
용도로 남지만 현재 랭킹에는 노출되지 않습니다. 같은 content/version을 다시 활성화해 live version
ID가 바뀌지 않으면 초기화하지 않습니다. 공개 리더보드의 edge cache는 최대 30초 동안 이전 응답을
보일 수 있습니다.

## 7. 제출 전 점검

- standalone build를 로컬 static server에서 열었을 때 `index.html`과 모든 상대 asset이 동작함
- `OWOGG.start/event/complete/cancel`을 선언된 fact와 일치하게 호출함
- retry에서 상태가 정상 초기화됨
- difficulty가 host 초기값과 일치함
- 게임 내부 한국어·영어 전환으로 핵심 설명, 설정, 진행 상태, 결과, 접근성 label이 함께 바뀜
- 소리 켜기/끄기와 재시작을 게임 내부에서 조작할 수 있음
- ZIP root와 필수 등록 파일이 올바름
- compressed/extracted/file/logo 제한 이내임

실제 UI 업로드 순서는 [Game Upload Guide](GAME_UPLOAD_GUIDE.md), 전체 runtime 경계는
[Game Platform Architecture](GAME_PLATFORM_ARCHITECTURE.md)를 참조하세요.
