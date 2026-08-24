# OwOGG 스트리머 시스템 (STREAMER_SYSTEM)

이 문서는 스트리머(방송인/유튜버) 채널 소유권 검증 모델, 4개 플랫폼 OAuth API 규격, Featured 심사 엔진 및 감사 원장 아키텍처를 정의합니다.

> 이 문서의 "스트리머"는 전부 **STREAMER**를 가리킵니다(방송 채널 인증) — 게임을 만드는
> **GAME_CREATOR**(별도 프로그램, [`docs/GAME_CREATION_GUIDE.md`](GAME_CREATION_GUIDE.md) §3)와는
> 다른 축입니다. 두 프로그램이 Staff Role(ADMIN/OPERATOR 등 운영 역할)과 어떻게 다른지, 왜 같은
> 용어로 취급하면 안 되는지는 [`docs/AUTHORIZATION.md`](AUTHORIZATION.md)의 프로그램 구분을
> 참고하세요. 방송 채널 기능은 `Streamer`, 게임 제작 기능은 `GameCreator` 접두사를 사용합니다.

---

## 1. 🎯 스트리머 채널 소유권 검증 (Verification Model)

- **정의**: 사용자가 외부 플랫폼의 채널을 직접 소유하고 있음을 공식 OAuth 2.0 API로 증명한 상태.
- **불변식**:
  1. 게임 점수(Score)나 경험치(XP)에 어떠한 가산점도 부여하지 않습니다 (랭킹 무결성 불변).
  2. 스크래핑, 텍스트 입력, 이메일 추론을 통한 인증을 엄금하며 오직 공식 OAuth 권한 부여 코드 흐름만 사용합니다.
  3. 채널 중복 연동 불가: `UNIQUE(platform, platform_user_id)` 제약조건으로 1개 외부 채널은 1개 OwOGG 계정에만 귀속됩니다.
  4. 장기 토큰 미저장: 채널 ID 및 메타데이터 수집 직후 OAuth access_token은 즉시 메모리에서 폐기합니다.
- **스트리머 랭킹 (`/ranking`) 노출 조건**:
  - YouTube, CHZZK, SOOP, Twitch 중 **최소 1개 플랫폼**의 인증(`verification_status = 'VERIFIED'`)이 완료되면 노출됩니다.
  - 다중 플랫폼을 인증한 사용자도 랭킹에는 1행만 표시되며, 우측에 인증된 플랫폼 아이콘 배지가 노출됩니다.

---

## 2. 🔌 플랫폼별 Canonical ID 및 API 규격

| 플랫폼      | Canonical ID                           | OAuth Scope                      | API 조회 엔드포인트                                                                    |
| :---------- | :------------------------------------- | :------------------------------- | :------------------------------------------------------------------------------------- |
| **YouTube** | YouTube Channel ID (`UC...`)           | `.../auth/youtube.readonly`      | `GET https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true` |
| **Twitch**  | Twitch User ID (숫자 문자열)           | `user:read:email`                | `GET https://api.twitch.tv/helix/users`                                                |
| **CHZZK**   | Chzzk Channel ID (`content.channelId`) | Naver OAuth (authorization code) | `GET https://openapi.chzzk.naver.com/open/v1/users/me`                                 |
| **SOOP**    | SOOP User ID (`user_id`)               | Authorization code grant         | `GET https://openapi.sooplive.co.kr/user/me`                                           |

개발자 포털 등록과 CI/CD 자격 증명 배선의 검증된 운영 절차서는 현재 저장소에 없습니다. 실제
자격 증명 절차는 별도 운영 문서 단계에서 작성해야 하며, 이 문서는 미검증 설정값을 추측하지
않습니다.

---

## 3. ⭐ Featured Streamer 심사 엔진 및 감사 원장

Featured 표식은 대규모 오디언스를 보유한 스트리머를 위한 플랫폼 차원의 특별 큐레이션 배지입니다.

### 3.1 자동 자격 심사 및 하이스테리시스 정책

- **취득 기준(정상 값)**: 플랫폼 구독자/팔로워 합계 **10,000명 이상** 그리고 채널 나이 90일
  이상. 12,000명 이상이면 자동 심사 후보(`AUTO_REVIEW_PENDING`)로 올라갑니다.
- **유지 기준**: 14일 재검증 시 **8,000명 미만**이면 Featured 배지를 철회합니다(취득 기준보다
  낮게 설정된 하이스테리시스 — 일시적 하락으로 인한 배지 깜빡임 방지).
- **자동 스케줄러**: Cloudflare Workers Cron Trigger가 6시간 간격으로 공식 지표를 갱신합니다.
- **일시적 API 오류 방어**: 외부 플랫폼 API 일시 장애 시에는 기존 자격을 안전하게 유지합니다.

기준값은 `packages/core/src/domain/featuredPolicy.ts`의 `FEATURED_POLICY` 상수 단일 소스에서
관리됩니다. 심사 잡 상태 모델, 스케줄러, 의사결정 규칙의 내부 동작 전체 상세는
`docs/archive/streamer-system-review-engine-detail.md`(운영진 로컬 전용, 저장소에는 포함되지
않음)에 보존되어 있습니다.

### 3.2 수동 심사 큐 및 Append-Only 감사 원장

- 관리자는 `/admin/streamers`에서 특정 스트리머에 대해 Featured 자격을 수동 승인(`APPROVE`), 거절(`REJECT`), 또는 취소할 수 있습니다.
- 모든 수동 심사 결정은 `streamer_review_audit_log` 테이블에 사유(`reason`)와 함께 불변(append-only)으로 기록됩니다 (UPDATE/DELETE 트리거 차단).
