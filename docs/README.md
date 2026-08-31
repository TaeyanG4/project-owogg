# OwOGG 문서 안내

상태: 가이드

마지막 검증: 2026-08-30

이 인덱스는 문서를 독자의 목적과 문서 역할에 따라 안내합니다. 구현 사실은 현재 코드,
마이그레이션, 워크플로 순으로 확인하며 문서와 구현이 다르면 구현이 우선합니다.

문서 역할은 다음과 같습니다.

- **기준 문서**: 현재 구현의 경계와 불변식을 설명합니다.
- **가이드**: 현재 구현을 사용하는 절차를 설명합니다.
- **제안**: 구현되지 않았거나 선택되지 않은 미래 설계입니다.
- **기록**: 특정 시점의 조사/의사결정 기록이며 현재 사실의 권한 원천이 아닙니다.

## 시작하기

- [Repository README](../README.md) — 프로젝트 개요, 구조, 주요 명령

## 시스템 아키텍처

- [시스템 아키텍처](ARCHITECTURE.md) — **기준 문서**, 앱/패키지/인프라 경계
- [Game Platform 아키텍처](GAME_PLATFORM_ARCHITECTURE.md) — **기준 문서**, 공통 게임
  identity, publication, runtime, score
- [데이터베이스](DATABASE.md) — **기준 문서**, D1 migration 및 데이터 경계
- [D1 ERD](ERD.md) — **기준 문서**, 도메인별 관계도와 전체 물리 테이블·호환 뷰 사전
- [인가 모델](AUTHORIZATION.md) — **기준 문서**, identity, staff, entitlement, permission,
  publisher authority

## 게임 개발 및 업로드

- [게임 제작 가이드](GAME_CREATION_GUIDE.md) — **가이드**, OWOGG source와 USER bundle 흐름
- [게임 업로드 가이드](GAME_UPLOAD_GUIDE.md) — **가이드**, Game Creator Center 업로드 절차
- [Ball Dodge 예제](../examples/ball-dodge/README.md) — **가이드**, 예제 상태는 문서 내부의 주의사항 확인
- [Relay Protocol Probe 내부 테스터](../examples/relay-protocol-probe/README.md) — **가이드**, 게임별 서버
  driver 없이 2~8인 Relay SDK를 사용하는 업로드 fixture
- [게임 라인업](GAME_LINEUP.md) — **제안**, 후보 게임 기획
- [Generic Multiplayer Relay 전환 계획](MULTIPLAYER_RELAY_PLAN.md) — **구현 중인 기준 계획**,
  공용 WebSocket Relay, 보안 기준선, driver/template 제거와 단계별 Gate

## Discord

- [Discord 연동](DISCORD_INTEGRATION.md) — **기준 문서/가이드**, HTTP Interactions와 길드 연동
- [Discord 봇 가이드](DISCORD_BOT_GUIDE.md) — **가이드**, 명령과 설정

## 스트리머

- [스트리머 시스템](STREAMER_SYSTEM.md) — **단일 기준 문서/가이드**, 채널 소유권 검증과 플랫폼별 수동 심사·관리

`Streamer System`의 스트리머/채널 인증과 `Authorization`의 GAME_CREATOR 업로드 자격은 서로 다른
프로그램입니다.

## 국제화

- [국제화](I18N.md) — **가이드**, UI locale 구조
- [i18n 콘텐츠 작업 흐름](i18n-content/README.md) — **가이드**, 콘텐츠 번역 작업
- [i18n 콘텐츠 가이드](i18n-content/GUIDE.md) — **가이드**, 번역 규칙
- [i18n 콘텐츠 상태](i18n-content/STATUS.md) — **기록**, 현재 번역 상태 기록

## 유지보수

- [브랜치 감사 및 정리](BRANCH_MANAGEMENT.md) — **가이드**, local/remote 브랜치 자동 조사,
  3단계 분류 및 안전한 정리 절차
- [Cleanup Status](maintenance/CLEANUP_STATUS.md) — **기준 문서**, F-0~F-5 정리 결과와 현재
  compatibility/defer 상태
- [Legacy Ledger](maintenance/LEGACY_LEDGER.md) — **기록**, F-0 시점의 저장소/legacy 판정 기록

현재 정리 상태는 `Cleanup Status`를 기준으로 확인합니다. Historical ledger의 `DELETE`,
`MIGRATE_THEN_DELETE`, `KEEP_REQUIRED`, `KEEP_PLANNED`, `DEFER_UNKNOWN` 판정은 후속 작업의
입력이었던 F-0 기록이며, 현재 삭제 권한이나 현재 상태를 뜻하지 않습니다.

## 운영 문서 공백

과거 문서가 가리키던 Admin 설정, OAuth 설정, 계정 연결 runbook은 현재 저장소에 실재하지
않습니다. F-1은 빈 placeholder를 만들지 않습니다. 현재 구현 경계는
[Authorization](AUTHORIZATION.md)과 관련 코드에서 확인하고, 실제 운영 runbook은 별도 운영 문서
단계에서 작성해야 합니다.
