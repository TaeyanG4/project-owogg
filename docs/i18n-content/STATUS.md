# 위키/사이트 번역 진행 현황 (STATUS — 계속 갱신되는 문서)

**경로**: `docs/i18n-content/STATUS.md`

이 문서는 **지금 시점에 뭐가 끝났고 뭐가 남았는지**만 담습니다. 규칙/절차(번역 지침, 도구 사용법
등 안 변하는 내용)는 **[`GUIDE.md`](./GUIDE.md)를 보세요**. 파일이 새로 번역되거나 코드에
연결될 때마다 이 문서만 갱신합니다.

_최근 갱신: 2026-09-01 — Streamer 사용자 UI와 다국어 문구의 플랫폼 범위를
YouTube·CHZZK·Twitch로 통일했습니다. 보류 provider는 공개 설정·랭킹·Wiki에 노출하지 않습니다._

## 파일 목록

| 파일                                                 | 상태                                           | 내용                                                                                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `translated-streamer.json`                           | ✅ 번역 완료, 코드 연결됨                      | Streamer 개요/인증 2페이지, 플랫폼별 수동 심사 기준, 4개 언어 전체                                                                                       |
| `translated-account-games.json`                      | ✅ 번역 완료, 코드 연결됨                      | Account/AccountMerge/Games/GamesRanking/GamesXp/GettingStarted 6페이지, 4개 언어 전체                                                                    |
| `01-wiki-discord.json` + `.en-US`/`.ja-JP`/`.zh-CN`  | ✅ 번역 완료, 코드 연결됨                      | 위키 Discord 섹션 7페이지(Overview/Install/AccountLink/ServerRegistration/Commands/Xp/Troubleshooting), 4개 언어 전체                                    |
| `03-terms-privacy.json` + `.en-US`/`.ja-JP`/`.zh-CN` | ✅ 번역 완료, 코드 연결됨 (`dict.legal`)       | 이용약관·개인정보처리방침 전문. `/terms`, `/privacy` 라우트가 `dict.legal.terms`/`dict.legal.privacy`를 사용.                                            |
| `02-game-content.json` + `.en-US`/`.ja-JP`/`.zh-CN`  | ✅ 번역 완료, 코드 연결됨 (`dict.gameContent`) | `categories`/`wikiHomePolicyCard`는 이전 세션에 연결. `games`(게임 4종 title/shortDescription/description/tags)도 이번에 `dict.gameContent`로 연결 완료. |

**✅ 완료 파일의 구조**는 `{ "ko-KR": {...}, "en-US": {...}, "ja-JP": {...}, "zh-CN": {...} }`처럼
언어가 최상위 키입니다 — `dictionary.ts`의 실제 섹션을 그대로 뽑아온 것이라, 배포된 문구와 100%
동일합니다.

`01-wiki-discord.json`, `03-terms-privacy.json`, `02-game-content.json`은 원래 대기 파일이었지만
이제 코드 연결까지 완료됐습니다 — 원본 소스 위치를 계속 남겨두기 위해 파일 자체는 옮기지 않았고,
위 표의 상태만 갱신했습니다.

## 게임 카탈로그 콘텐츠는 `GameManifest`가 아니라 별도 오버레이로 연결했습니다

`GameManifest.title`/`shortDescription`/`description`/`tags`(4개 게임 패키지의 `manifest.ts`)는
**한국어 그대로 남아있습니다** — 이 타입은 `apps/api`(Discord 봇 임베드, 점수 검증)와 공유되는데,
API 쪽에는 웹의 i18n 사전이 없기 때문입니다. 대신 `apps/web/app/features/i18n/dictionary.ts`에
`gameContent`(게임 slug로 키를 삼는 로케일별 표시 텍스트)를 새로 추가하고,
`apps/web/app/features/catalog/localizedGameContent.ts`의 `getLocalizedGameContent()`가 이걸
manifest 위에 오버레이합니다(항목이 없으면 manifest의 한국어 텍스트로 자동 폴백). `GameCard`,
`games.tsx`(검색 매칭 포함), `ranking.tsx`, `profile.tsx`, `game-slug.tsx`(플레이 화면 헤더)가
이 헬퍼를 사용합니다. `description`/`tags`는 사전에는 들어있지만 아직 화면에 렌더링하는 곳이
없어(현재 UI가 노출 안 함) 실제 화면 변화는 title/shortDescription뿐입니다.

## 위키 본문 다국어화 진행률

**16/16페이지 완료** (Getting Started 1 + Account 2 + Games 4 + Streamer 2 + Discord 7). 위키 본문
다국어화(Task #7)는 완료되었습니다.

## 최신화(드리프트) 상태

✅ 완료된 위키 본문 16페이지는 `pnpm i18n:sync-check`로 자동 감시됩니다 — 한국어 원문이 스냅샷과
달라지면 경고가 뜹니다. 실행 방법/해석 방법은 `GUIDE.md`의 "최신화 상태 확인" 섹션 참고.

- 마지막 스냅샷 갱신 시점 기준(2026-09-01): Streamer OAuth 지원/보류 상태를 포함한 위키 본문 309개
  키 일치 확인.
- `dict.legal`, `dict.gameContent`, `dict.wiki.catPolicy*`는 아직 이
  자동 감시 대상에 포함되지 않았습니다(스냅샷 도구는 현재 `wikiBody`만 봄) — 범위를 넓히는 건
  별도 작업으로 남김.

## 남은 다국어 하드코딩

- `game-slug.tsx`(실제 게임 플레이 화면) 전체가 이번에 `dict.gamePlay`로 연결 완료(헤더/로딩/에러/
  로그인 게이트/결과 오버레이/메타데이터 라벨 전부). 현재까지 확인된 하드코딩 잔여분 없음.
