# Relay Protocol Probe

게임별 서버 driver나 ruleset 없이 `window.OWOGG.multiplayer`만 사용하는 2~8인 온라인 fixture입니다.
제작자 코드가 자체 application protocol을 정의하고, host가 counter state와 reconnect snapshot을
관리합니다. 서버는 payload를 해석하거나 결과·승자를 만들지 않습니다.

같은 fixture 안의 **Real-account load gate**는 봇이나 인증 우회 없이 방에 입장한 실제 계정들이
동일한 Relay SDK를 사용해 좌석당 1/5/20Hz 부하를 보냅니다. Host가 조건을 선택하면 모든 좌석의
준비 응답 뒤 3초 후 동시에 시작하며, 좌석별 전송·수신·거부·중복·server sequence gap과 self-echo
p95/p99 지연을 집계합니다. 60초 idle/wake 시험은 application message가 없는 구간 뒤 첫 broadcast와
server sequence 연속성을 확인합니다.

- `256B`는 정상 부하와 지연 측정용입니다.
- `3072B` 다인원 20Hz는 방 전체 byte 상한을 의도적으로 넘길 수 있는 보호 동작 시험입니다.
- 각 좌석은 서로 다른 정상 사용자 계정이어야 하며, 같은 계정으로 여러 좌석을 만들거나 자동화 계정
  권한을 우회하지 않습니다.

```bash
node examples/relay-protocol-probe/build.mjs
pnpm exec tsx examples/relay-protocol-probe/verify-zip.mjs
```

생성된 `relay-protocol-probe.zip`은 일반 Game Creator/Admin ZIP 업로드 경로로 등록할 수 있습니다.
ZIP entry timestamp는 고정되어 동일 소스에서 항상 같은 content hash를 생성합니다.
업로드 후 exact version의 multiplayer request를 관리자가 승인하고 profile을 별도로 활성화해야 방을 만들
수 있습니다. Relay 결과는 `UNVERIFIED`이며 leaderboard, XP, reward, MMR에 반영되지 않습니다.

이 fixture를 운영 catalog의 게임으로 노출하지 않을 때는 관리자 게임 관리에서 **내부 테스트 도구로
이동**합니다. 이 분류는 ZIP이나 `owogg.json`이 선언하지 않으며 서버의 관리자 control plane만
변경합니다. 이후 관리자 화면의 **내부 테스트 도구** 탭에서 공용 대기실과 Relay를 실행할 수 있습니다.
