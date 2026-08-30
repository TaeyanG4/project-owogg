# Relay Protocol Probe

게임별 서버 driver나 ruleset 없이 `window.OWOGG.multiplayer`만 사용하는 2~8인 온라인 fixture입니다.
제작자 코드가 자체 application protocol을 정의하고, host가 counter state와 reconnect snapshot을
관리합니다. 서버는 payload를 해석하거나 결과·승자를 만들지 않습니다.

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
