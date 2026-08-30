# OWOGG official game v1 rebuilds

Phase 7에서 기존 공식 게임 identity를 단일 `owogg.json` v1 규격으로 다시 만든 업로드 전용
standalone 소스입니다. 이 디렉터리는 runtime registry가 아니며 Web/API가 slug로 참조하지 않습니다.
관리자 화면에서 기존 identity를 삭제한 뒤 생성된 ZIP을 직접 등록합니다.

```bash
node examples/official-games-v1/build-all.mjs
pnpm exec tsx examples/official-games-v1/verify-all.mjs
```

생성 ZIP은 `examples/official-games-v1/dist/`에 놓이며 Git에는 포함하지 않습니다.
`inventory.json`의 SHA-256과 로컬 결과가 일치하는 artifact만 등록합니다.

2026-08-30 Staging 관리자 목록을 새로고침해 동결한 재등록 대상은 아래 5개 `GAME` identity
전부입니다. `relay-protocol-probe`는 별도 `INTERNAL_TOOL`이므로 삭제·게임 재등록 대상이 아닙니다.

- `official-omok`: 같은 기기의 `local-multi`와 공용 Relay 기반 `online-multi`
- `reaction-time`: challenge seed와 클릭 시점 evidence를 검증하는 PlayConfig 게임
- `aim-test`: seed 기반 표적 좌표와 순차 hit evidence를 검증하는 PlayConfig 게임
- `typing-test`: seed가 선택한 문장과 입력 evidence로 WPM을 계산하는 PlayConfig 게임
- `memory-test`: seed 기반 색상 순서와 입력 evidence로 완료 level을 계산하는 PlayConfig 게임

온라인 오목의 payload 규칙과 상태 권위는 ZIP 안의 host-authoritative application protocol이
소유합니다. 플랫폼 서버에는 오목 driver/ruleset이 없습니다. 반대로 싱글 경쟁 결과 verifier는
leaderboard 보안을 위한 검토 완료 서버 코드이므로 Relay 게임 규칙과 다른 경계입니다.

Staging 등록 순서는 다음과 같습니다.

1. 사용자가 관리자 화면에서 같은 slug의 실행 불가 구 identity를 삭제합니다.
2. `dist/`의 ZIP을 `inventory.json`의 bytes/SHA-256과 대조해 하나씩 업로드합니다.
3. 싱글 4종은 게임 실행·gs2 결과·리더보드를 확인합니다.
4. 오목은 exact version의 Relay 요청을 게임 관리 카드에서 승인한 뒤 profile을 별도로 활성화합니다.
5. 같은 ZIP에서 `local-multi`와 `online-multi`를 각각 실제 계정으로 확인합니다.

ZIP 업로드가 Relay 권한을 자동으로 부여하지는 않습니다. 승인으로 disabled profile을 만들고 activation을
별도로 수행하는 서버 권한 경계는 그대로 유지됩니다.
