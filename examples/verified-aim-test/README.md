# Verified Aim Test

Unified Manifest v1과 PlayConfig/gs2 서버 검증 경로를 보여주는 업로드 가능한 참조 게임입니다.
게임 ZIP은 점수나 사용자·세션 토큰을 알지 못하며, Host가 공개한 설정과 `requestStart()` 응답의
`challengeSeed`만 사용합니다. 완료 시에는 좌표·순서·상대 시간으로 구성된 작은 evidence만
`OWOGG.complete()`에 전달합니다.

## 빌드와 검증

```text
node examples/verified-aim-test/build.mjs
npx tsx examples/verified-aim-test/verify-zip.mjs
```

생성되는 `verified-aim-test.zip`은 관리자 센터 또는 Game Creator Center의 기존 ZIP 업로드·심사·B2
게시 경로를 그대로 사용합니다. 이 디렉터리는 runtime catalog나 정적 게임 registry가 아닙니다.

검증 스크립트는 실제 production bundle validator로 ZIP 경로·크기·manifest·logo를 확인하고,
`test-vectors.json`으로 브라우저 측 seed 알고리즘을 고정합니다. 같은 벡터는 서버 verifier 테스트도
사용하므로 양쪽 구현이 달라지면 CI가 실패합니다.

## 규칙

- Normal은 표적 6개, Hard는 10개입니다.
- Precision은 Standard보다 표적 반경이 작습니다.
- sequence는 1부터 끊김 없이 증가하고 시간은 단조 증가해야 합니다.
- 서버는 seed로 모든 표적을 다시 만들고 hit geometry와 전체 완료시간을 검증합니다.
- `rawScore`는 서버가 계산한 완료 밀리초이며, 경쟁 점수 보정은 공용 결과 계층이 담당합니다.
- evidence는 최대 10개 이벤트뿐이며 16 KiB 제한보다 충분히 작습니다.

이 verifier는 결정론적 규칙 위조와 비현실적인 시간·좌표를 거절하는 참조 구현이지, 사람과 자동화
클라이언트를 완전히 구별하는 anti-bot 시스템은 아닙니다. raw evidence 저장, 원격 verifier, queue,
cron, replay 보관도 사용하지 않습니다.
