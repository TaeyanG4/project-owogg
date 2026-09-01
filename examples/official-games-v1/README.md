# OWOGG official game v1 migrations

Phase 7에서 기존 공식 게임 identity와 UI·상호작용·로고를 보존하고, 클라이언트 점수와 구 runtime
연결부만 단일 `owogg.json` v1의 PlayConfig/evidence/Relay 경계로 교체한 업로드 전용 standalone
소스입니다. 이 디렉터리는 runtime registry가 아니며 Web/API가 slug로 참조하지 않습니다.
관리자 화면에서 생성된 ZIP을 직접 등록하며, 같은 slug가 이미 있으면 새 버전으로 업데이트합니다.

```bash
node examples/official-games-v1/build-all.mjs
pnpm exec tsx examples/official-games-v1/verify-all.mjs
```

검증용 ZIP은 `examples/official-games-v1/dist/`에 놓이며 Git에는 포함하지 않습니다. 장기 보관본은
기본적으로 형제 디렉터리 `project-owogg-games/<slug>/<slug>_v<major.minor.patch>.zip`에 함께
생성합니다. 예를 들면 `typing-test/typing-test_v1.0.0.zip`입니다. 다른 위치가 필요하면
`OWOGG_GAMES_BACKUP_DIR` 환경 변수를 사용합니다. 같은 버전명이 이미 다른 내용으로 존재하면
덮어쓰지 않고 빌드를 실패시키므로 `games.mjs`의 SemVer `artifactVersion`을 올려야 합니다.
`inventory.json`의 SHA-256과 로컬 결과가 일치하는 artifact만 등록합니다.

2026-08-30 Staging 관리자 목록을 새로고침해 동결한 재등록 대상은 아래 5개 `GAME` identity
전부입니다. `relay-protocol-probe`는 별도 `INTERNAL_TOOL`이므로 삭제·게임 재등록 대상이 아닙니다.

- `official-omok`: 같은 기기의 `local-multi`와 공용 Relay 기반 `online-multi`
- `reaction-time`: 2~8초 신호 범위와 클릭 시점 evidence를 검증하는 PlayConfig 게임
- `aim-test`: seed 기반 표적 좌표와 순차 hit evidence를 검증하는 PlayConfig 게임
- `typing-test`: seed가 선택한 문장을 90초 동안 줄 단위로 입력하고 WPM·CPM·정확도 종합 점수를 계산하는 PlayConfig 게임
- `memory-test`: seed 기반 색상 순서와 입력 evidence로 완료 level을 계산하는 PlayConfig 게임

게임은 `await OWOGG.whenReady()` 뒤 공개 PlayConfig를 읽습니다. 선택기와 기본값은 `owogg.json`에서
정규화된 값만 사용하며 항목이 하나인 difficulty/variant 축은 표시하지 않습니다. 모든 게임은 게임
내부에서 한국어·English 표시 언어와 소리 사용 여부를 바꿀 수 있습니다. 현재 제품 UI는 에임의
난이도 2단계, 타자의 한국어·English·日本語·中文 긴 지문 4개 variant만 선택 화면을 보이고,
반응속도와 기억력은 단일 설정으로 바로 시작합니다. 오목은 local/online topology만 고르며 score와
leaderboard를 선언하지 않습니다. 싱글 게임의 재시작 버튼은 ZIP UI가 소유하고 `OWOGG.restart()`로
Host의 새 검증 시도를 요청합니다.

공식 5종은 모두 `presentation.aspectRatio: "16:9"`를 선언합니다. 에임·기억력·오목은
`v1.0.1`에서 1:1 선언과 세로 누적 배치를 제거했고, iframe viewport 안에서 줄어드는 내부 레이아웃으로
전환했습니다. 반응속도·타자는 기존 `v1.0.0`부터 16:9이므로 내용이 바뀌지 않은 백업을 그대로 둡니다.
오목 `v1.0.5`부터 방 나가기는 Host의 하단 방 메뉴만 소유하며 ZIP 내부에는 중복 버튼을 두지 않습니다.
`v1.0.6`은 16:9 게임판 배치를 유지하면서 플레이 방식 선택 화면만 전체 viewport 중앙 정렬로
복원합니다.
`v1.0.7`은 실제 대국 화면을 좌측 게임 설정·중앙 오목판·우측 Relay 정보의 대칭 3열로 바꾸고,
중복되는 차례 상태 상자는 화면에서 제거합니다.
2026-09-02 localization artifact는 5종 모두 영어 기본 제목·요약과 한국어·일본어·중국어 번역,
`description.md`, `description_kr.md`, `description_ja.md`, `description_zh.md`를 포함합니다. 새 보관 버전은
오목 `v1.0.8`, 반응속도 `v1.0.1`, 에임 `v1.0.2`, 타자 `v1.0.3`, 기억력 `v1.0.5`이며, 타자와 기억력은
각각 기존 `v1.0.1`, `v1.0.3`의 최신 UI를 원본으로 역동기화해 회귀를 막았습니다.

온라인 오목의 payload 규칙과 상태 권위는 ZIP 안의 host-authoritative application protocol이
소유합니다. 플랫폼 서버에는 오목 driver/ruleset이 없습니다. 반대로 싱글 경쟁 결과 verifier는
leaderboard 보안을 위한 검토 완료 서버 코드이므로 Relay 게임 규칙과 다른 경계입니다.

Staging 등록 순서는 다음과 같습니다.

1. 관리자가 다중 ZIP 선택 또는 연속 drag로 `project-owogg-games/` 백업본을 누적 큐에 넣어
   등록·업데이트하고, 업로드 제한 응답은 화면이 안내한 시간만큼 자동 대기·재시도합니다. 완료 뒤
   파일별 결과와 `inventory.json`의 bytes/SHA-256을 대조합니다.
2. 싱글 4종은 게임 실행·gs2 결과·리더보드를 확인합니다.
3. 오목은 exact version의 Relay 요청을 게임 관리 카드에서 승인한 뒤 profile을 별도로 활성화합니다.
4. 같은 ZIP에서 `local-multi`와 `online-multi`를 각각 실제 계정으로 확인합니다.

ZIP 업로드가 Relay 권한을 자동으로 부여하지는 않습니다. 승인으로 disabled profile을 만들고 activation을
별도로 수행하는 서버 권한 경계는 그대로 유지됩니다.
