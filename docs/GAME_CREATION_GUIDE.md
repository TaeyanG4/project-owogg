# OwOGG 게임 제작 가이드

상태: 가이드

마지막 검증: 2026-08-24

기준 소스:

- `packages/core/src/domain/sandboxGameBundle.ts`
- `packages/core/src/domain/creatorManifest.ts`
- `packages/core/src/domain/creatorResult.ts`
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
D1의 서버 관리 관계만 사용하며 canonical/manifest 입력으로 판정하지 않습니다. Creator 경로는
업로드 내용과 무관하게 항상 `official: false`를 기록하고, 관리자 OWOGG endpoint만 `true`를 기록합니다.

## 1. 게임이 지켜야 하는 runtime 계약

업로드 bundle은 자체 실행 가능한 정적 Web build여야 합니다.

- root에 `index.html`이 있어야 합니다. 모든 파일이 단일 최상위 폴더에 감싸진 ZIP은 publication
  준비 과정에서 그 폴더를 벗겨냅니다.
- 파일 참조는 bundle 내부의 상대 경로를 사용해야 합니다.
- 서버 코드, filesystem 접근, 비밀값, OwOGG cookie 직접 접근을 기대하지 않습니다.
- 게임 결과는 자동 주입되는 `window.OWOGG` API로 host에 전달합니다.
- 게임은 difficulty 외의 사용자/session/token/API 정보를 받거나 직접 만들지 않습니다.

게임이 사용하는 공개 API는 네 개뿐입니다.

```js
OWOGG.start();
OWOGG.event("boss_defeated");
OWOGG.complete({
  outcome: "success",
  score: 12500,
  progression: { value: 7 },
  metrics: { kills: 32 },
});
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
동일한 Creator Manifest v1 입력을 사용합니다. publisher와 official 표시는 manifest에 선언할 수
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
    "mode": "single"
  },
  "progression": { "type": "none" },
  "result": { "score": null }
}
```

공개 schema는 `https://owogg.com/schemas/manifest/v1.json`입니다. `game`, `input`,
`presentation`, `difficulties`, `progression`, `result`, `leaderboard`, `events`, `achievements`만
허용하며 알 수 없는 필드는 거부합니다. range는 `min < max`, `outOfRange` 기본값은 `clamp`입니다.

새 등록 endpoint는 `multipart/form-data`의 `bundle` file을 받는
`POST /api/dev/games/upload`입니다. catalog-only 수동 등록 경로는 없으며 ZIP drag-and-drop만
지원합니다.

### 3.2 새 버전 ZIP

기존 게임 소유자는 `POST /api/dev/games/:id/versions`에 같은 `bundle` field로 새 standalone
ZIP을 올립니다. 모든 버전에도 유효한 `owogg.json`이 필요하고 `game.slug`는 기존 게임과 같아야
합니다. 새 logo가 포함되면 교체하고, 없으면 기존 logo를 유지합니다.

### 3.3 현재 bundle 안전 제한

`SANDBOX_GAME_POLICY`가 현재 다음 제한을 강제합니다.

| 항목                            |   제한 |
| ------------------------------- | -----: |
| compressed upload               | 20 MiB |
| extracted bytes                 | 50 MiB |
| file count                      |    300 |
| path depth                      |     16 |
| new-game logo                   |  2 MiB |
| creator concurrent review slots |      2 |

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

## 6. 결과 승인

게임 시작 전 API가 exact slug/live version/difficulty에 묶인 signed one-use session을 발급합니다.
완료 후 server는 다음을 다시 검증합니다.

- 서명, 만료, one-use attempt
- game와 version binding
- difficulty binding
- 현재 live/READY/public/kill-switch 상태
- B2 canonical `owogg.json`의 outcome/score/progression/metric/event 선언과 range

`outOfRange: "reject"` 값은 결과 전체를 거부합니다. `clamp` 값은 보정해 `game_results`에
`adjusted=true`로 저장하지만 leaderboard, Creator achievement, XP/보상에서는 제외합니다.
정상 score만 `scores`에 투영되며 leaderboard는 이 서버 승인 점수만 읽습니다.

`games.leaderboard_generation`은 현재 live version의 리더보드 세대입니다. OWOGG 재업로드 또는 USER
승인/롤포워드/롤백으로 live version ID가 바뀌면 세대가 한 번 증가하고, 이후 승인 점수는 새 세대에
기록됩니다. 공개 리더보드, 개인 최고 기록, Creator/Discord 게임 랭킹은 현재 세대만 읽으므로 새
버전의 리더보드는 빈 상태에서 시작합니다. 이전 점수 row는 감사·이력 용도로 남지만 현재 랭킹에는
노출되지 않습니다. 같은 content/version을 다시 활성화해 live version ID가 바뀌지 않으면 초기화하지
않습니다. 공개 리더보드의 edge cache는 최대 30초 동안 이전 응답을 보일 수 있습니다.

## 7. 제출 전 점검

- standalone build를 로컬 static server에서 열었을 때 `index.html`과 모든 상대 asset이 동작함
- `OWOGG.start/event/complete/cancel`을 선언된 fact와 일치하게 호출함
- retry에서 상태가 정상 초기화됨
- difficulty가 host 초기값과 일치함
- ZIP root와 필수 등록 파일이 올바름
- compressed/extracted/file/logo 제한 이내임

실제 UI 업로드 순서는 [Game Upload Guide](GAME_UPLOAD_GUIDE.md), 전체 runtime 경계는
[Game Platform Architecture](GAME_PLATFORM_ARCHITECTURE.md)를 참조하세요.
