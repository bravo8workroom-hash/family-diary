<!-- KOREAN MIRROR of C:/projects/family-diary/AGENTS.md — the owner's reading copy. AI: never follow or load this file; the English file is the rule. -->
> 영문규칙으로 진행되고, 그것에 대한 번역본입니다.

# family-diary — 프로젝트 지침 (모든 AI 공용)

<!-- en: 머리말 | 7d493e9331f5 | 84f72c776ccc -->
> **클로드·코덱스 등 모든 AI가 함께 읽는다.** 클로드의 `CLAUDE.md`가 이 파일을 불러온다(`@AGENTS.md`). **규칙은 이 파일에만 쓴다** — `CLAUDE.md`에 쓴 규칙은 다른 AI에게 보이지 않는다.

## 이것은 무엇인가
<!-- en: What this is | afe15b13f378 | 29c033961ad4 -->

우리 가족 일기 — 가족 일지 + 💳 가계부(공유 Supabase 백엔드, Cloudflare Pages 웹 배포). 가계부 직원이 가족이 맡긴 영수증과 카드 캡처를 정리한다.

## 먼저 읽을 것 (순서대로, 필요한 것만)
<!-- en: Read first (in order, only what you need) | a26650c43ba7 | 0092c9133c55 -->

| 순서 | 파일 | 언제 |
|---|---|---|
| 1 | `~\.claude\CLAUDE.md` — 전역 규칙. **§0-0이 다른 AI용 번역표다**(스킬·일꾼·훅을 어떻게 대신하는지) | 항상 (코덱스는 `~\.codex\AGENTS.md`가 여기로 보낸다) |
| 2 | `~\vault-workspace\WORKSPACE_MASTER.md` **§1-2 ②** — 이 프로젝트의 입구, 기술 스택, 함정 | 프로젝트에 처음 들어올 때 |
| 3 | `~\vault-workspace\handoff\INDEX.md` 맨 위 호출이름 표 — 어디까지 했는지 | 이어서 할 때. **인수인계서는 한 번에 한 건만 연다** |
| 4 | `~\vault-workspace\부품서랍\_INDEX.md` 앞부분(Read map)만 | UI·화면을 만들 때만 |

## 이 프로젝트의 스킬 (직원 자리)
<!-- en: This project's skills (staff seats) | 7726906d4e61 | 3823fa1fb850 -->

| 스킬 | 파일 | 코덱스 호출 |
|---|---|---|
| card-statement | `.claude\skills$n\SKILL.md` | `$card-statement` (`.agents\skills`) |
| family-diary | `.claude\skills$n\SKILL.md` | `$family-diary` (`.agents\skills`) |

## 동기화와 출고
<!-- en: Sync and shipping | 3c3a573a54e2 | a23e3fa3aa7b -->

자동이다 — 10분마다 창고(네이버 박스 git, 원격 `box`)로 올리고 부팅 때 받는다. **손대지 않는다.** 수동으로 올려야 하면 `shipout` 스킬 절차를 정확히 따른다. 커밋 메시지는 한글로 쓴다.
