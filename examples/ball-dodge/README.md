# ball-dodge — OWOGG Browser API 참고 통합

이 예제는 `owogg.json`과 자동 주입되는 `window.OWOGG` API를 사용하는 업로드 가능한 참고
bundle입니다. 게임 안에는 SDK, 사용자 ID, 세션 토큰, API 주소를 넣지 않습니다.

## Build

```
node examples/ball-dodge/build.mjs
```

`main.ts`를 컴파일하고 `owogg.json`과 정적 자산을 복사한 뒤 실제 업로드 파일인
`ball-dodge.zip`을 만듭니다.

## Verify (optional, before uploading)

```
npx tsx examples/ball-dodge/verify-zip.mjs
```

Runs the actual production bundle validators
(`packages/core/src/domain/sandboxGameBundle.ts`) against the built zip, plus a check that the
Game Creator Manifest v1과 Browser API 호출이 bundle에 들어갔는지 확인합니다.

## Manual E2E

1. Build the zip (above).
2. Sign in as a developer, open the Game Creator Center, and drag `ball-dodge.zip` onto the
   auto-registration drop zone. This creates the game and its first version through
   `createGameFromBundle` — the same call any Game Creator upload makes.
3. As an admin, approve the pending version and set the game's visibility to PUBLIC (same review
   flow as any other Game Creator game).
4. Web app에서 `/games/ball-dodge`를 엽니다. Generic public game API가 live version을 해석하고
   `GameHost`가 `IframeRuntime`과 Bridge를 통해 bundle을 실행합니다.
5. 시작을 눌러 `OWOGG.start()`가 호출되는지 확인합니다.
6. 공이 플레이어와 충돌하게 하고, 생존 시간과 `ballsSpawned` metric이
   `OWOGG.complete()`를 통해 결과 UI와 서버 결과 수락 경로에 도달하는지 확인합니다.
7. Click 다시 시작 — confirm the iframe fully reloads (fresh bridge handshake) and the game is
   playable again.
8. `/games/reaction-time` 또는 다른 OWOGG 게임을 열어 동일한 `GameHost` → `IframeRuntime` → Bridge
   경로에서 play, difficulty, score submission, leaderboard preview가 동작하는지 확인합니다.
