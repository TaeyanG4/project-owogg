# OwOGG Game Platform 아키텍처

상태: 기준 문서

마지막 검증: 2026-08-24

기준 소스:

- `packages/core/src/modules/game/`
- `packages/core/src/application/gamePublicationService.ts`
- `packages/core/src/application/officialGameUploadUseCases.ts`
- `packages/db/src/d1/D1OfficialGameUploadRepository.ts`
- `apps/api/src/routes/games.ts`
- `apps/api/src/routes/gameServing.ts`
- `apps/web/app/features/game/GameHost.tsx`
- `packages/db/migrations/0029_unified_game_identity.sql`
- `packages/db/migrations/0031_game_version_write_convergence.sql`
- `packages/db/migrations/0032_generic_score_acceptance.sql`
- `packages/db/migrations/0033_generic_game_assets.sql`
- `packages/db/migrations/0034_unified_game_control_plane.sql`
- `packages/db/migrations/0035_creator_manifest_results.sql`

이 문서는 현재 production의 게임 identity, publication, runtime, score 경계를 설명합니다. USER와
OWOGG는 같은 runtime/storage 모델을 사용하지만 authorization과 publication control plane은 서로
다릅니다.

```text
OwOGG Game Platform
├─ D1
│  ├─ GameIdentity (games)
│  ├─ GameVersion (game_versions)
│  ├─ GameAsset (game_assets)
│  └─ settings / visibility / live-version state
├─ B2
│  ├─ GameCanonicalDocument: game-definitions/<slug>/definition.json
│  └─ immutable bundle: games/<gameId>/<versionId>/...
├─ GamePublicationService
│  └─ PUBLISHING → files → manifest last → READY
├─ RuntimeGameRegistry
├─ /play/:slug → /games/<gameId>/<versionId>/index.html
├─ GameHost → IframeRuntime → Bridge → game code
└─ signed, one-use Game Session → manifest 기반 generic result acceptance
```

## 공통 플랫폼

- `games`는 숫자 identity, 서버가 관리하는 소유 관계, visibility, 삭제 상태, 현재 live-version pointer와
  USER control-plane 상태를 소유합니다.
- `game_versions`는 provider-neutral bundle identity와 publication 사실을 소유합니다. publication
  target은 불변 tuple `(gameId, versionId, contentHash)`입니다.
- `game_assets`는 provider-neutral 게임 단위 asset metadata를 소유합니다. Bundle bytes는 B2에서
  불변이며 version 범위로 유지됩니다.
- `GameCanonicalDocument` v3는 root `owogg.json` Game Creator Manifest v1의 실행 계약과 title,
  description, policy, presentation, difficulty, catalog, public `publisher.official` 표시 메타데이터를
  소유합니다. 소유권/인가, live-version 상태, 환경 URL, secret은 소유하지 않습니다. USER 경로는
  항상 `official: false`, 인증·인가된 관리자 업로드만 `official: true`를 기록합니다.
- `GamePublicationService`는 유일한 file/manifest publication loop입니다. manifest를 마지막에 쓰고,
  검증한 동일 publication target에만 READY를 표시합니다.
- `RuntimeGameRegistry`, `GameHost`, `IframeRuntime`, `window.OWOGG` Bridge, signed Game Session,
  generic result acceptance는 publisher-neutral production 경로입니다. 결과 원장은 score가 없는
  outcome/progression/metrics 완료도 저장하고, leaderboard가 선언된 유효 score만 `scores` projection을
  생성합니다.

## USER 제어 영역

USER workflow의 identity/control metadata/review slot 권한 원천은 `games`, 심사 상태 권한 원천은
`game_versions`, logo 권한 원천은 `game_assets`입니다. review queue, approval/reject/revoke, audit trail,
Game Creator entitlement는 계속 유지합니다. `sandbox_games`, `sandbox_game_versions` 이름의 물리 테이블은
이전 Worker revision을 위한 임시 배포 호환 미러일 뿐 별도 게임 모델이 아닙니다. READY는 APPROVED가
아니며 READY가 아닌 version은 승인할 수 없습니다.

`0034`는 expand/switch 단계입니다. 호환 미러 drop은 이 tree가 Staging에서 Game Creator 전체 smoke를
통과한 뒤 다음 contract migration으로만 수행합니다. D1 migration이 Worker보다 먼저 적용되므로 같은
배포에서 expand와 drop을 함께 수행하지 않습니다.
실패한 publication은 동일한 숫자 version과 source archive로 다시 시도합니다.

## OWOGG 관리자 게시 제어 영역

OWOGG publication authority는 Admin Center입니다. 관리자 ZIP 업로드가 generic D1 identity/version과
B2 canonical/bundle을 만들고 READY version을 live로 활성화합니다. 같은 content hash의 READY version은
재사용하며 archive는 OWOGG authority를 스스로 선언할 수 없습니다. Git deploy는 게임 bytes를 만들거나
live pointer를 변경하지 않으므로 관리자 게시 결과가 다음 코드 배포에 되돌아가지 않습니다.

Git 기반 game registry와 생성 metadata는 제거되었습니다. public catalog, serving, result acceptance,
official badge와 publisher name은 모두 환경별 D1/B2에서 해석합니다.

## 알려진 확장성 부채

다음은 현재 아키텍처의 correctness blocker가 아니라 후속 performance 주제입니다.

- public list/detail 조합에는 여러 B2 canonical read가 필요할 수 있습니다(N+1 동작).
- 불변 canonical과 manifest read는 범위가 제한된 edge/application caching 후보입니다.
- public-list 조합 비용은 catalog 크기에 따라 증가하므로, 장기적으로 batching이나 materialized read
  model을 사용해야 합니다.
- 반복되는 availability 조합은 짧은 수명의 cache 결과를 공유할 수 있지만 D1 kill-switch와
  live-version correctness는 계속 primary-authority read여야 합니다.

모든 최적화는 잘못된 canonical/manifest를 fail-closed로 처리하는 동작을 보존해야 합니다. score
acceptance, signed-session consumption, kill-switch mutation, 현재 live-version enforcement를 stale
replica로 옮겨서는 안 됩니다.
