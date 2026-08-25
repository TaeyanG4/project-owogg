# 1:1 멀티플레이어 반응 대결 설계안 (MULTIPLAYER_GAME_DESIGN)

> **역사적 제안 / 구현 기준 아님:** 이 문서는 초기 Reaction Duel 아이디어를 보존합니다. 현재
> 멀티플레이 구현 범위, 서버 권위, ticket, 결과·XP, Creator, M0~M6 Gate의 단일 계획은
> [`MULTIPLAYER_PLATFORM.md`](MULTIPLAYER_PLATFORM.md)를 따릅니다. 특히 이 문서의 client click
> timestamp 신뢰, `Room` 중심 모델과 기존 play token 재사용 전제는 구현 근거로 사용하지 않습니다.

이 문서는 Cloudflare Durable Objects 및 WebSocket Hibernation 기반의 1:1 실시간 반응속도
대결(Reaction Duel) 기술 설계안을 정의합니다.

> **이 문서는 설계 단계 결론입니다.** 아직 코드 구현은 없습니다. 실시간 멀티플레이어는 서버
> 권위(authoritative) 로직과 WebSocket/실시간 인프라가 필요해서 유저 게임 제작 권한만으로는
> 안 되고, 매번 운영자가 직접 백엔드 작업을 해야 합니다(`docs/GAME_CREATION_GUIDE.md` §3, §5
> 비목표 참고). 이 문서가 다루는 것은 **운영자가 직접 만드는 첫 번째 멀티플레이어 게임**이며,
> 유저가 직접 멀티플레이어 게임을 제출하는 기능은 여전히 범위 밖입니다.

---

## 1. 🎮 게임 컨셉: 반응속도 대결 (Reaction Duel)

- 기존 `games/reaction-time` 엔진의 클릭 판정 로직을 재사용합니다 — 새 게임 로직을 거의 새로
  짜지 않습니다. "언제 화면을 바꿀지"만 클라이언트가 아니라 서버(Durable Object)가 결정합니다.
- **서버 권위(Authoritative) 트리거**: 화면 색상 전환 타이밍을 서버가 무작위로 결정해 브로드캐스트합니다.
- **승패 판정**: 서버가 보낸 기준 시각 대비 더 빠르게 클릭 시각을 회신한 플레이어가 승리합니다.
- 라운드가 몇 초 안에 끝나서 상태 동기화가 복잡하지 않습니다 — 첫 멀티플레이어 게임으로 적합한
  이유입니다. 진법/체스류처럼 긴 턴제 상태를 유지할 필요가 없습니다.

---

## 2. ⚡ 인프라: Cloudflare Durable Objects

```text
Player A (WebSocket) ──┐
                       ├──➔ [ Durable Object Instance (Room) ]
Player B (WebSocket) ──┘           │ (Match State & Trigger)
                                   ▼
                         [ D1 Database (Match Result Record) ]
```

현재 `apps/api/wrangler.jsonc`에는 D1만 있고 Durable Objects 바인딩이 없습니다 — 이 기능은
저장소에 처음 추가되는 실시간 인프라입니다.

- **방 단위 DO 인스턴스**: 방 상태(참가자 WebSocket, 준비 상태, 트리거 시각)는 D1이 아니라 DO
  자체 메모리/스토리지에 둡니다 — 활성 대결에만 존재하면 되는 휘발성 상태이기 때문입니다.
- **WebSocket Hibernation API**: 두 플레이어가 다 붙기 전까지 유휴 상태인 DO가 과금/리소스를
  거의 쓰지 않도록 합니다.
- **서버 권위 트리거**: DO가 무작위 지연 후 "GO" 신호를 두 클라이언트에 동시 브로드캐스트하고,
  각 클라이언트는 자신의 클릭 시각만 보고합니다. 판정은 DO가 "자신이 보낸 트리거 시각" 기준으로
  계산합니다 — 클라이언트가 트리거 시각 자체를 조작할 방법이 없습니다. (클릭 시각 자체는 기존
  단일 플레이 점수 제출과 동일하게 클라이언트 신고값이며, 새로운 신뢰 경계가 아니라 기존
  `scoreValidation.ts`의 신뢰 모델과 동일한 수준입니다.)
- **결과 영구화**: 대결이 끝나면 최종 결과 1건만 D1에 기록하고 DO는 정리됩니다 — 방 자체를 영구
  저장하지 않습니다.

---

## 3. 🔄 대결 진행 플로우

1. **방 생성**: Player A가 `/games/reaction-time/duel`(가칭)에서 방을 생성 → 방 코드/링크 발급.
2. **공유**: Player A가 링크를 공유합니다(웹 복사, 또는 아래 §4 Discord 연동).
3. **참가**: Player B가 링크를 열고 방에 참가 ➔ DO에 WebSocket 연결.
4. **카운트다운**: 두 플레이어 준비 완료 시 DO가 무작위 지연 후 "GO" 신호 동시 브로드캐스트.
5. **결과 수집**: 각 클라이언트가 클릭 시각을 서버로 전송.
6. **판정 및 종료**: DO가 승자를 계산해 양쪽에 결과를 브로드캐스트하고 D1에 최종 결과를 기록.

기존 `/owogg play`의 1회용 플레이 토큰(15분 만료, 1회 사용) 패턴을 방 초대 토큰에도 그대로
재사용할 수 있습니다 — 새로운 토큰 발급/검증 로직을 새로 설계할 필요가 없습니다.

---

## 4. Discord 연동 (선택, 2단계)

V1 범위에는 넣지 않지만, 방 링크 공유 방식이 이미 텍스트 링크이므로 자연스럽게 확장됩니다:

- `/owogg duel @상대` 같은 서브커맨드로 방을 생성하고 상대를 멘션 — Discord의 `USER` 옵션
  타입으로 구현 가능합니다.
- `/owogg play`의 서버 귀속 링크 발급 패턴, `/owogg help`의 서브커맨드 등록 방식을 그대로
  재사용합니다.

---

## 5. DB 스키마 초안 (최종 결과만 기록)

```sql
CREATE TABLE duel_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,                          -- 예: 'reaction-time-duel'
  player_a_user_id INTEGER NOT NULL REFERENCES users(id),
  player_b_user_id INTEGER NOT NULL REFERENCES users(id),
  winner_user_id INTEGER REFERENCES users(id),    -- NULL = 무승부/기권
  player_a_result_ms INTEGER,
  player_b_result_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

기존 `scores` 테이블(개인 최고기록 리더보드)과는 분리합니다 — 대결 승패는 "최고 기록"이 아니라
"상대 전적"이라 의미가 다르고, 섞으면 기존 리더보드 정렬/난이도 파티셔닝 로직을 오염시킵니다.

---

## 6. V1 범위와 비목표

- **범위 안**: 운영자가 직접 만드는 반응속도 대결 게임 1종, 방 초대 링크, DO 기반 서버 권위 판정,
  대결 결과 기록.
- **범위 밖**: 유저 제작 멀티플레이어 게임(`docs/GAME_CREATION_GUIDE.md`에서 이미 별도 대형
  투자로 분류), Discord 봇 연동(2단계), 3인 이상 멀티플레이어, 관전 모드, 재접속/재연결 처리(V1은
  연결 끊기면 그대로 대결 무효 처리).

---

## 7. 다음 단계

이 설계가 승인되면 구현 순서를 다음으로 제안합니다:

1. `apps/api/wrangler.jsonc`에 Durable Objects 바인딩 추가 + 최소 DO 클래스(방 생성/참가/트리거만).
2. 웹 쪽 `/games/:slug/duel` 라우트 + WebSocket 클라이언트.
3. `duel_matches` 마이그레이션 + 결과 기록.
4. Discord 연동은 별도 후속 작업으로 분리(§4).
