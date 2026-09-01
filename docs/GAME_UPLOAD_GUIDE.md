# OwOGG 게임 업로드 가이드

상태: 가이드

마지막 검증: 2026-09-01

기준 소스:

- `apps/web/app/features/devApi.ts`
- `apps/api/src/routes/devGames.ts`
- `apps/api/src/routes/adminSandboxGames.ts`
- `packages/core/src/application/sandboxGameUseCases.ts`
- `packages/core/src/domain/sandboxGameBundle.ts`

이 문서는 GAME_CREATOR 자격이 있는 사용자가 현재 Game Creator Center에서 standalone Web 게임을
등록하고 새 version을 올리는 절차입니다. bundle 규격과 runtime 개발 계약은
[Game Creation Guide](GAME_CREATION_GUIDE.md)를 먼저 확인하세요.

## 1. 접근 자격

로그인만으로 upload할 수 있는 것은 아닙니다. 다음 중 하나가 Game Creator access를 충족합니다.

- 활성 `game_creator_access` entitlement
- `ADMIN`, `OPERATOR`, `SYSTEM_DEVELOPER` staff role의 implicit access

`MODERATOR`는 implicit upload access가 없습니다. Self-service 신청은 현재
`canApplyForGameCreator() === false`로 운영상 닫혀 있습니다. 관리자 직접 grant와 기존/implicit
access는 계속 동작합니다.

## 2. 새 게임 준비

ZIP root에 최소 다음 파일을 둡니다.

```text
index.html
owogg.json
owogg.logo.<png|jpg|jpeg|webp|svg>
description.md
description_kr.md
description_ja.md
description_zh.md
# description_images에 선언한 raster image (선택, 최대 5개)
```

`owogg.json` 최소 예시:

```json
{
  "$schema": "https://owogg.com/schemas/manifest/v1.json",
  "schemaVersion": 1,
  "game": {
    "slug": "my-game",
    "title": "My Game",
    "localizations": {
      "ko": { "title": "내 게임", "shortDescription": "한국어 한 줄 소개" },
      "ja": { "title": "マイゲーム" },
      "zh": { "title": "我的游戏" }
    },
    "genre": "arcade",
    "tags": ["puzzle", "card-board"],
    "mode": "single",
    "playModes": ["single"],
    "shortDescription": "한 줄 소개",
    "description": [
      "description.md",
      "description_kr.md",
      "description_ja.md",
      "description_zh.md"
    ],
    "description_images": ["docs/how-to-play.webp"]
  },
  "presentation": { "defaultMode": "default" },
  "progression": { "type": "none" },
  "result": { "score": null }
}
```

- ZIP 안에서 `index.html`이 직접 보이게 압축하는 것이 가장 명확합니다.
- 모든 CSS/JS/image/WASM 경로는 bundle 안에서 해석되는 상대 경로여야 합니다.
- source map, 개발 서버 설정, 비밀값, 서버 전용 코드는 넣지 않습니다. `userId`, session/token,
  API URL도 manifest나 게임 코드에 넣지 않습니다.
- `game.playModes`는 필수입니다. 값은 `single`, `local-multi`, `online-multi`이며, single 게임은
  `["single"]`만 사용하고 multi 게임은 local 또는 online topology를 하나 이상 선언합니다.
- `game.genre`는 `skill-test`, `board`, `puzzle`처럼 넓은 대표 장르 하나를 적는 자유 문자열이고,
  `game.tags`에는 `typing`, `reaction`, `card-board`처럼 세부 규칙·테마를 적습니다. 플랫폼은 고정된
  대표 장르 allowlist를 강제하지 않으며 알려진 넓은 장르는 언어별 이름으로 표시하고 알 수 없는 장르는
  원문을 유지합니다. 기존 세부 official 장르는 호환 정규화 후 장르별 화면에서 함께 묶입니다.
- top-level `game.title`과 `shortDescription`은 필수 영어 fallback입니다. 번역은
  `game.localizations.ko|ja|zh`에 `title` 또는 `shortDescription`을 적으며 영어 key는 두지 않습니다.
- `game.description`을 파일 배열로 선언할 때 영어 기본 문서인 `description.md`는 필수이고,
  `description_kr.md`, `description_ja.md`, `description_zh.md`를 선택적으로 함께 선언합니다. 공개 게임
  상세는 현재 UI 언어 문서를 먼저 사용하고, 없으면 영어, 그마저 없으면 기존 짧은 설명으로
  폴백합니다. Markdown raw HTML은 실행하지 않습니다.
- 본문 이미지는 `game.description_images`에 bundle 상대 경로로 명시한 PNG/JPEG/GIF/WebP/AVIF만
  표시합니다. 최대 5개, 파일당 5 MiB이며 SVG와 외부 이미지 URL은 허용하지 않습니다.
- `presentation.defaultMode`는 게임 진입 시 `default` 또는 `theater`를 선택합니다. 사용자는 진입 후
  기존 화면 컨트롤로 모드를 다시 바꿀 수 있습니다.
- `online-multi`는 기능 선언일 뿐 서버 실행 권한이 아닙니다. 온라인 활성화에는 별도 승인된 exact
  version profile이 필요합니다.
- `playConfig + multiplayer`는 `single` 또는 `local-multi`와 `online-multi`가 함께 선언된 hybrid
  게임에서만 허용됩니다. top-level 경쟁 결과는 `single`/`local-multi` 경로에만 적용됩니다. online은
  공용 Relay transport로 실행되고 결과는 항상 `UNVERIFIED`이므로 leaderboard, reward, XP, MMR에
  반영되지 않습니다.
- 현재 활성 runtime 요청은 `websocket + relay`, 2~8인입니다. `worker`/`container`, join-in-progress와
  spectator 요청은 지원 runtime이 생기기 전까지 fail closed합니다. direct message와 host snapshot은
  manifest 요청과 승인된 profile capability가 모두 허용할 때만 SDK에서 사용할 수 있습니다.
- 활성 게임의 공용 roster에는 플랫폼이 측정한 참가자별 대략적 ping이 표시됩니다. 첫 표시는 즉시
  측정하고 공유 갱신은 최소 30초 간격이며, 제작자가 manifest나 application protocol에 ping 필드를
  추가할 필요가 없습니다.
- multiplayer 요청은 exact `(gameId, versionId, contentHash)`와 request hash에 저장됩니다. 관리자 심사는
  disabled Relay profile만 만들고 별도 activation 뒤에만 새 방 생성이 허용됩니다. 새 ZIP/version은 이전
  profile 권한을 상속하지 않으며 현재 room policy는 `PRIVATE + OPEN`입니다.
- `playConfig.verifierId`는 ZIP이 서버 코드를 등록하는 필드가 아닙니다. 서버에 같은 ID의 trusted
  verifier가 정적으로 설치되지 않은 version은 USER/OWOGG 모두 게시 전에 거부됩니다. 현재 reviewed
  ID는 reference용 `verified-aim-test-v1`과 공식 재작성 게임용 `reaction-time-v1`, `aim-test-v1`,
  `typing-test-v1`, `memory-test-v1`입니다. 각 구현은 intended slug, revision, difficulty/variant와
  evidence shape를 다시 확인하며 다른 ID와 lookalike slug는 계속 fail closed합니다.
- `$schema`는 공개 schema URL이며, 서버는 JSON Schema 외에 range, 난이도, 도전과제 참조 관계를
  추가로 엄격 검증합니다. 알 수 없는 필드는 거부됩니다.
- 최대 compressed 20 MiB, extracted 50 MiB, 300 files, path depth 16, logo 2 MiB입니다.

## 3. 새 게임 업로드

1. Game Creator Center에서 새 게임 ZIP을 drag-and-drop 합니다.
2. Web은 `POST /api/dev/games/upload`에 multipart field `bundle`로 전송합니다.
3. 서버가 manifest/logo/path/size를 검증하고 game과 첫 generic numeric version을 생성합니다.
4. 원본 ZIP은 retry를 위한 source archive로 보관됩니다.
5. `GamePublicationService`가 files와 manifest를 B2에 기록합니다.
6. publication 성공 시 version은 `READY`, review 상태는 `PENDING_REVIEW`입니다.

`READY`가 화면에 보이더라도 관리자 승인을 뜻하지 않습니다.

### 3.1 OWOGG 관리자 다중 게시

`/admin/games`의 OWOGG 공식 업로드 영역은 ZIP 여러 개를 한 번에 선택하거나 끌어다 놓을 수 있습니다.
서버가 각 manifest의 slug를 권위로 삼아 새 identity를 등록하거나 같은 slug의 새 버전을 게시합니다.
브라우저는 D1/B2 게시가 겹치지 않도록 파일을 순서대로 처리하고, 한 파일이 실패해도 나머지를 계속
진행한 뒤 파일별 성공·실패 사유를 표시합니다. 이는 관리자 전용 편의 기능이며 Game Creator 업로드의
단일 ZIP·소유권·심사 slot 정책은 바꾸지 않습니다.

## 4. 새 버전 업로드

기존 본인 게임의 상세 화면에서 새 standalone ZIP을 올립니다. API는
`POST /api/dev/games/:id/versions`이며 field는 동일하게 `bundle`입니다.

- owner 또는 허용된 admin만 접근할 수 있습니다.
- 새 version은 기존 파일을 덮어쓰지 않고 새 numeric version prefix에 publication됩니다.
- 새 버전 ZIP에도 같은 slug의 유효한 `owogg.json`이 필수입니다. slug가 다르면 거부됩니다.
- 새 버전에 `owogg.logo.*`가 있으면 게임 logo를 갱신하며, 없으면 기존 logo를 유지합니다.
- 승인 또는 live-version 전환 시 해당 source archive의 manifest가 canonical로 동기화됩니다.
- 심사 중인 게임 slot은 사용자별 최대 2개입니다. slot이 모두 사용 중이면 기존 submission을
  승인/반려/withdraw 처리한 뒤 다시 시도해야 합니다.

### 4.1 부분 재업로드

게임별 관리 메뉴에서 전체 ZIP 외에 `owogg.json`, 설명 문서 또는 로고만 다시 올릴 수 있습니다.
제목, 장르, single/multi 모드, 태그와 기본 화면 모드는 핵심 속성 폼에서 직접 고칠 수도 있습니다.

공개 게임 정보의 `수정하기` 버튼은 OWOGG 게임에서는 elevated `games.moderate` 관리자에게만,
USER 게임에서는 소유 제작자 또는 `sandbox_games.review` 관리자에게만 표시됩니다. 언어 선택 뒤 제목,
요약, Markdown을 한 번에 저장하면 동일한 immutable version 하나로 처리됩니다. 네 언어와 실행 파일을
동시에 갱신할 때는 전체 ZIP 업로드가 가장 안전합니다.

- `owogg.json`과 핵심 속성 저장은 기존 게시 파일을 덮어쓰지 않고 현재 source ZIP을 재구성해 새
  `PENDING_REVIEW` version을 만듭니다. 수정본은 다시 승인되어야 live로 전환할 수 있습니다.
- 로고는 game-level asset이므로 새 version을 만들지 않고 즉시 교체합니다.
- 설명은 지원되는 단일 `.md` 파일 또는 설명 파일·이미지를 묶은 ZIP으로 제출합니다. 단일 파일은 해당
  언어 문서만 교체하고, ZIP은 선언된 설명 문서/이미지 전체를 교체합니다. ZIP에는 영어
  `description.md`가 반드시 있어야 합니다.
- `slug`는 게임의 영구 identity라서 부분 편집으로 바꿀 수 없습니다.
- 일반 Game Creator가 설명 내용 또는 태그를 실제 변경하면 같은 게임의 다음 설명/태그 변경은
  24시간 뒤에 가능합니다. 동일 바이트를 다시 제출하는 요청은 변경으로 보지 않습니다. 관리자는
  운영 복구와 심사를 위해 이 대기 시간을 우회할 수 있습니다.
- standalone `owogg.json`은 256 KiB, Markdown은 파일당 64 KiB, 설명 이미지는 파일당 5 MiB,
  로고는 2 MiB를 초과할 수 없습니다.

## 5. 상태 읽기

두 상태를 따로 확인합니다.

| 축          | 상태                                                  | 의미                 |
| ----------- | ----------------------------------------------------- | -------------------- |
| Publication | `UPLOADED`, `PUBLISHING`, `READY`, `FAILED`           | bundle 저장 완전성   |
| Review      | `PENDING_REVIEW`, `APPROVED`, `REJECTED`, `WITHDRAWN` | USER moderation 결정 |

```text
READY != APPROVED
```

- `FAILED`: publication retry 대상일 수 있습니다. 관리자 republish는 원본 source archive와 같은
  version을 사용합니다.
- `REJECTED`: review 결정이며 publication failure와 다른 축입니다.
- `WITHDRAWN`: Game Creator가 제출을 철회한 상태입니다.
- `APPROVED`: 승인된 version이지만 실제 public serving에는 live-version/visibility와 generic
  runtime validation도 필요합니다.

## 6. Game Creator 동작

현재 Game Creator API surface에는 다음 동작이 있습니다.

- `GET /api/dev/me`: access와 application 상태
- `POST /api/dev/apply`: self-service 신청(현재 policy상 닫힘)
- `POST /api/dev/apply/:id/withdraw`: 신청 철회
- `GET /api/dev/games`: 본인 게임 목록
- `POST /api/dev/games/upload`: ZIP으로 새 게임과 첫 version 등록
- `GET /api/dev/games/:id`: 본인/admin 상세
- `POST /api/dev/games/:id/versions`: 새 version upload
- `POST /api/dev/games/:id/description`: 단일 Markdown 또는 설명 ZIP 교체
- `PATCH /api/dev/games/:id/basic-metadata`: 제목·소개·장르·모드·태그·기본 화면 모드 변경
- `POST /api/dev/games/:id/manifest`: standalone `owogg.json` 교체
- `POST /api/dev/games/:id/logo`: 로고 교체
- `POST /api/dev/games/:id/withdraw`: pending version 철회
- `DELETE /api/dev/games/:id`: 허용되는 미승인 게임 self-delete

수동 catalog-only 등록 endpoint는 제거됐습니다. 새 게임은 항상 검증된 ZIP으로 등록합니다.

관리자 게임 관리 및 심사 화면은 USER 게임에 대해 동일한 immutable 지원 경로를 제공합니다.
`PATCH /api/admin/sandbox-games/:id/basic-metadata`와
`POST /api/admin/sandbox-games/:id/description`은 기존 게시 파일을 직접 덮어쓰지 않고 새
`PENDING_REVIEW` 버전을 만듭니다. XP·점수 정책 같은 서버 운영값은 별도 metadata 경로로 유지합니다.

## 7. 승인 후 runtime 제공

승인/activation된 게임은 USER 전용 host나 slug storage path로 실행되지 않습니다.

```text
/play/:slug
→ /games/<gameId>/<versionId>/index.html
→ GameHost → IframeRuntime → 자동 주입된 window.OWOGG
```

게임은 먼저 `await OWOGG.whenReady()`로 host 초기화를 기다린 뒤 `OWOGG.start()`,
`OWOGG.event()`, `OWOGG.complete()`, `OWOGG.restart()`, `OWOGG.cancel()`을 호출합니다. 화면의
재시작 컨트롤은 게임 안에 두며 `restart()`가 Host의 새 attempt/session과 iframe remount를 요청합니다.
PlayConfig 게임의 난이도·모드
선택기는 게임 내부에서 공개 `difficulties`, `variants`, `allowedConfigs`만으로 만들며, 항목이 하나인
축은 숨기고 기본값을 사용합니다. 선택지와 허용 조합을 플랫폼 UI나 slug별 코드에 별도로 복제하지
않습니다.
모든 게임은 ZIP 안의 게임 UI에서 한국어·영어 전환을 제공해야 하며, 핵심 안내·설정·진행·결과와
접근성 label까지 함께 번역해야 합니다. 언어는 점수 규칙이 아니므로 PlayConfig 축으로 선언하지
않습니다. 소리 설정과 재시작도 외부 플레이어 chrome이 아니라 게임 내부에서 제공합니다.
bundle URL은 version-scoped immutable 경로입니다. `/official-games/*`, release map,
과거 Game Creator 전용 런타임 이름인 `CreatorGameHost`, `transitionalCreatorGameResolver`를 요구하는
가이드는 현재 구현과 맞지 않습니다.

## 8. 오류 확인 순서

- `401`: 로그인 session 확인
- `403`: Game Creator access 또는 ownership 확인
- `409`: slug, review slot, lifecycle invariant 등 충돌 확인
- `413` 또는 bundle rejection: compressed/extracted/logo/file/path 제한 확인
- `503 GAME_BUNDLES_NOT_CONFIGURED`: 해당 환경의 B2 binding 문제이며 bundle 내용 문제가 아님
- `VERIFIER_NOT_REGISTERED`: manifest가 요청한 trusted verifier가 서버 registry에 설치되지 않음
- `FAILED`: 관리자 republish 대상인지 publication error 확인

운영자가 수행하는 approve/reject/revoke/republish/live/visibility 조작은 Game Creator가 직접 호출하는
API가 아닙니다. 권한 경계는 [Authorization](AUTHORIZATION.md)을 참조하세요.
