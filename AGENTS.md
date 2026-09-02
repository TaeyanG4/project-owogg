# OwOGG Agent Instructions

이 파일은 저장소 루트에서 작업하는 Codex 및 기타 AI 코딩 에이전트가 가장 먼저 읽어야 하는
진입점입니다.

작업을 시작하기 전에 반드시 다음 문서를 읽고 준수합니다.

1. 이 파일 전체 — 저장소에 추적되는 AI Agent 강제 규칙
2. [`docs/STAGING.md`](docs/STAGING.md) — 격리된 Staging 구성과 승격 절차
3. [`docs/BRANCH_MANAGEMENT.md`](docs/BRANCH_MANAGEMENT.md) — 브랜치 자동 감사·분류·정리 절차

로컬에 `docs/AGENTS.md`가 있으면 아키텍처·코딩 세부 규칙도 함께 따릅니다. 이 파일은 public
repository에 포함되지 않는 로컬 보충 문서이므로, 배포 안전 정책은 이 루트 파일과 `docs/STAGING.md`
만 읽어도 완전하게 이해할 수 있어야 합니다.

가장 중요한 배포 원칙은 다음과 같습니다.

- 모든 기능, 버그 수정, DB migration, 인프라 변경은 **Staging-first**로 진행합니다.
- 일반 기능은 `feature/*`, 버그 수정은 `fix/*` 작업 브랜치를 최신 `staging`에서 만들며 최초 병합
  대상은 항상 `staging`입니다. Production `main`에서 직접 기능을 구축하지 않습니다.
- Production 승격은 Staging에서 실제 통합 테스트를 통과한 동일 tree에 대해 `staging → main` PR로만
  진행합니다. 작업 브랜치에서 `main`으로 직접 PR을 만들거나 병합하지 않습니다.
- 로컬 `pnpm verify` 성공은 구현 완료일 뿐, 배포 완료가 아닙니다.
- `Staging 배포 완료`는 CI/CD 성공만 뜻하지 않습니다. `https://stg.owogg.com/`이 실제로 DNS/HTTPS와
  Access를 거쳐 열리고, API health와 배포 SHA가 대상 commit과 일치해 사용자가 브라우저에서 테스트할
  수 있을 때만 사용합니다.
- Staging smoke와 기능별 수동 검증을 통과한 동일한 tree만 Production 후보가 됩니다.
- 에이전트는 현재 작업에서 사용자가 명시적으로 Production 승격을 승인하지 않은 한 `main` push,
  Production 배포·D1 migration·secret 변경, Discord global command sync를 실행하지 않습니다.
- Staging 검증 뒤 코드나 설정이 한 줄이라도 바뀌면 기존 승인은 무효이며 다시 Staging부터 검증합니다.
- 완료 보고는 `구현 완료(로컬 검증 완료)`, `Staging 배포 완료(테스트 가능)`,
  `Staging 검증 완료(Production 승격 대기)`, `Production 배포 완료`를 구분해 표현합니다.
- 브랜치는 `pnpm branches:audit`으로 `삭제 가능 / 보존 필요 / 애매함`을 분류합니다. 감사 결과만으로
  삭제 권한이 생기지 않으며, 정확한 대상에 대한 승인 없이 local/remote branch나 worktree metadata를
  삭제하지 않습니다.
- 게임 catalog·플레이·점수·공식 표시는 generic D1/B2가 유일한 runtime authority입니다. 새 게임을
  `games/*` workspace, Git bundle, deploy bootstrap으로 등록하거나 D1/B2 실패를 정적 데이터로
  폴백하지 않습니다.
- 관리자 센터의 단일 **게임 관리 및 심사** 화면(`/admin/games`)은 OWOGG 업로드, 전체 게임 안전
  제어, 사용자 제작 게임 심사를 함께 제공합니다. 관리자 ZIP 업로드는 Game Creator Center와 같은
  standalone ZIP/drag-and-drop 입력을 공유하지만 서버가 publisher를 `OWOGG`로 고정합니다. Game
  Game Creator 업로드는 인증된 `USER(userId)`를 소유자로 저장하고 공개 제작자명은 그 사용자의 닉네임을
  사용합니다. ZIP metadata가 official 여부나 제작자 identity를 스스로 선언하도록 허용하지 않습니다.
  `/admin/sandbox-games`는 예전 북마크 호환용이며 새 메뉴·문서 링크를 만들지 않습니다.
- Git 기반 `game-registry`, 생성 manifest/definition, 정적 게임 목록을 복원하지 않습니다. Web, API,
  Discord, 도전과제, 개인화, 랭킹은 모두 D1/B2 기반 public game catalog를 사용합니다.

## 필수 작업 흐름

```text
feature/* 또는 fix/*
  → 작업 + 로컬 테스트
  → staging
  → https://stg.owogg.com 실제 통합 테스트
  → 문제 발견 시 수정 후 staging 재배포·재검증
  → Staging 검증 완료
  → PR: staging → main
  → main
  → Production 배포·검증
```

1. 최신 `staging`을 기준으로 기능은 `feature/*`, 버그 수정은 `fix/*` 작업 브랜치를 만들고 로컬에서
   구현합니다.
2. `pnpm format`, `pnpm verify`, `git status`, `git diff`를 확인합니다.
3. 허용된 경우에만 `staging` 대상으로 병합·push하여 Staging CI/CD를 실행합니다.
4. `stg.owogg.com`의 실제 브라우저 접속, API health, 배포 SHA를 확인한 뒤에만
   `Staging 배포 완료(테스트 가능)`로 보고합니다. DNS 미설정, Access 차단 오류, placeholder 페이지,
   CI-only 성공은 배포 완료가 아닙니다.
5. Staging에서 변경 기능 acceptance, D1/B2/OAuth/Discord 격리, Production 무변경을 확인합니다.
6. 대상 commit SHA/tree와 테스트 결과를 기록하고 `Staging 검증 완료(Production 승격 대기)`로
   보고합니다.
7. 릴리스별 명시적 승인을 받은 뒤에만 `staging → main` PR을 통해 검증된 동일 tree를 `main`으로
   승격합니다. 작업 브랜치에서 `main`으로 직접 승격하지 않습니다.
8. Production CI/CD, health, smoke, provenance를 확인한 뒤 `Production 배포 완료`로 보고합니다.
9. Production 검증 뒤 `pnpm branches:audit`을 실행하고, 별도 승인된 `삭제 가능` 브랜치만 정리한 뒤
   다시 감사합니다. `보존 필요`와 `애매함`은 자동 삭제하지 않습니다.

## 작업 종료 및 미커밋 변경 관리

- 계획·검토·진단·보고 요청은 사용자가 변경도 함께 요청하지 않은 한 파일을 수정하거나 새 worktree를
  만들지 않습니다.
- 작업 종료 전 `git status --porcelain`과 `git diff`로 현재 작업에서 발생한 변경을 확인합니다.
- 미커밋 변경이 있으면 다음 중 하나가 결정될 때까지 작업을 완료로 보고하지 않습니다.
  1. 필요한 변경은 검증하고, 현재 요청에서 커밋 권한이 확인된 경우에만 작업 브랜치에 커밋합니다.
  2. 불필요한 변경은 정확한 대상에 대한 사용자 승인을 받은 뒤에만 폐기합니다.
  3. 아직 커밋하거나 폐기할 수 없는 변경은 경로, 보존 이유와 다음 행동을 명시해 보존합니다.
- 작업 트리를 깨끗하게 만들기 위한 목적만으로 사용자 소유 변경을 임의로 commit, reset, stash, clean,
  rebase하거나 덮어쓰지 않습니다.

긴급 hotfix도 Staging-first가 원칙입니다. Staging 생략은 사용자가 위험을 인지하고 현재 릴리스에
대해 명시적으로 승인한 경우에만 허용하며, 직후 Staging 동기화와 회귀 검증을 남깁니다.

이 파일과 `docs/STAGING.md`가 배포 절차의 추적 가능한 단일 진실 공급원입니다.
