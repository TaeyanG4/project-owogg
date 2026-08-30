# OwOGG Discord 봇 실무 가이드 (DISCORD_BOT_GUIDE)

이 문서는 OwOGG Discord 연동을 사용하는 서버 관리자, 일반 플레이어 및 운영자를 위한 실무 안내서입니다.

---

## 1. ⚙️ 핵심 아키텍처 이해

OwOGG Discord 연동은 상시 구동 WebSocket 데몬(Gateway) 없이 **Discord HTTP Interactions** 방식으로 동작합니다.

- 상시 연결 프로세스가 없으므로 봇은 멤버 목록에 "오프라인"으로 표시될 수 있으나 슬래시 명령어는 정상 동작합니다.
- **앱 설치 ≠ OwOGG 공개 서버 등록**: 앱을 서버에 초대하는 것과 웹 디렉토리에 서버를 공개 등록하는 것은 별개의 절차입니다.

---

## 2. 🎮 슬래시 명령어 목록 (`/owogg`)

| 명령어                | 설명                                                                       | 사용 예시 / 옵션                   |
| :-------------------- | :------------------------------------------------------------------------- | :--------------------------------- |
| `/owogg help`         | OwOGG 봇의 모든 명령어와 사용법을 안내합니다.                              | `/owogg help`                      |
| `/owogg link`         | OwOGG 웹 계정과 Discord 계정을 연동하기 위한 1회용 보안 링크를 발급합니다. | `/owogg link`                      |
| `/owogg profile`      | 연동된 계정의 OwOGG 프로필, 레벨, XP 및 진행바를 확인합니다.               | `/owogg profile`                   |
| `/owogg games`        | 현재 플레이 가능한 미니게임 카탈로그 목록을 확인합니다.                    | `/owogg games`                     |
| `/owogg play`         | 서버 기여도가 누적되는 1회용 게임 플레이 링크를 생성합니다.                | `/owogg play game:반응속도`        |
| `/owogg rank`         | 현재 서버 내에서 나의 게임별 순위 및 XP 기여 순위를 확인합니다.            | `/owogg rank game:에임`            |
| `/owogg leaderboard`  | 현재 서버 내 구성원들의 게임 점수 및 XP 리더보드를 확인합니다.             | `/owogg leaderboard period:weekly` |
| `/owogg server`       | 현재 Discord 서버의 OwOGG 등록 상태, 누적 서버 XP 및 통계를 조회합니다.    | `/owogg server`                    |
| `/owogg achievements` | 내가 획득한 OwOGG 도전과제 및 미완료 업적 목록을 조회합니다.               | `/owogg achievements`              |

---

## 3. 🚀 서버 관리자: 설치 및 공개 등록 절차

### 3.1 봇 설치 (Invite)

1. Discord Developer Portal의 공식 OAuth 설치 URL 또는 웹 안내 페이지를 통해 서버에 봇을 초대합니다 (`applications.commands` 권한 필요).

### 3.2 웹에서 서버 등록 (`/discord/servers`)

1. 서버 관리자(`MANAGE_GUILD` 또는 `ADMINISTRATOR` 권한 보유자)가 OwOGG 웹에 로그인합니다.
2. `/discord/servers`에서 [내 서버 등록하기]를 클릭하고 Discord OAuth 권한을 승인합니다.
3. 권한이 확인된 서버를 선택하고 서버 slug 및 설명, 가시성(`PUBLIC`, `UNLISTED`, `PRIVATE`)을 설정합니다.
4. 등록 완료 후 서버 전용 페이지(`/discord/servers/:slug`)가 생성됩니다.

---

## 4. 🔧 자주 묻는 질문 및 문제 해결

- **명령어가 자동완성되지 않거나 응답이 없음**:
  - Developer Portal의 "Interactions Endpoint URL"에 `https://api.owogg.com/api/discord/interactions`가 정확히 저장되어 있는지 확인합니다.
  - 전역 명령어 동기화에는 최대 1시간이 소요될 수 있습니다 (테스트 길드에는 `pnpm discord:commands:register:guild`로 즉시 등록 가능).
- **계정 연동 오류 (`이미 연동된 계정`)**:
  - 다른 OwOGG 계정에 해당 Discord 계정이 현재 연결된 경우 발생합니다. 기존 계정에서 Discord 연결을 정상 해제한 뒤에는 다른 OwOGG 계정에 다시 연결할 수 있습니다. 활성 연결을 계정 통합으로 직접 이전할 수는 없습니다.

Worker 환경변수, Developer Portal 설정, 명령어 등록/드리프트 점검, 장애 진단을 다루는 검증된
운영 절차서는 현재 저장소에 없습니다. 실제 자격 증명과 운영 절차는 별도 운영 문서 단계에서
작성해야 합니다.
