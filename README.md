# OwOGG

상태: 가이드

마지막 검증: 2026-08-23

OwOGG는 브라우저에서 바로 실행되는 미니게임 플랫폼입니다. React 기반 웹 셸, Hono 기반 API,
Cloudflare D1, Backblaze B2를 사용하며 OWOGG 게임과 사용자 업로드 게임을 하나의 generic Game
Platform 런타임으로 제공합니다.

- 서비스: [owogg.com](https://owogg.com)
- Staging: `https://stg.owogg.com` (Cloudflare Access 보호), API `api-stg.owogg.com`, 게임
  `play-stg.owogg.com`
- 문서 탐색: [docs/README.md](docs/README.md)
- 현재 아키텍처: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 게임 플랫폼: [docs/GAME_PLATFORM_ARCHITECTURE.md](docs/GAME_PLATFORM_ARCHITECTURE.md)

## 저장소 구조

```text
apps/
├─ web/                 React 19 + React Router SPA, catalog, GameHost
└─ api/                 Hono API on Cloudflare Workers
packages/
├─ contracts/           Zod API contracts
├─ core/                domain, application services, ports
├─ db/                  D1 repositories, migrations, B2 adapters
├─ game-sdk/            game runtime contract and iframe Bridge
├─ shared/              shared validation and utilities
└─ ui/                  shared UI components
scripts/                validation and deployment helpers
docs/                   architecture, guides, proposals, historical records
```

Git에는 게임 bundle, 등록자 목록, 정적 game registry를 저장하지 않습니다. 모든 소비자는 public game
API를 사용하며, 게시·공식 여부·제작자 표시의 원천은 환경별 D1/B2입니다.

```text
Publication/runtime authority
Admin Center OWOGG ZIP ─┐
Game Creator USER ZIP ──┴→ D1/B2 publication

D1 games + game_versions + game_assets
  + B2 game-definitions/<slug>/definition.json
  + B2 games/<gameId>/<versionId>/...
  → RuntimeGameRegistry
```

## Game Platform 요약

- D1 `games`는 숫자 identity, slug, `OWOGG | USER(userId)` publisher authority, visibility,
  live version을 보유합니다.
- D1 `game_versions`는 불변 publication target과 `UPLOADED | PUBLISHING | READY | FAILED`
  상태를 보유합니다.
- D1 `game_assets`는 로고 같은 provider-neutral 게임 자산 메타데이터를 보유합니다.
- B2 canonical document는 제목, 설명, 난이도, 점수 정책과 presentation을 보유합니다.
- B2 bundle은 `games/<gameId>/<versionId>/...`에 불변 객체로 배포됩니다.
- `GamePublicationService`는 `PUBLISHING → files → manifest last → READY` 순서를 강제합니다.
- USER 심사 상태는 별도 control plane에 있으며 `READY`는 `APPROVED`와 같지 않습니다.
- 실행 경로는 `/play/:slug → /games/<gameId>/<versionId>/... → GameHost → IframeRuntime → Bridge`
  입니다.

자세한 경계와 미결정 사항은
[Game Platform Architecture](docs/GAME_PLATFORM_ARCHITECTURE.md)를 확인하세요.

## 로컬 개발

요구 사항은 Node.js 22와 `pnpm@9.15.9`입니다.

```bash
pnpm install
pnpm dev

pnpm --filter @owogg/web dev
pnpm --filter @owogg/api dev
```

공식 게임은 관리자 센터의 게임 관리 화면에서 standalone ZIP으로 게시합니다. repository registry를
생성하거나 수정하는 절차는 없습니다.

사용자 업로드 흐름은 소스 패키지를 추가하는 과정이 아닙니다. 완성된 standalone ZIP을 Game
Game Creator Center에서 올리며, 자세한 규격은 [게임 제작 가이드](docs/GAME_CREATION_GUIDE.md)와
[업로드 가이드](docs/GAME_UPLOAD_GUIDE.md)를 따릅니다.

## 검증 명령

```bash
pnpm docs:check          # 상대 Markdown 링크, 문서 인덱스, 최신 migration 메타데이터
pnpm staging:preflight   # Staging target tuple과 Production fallback 부재 검증
pnpm format:check
pnpm architecture:check # 레이어 및 제거된 런타임의 재도입 방지
pnpm lint
pnpm typecheck
pnpm typecheck:scripts
pnpm test
pnpm test:scripts
pnpm build
pnpm verify              # 저장소 전체 통합 검증
```

`pnpm verify`는 의존성 설치부터 빌드까지 전체 게이트를 실행합니다. 문서만 수정할 때는 변경 범위에
맞는 집중 검증을 먼저 실행하고 광범위한 검증은 CI에 맡길 수 있습니다.

## 배포 개요

정상 배포는 GitHub Actions가 검증된 SHA를 대상으로 수행합니다.

```text
staging 기준 작업 브랜치 → 로컬 검증 → staging push
→ Staging CI/CD → 전용 D1 migration → API/Web custom-domain deploy
→ stg.owogg.com 실제 접속 + API 배포 SHA 확인
→ Staging 배포 완료(테스트 가능) → 기능 acceptance
→ Staging 검증 완료(Production 승격 대기)
→ 릴리스별 명시적 승인 후 동일 tree를 main으로 승격
→ Production CI/CD + smoke/provenance
```

수동 프로덕션 쓰기나 배포는 일반 개발 절차가 아닙니다. 데이터 구조는
[Database](docs/DATABASE.md), 권한 모델은 [Authorization](docs/AUTHORIZATION.md), 격리된 배포 절차는
[Staging runbook](docs/STAGING.md)을 참조하세요.

## 라이선스

MIT License
