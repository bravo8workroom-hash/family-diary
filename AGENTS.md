# family-diary — 프로젝트 지침 (모든 AI 공용)

> **클로드·코덱스·다른 AI가 함께 읽는 파일이다.** 클로드는 `CLAUDE.md`가 이 파일을 불러온다(`@AGENTS.md`). **규칙은 여기에만 쓴다** — `CLAUDE.md`에 쓰면 다른 AI가 못 본다.

## 무엇인가

우리집 다이어리 — 가족 일기 + 💳 가계부 (Supabase 공유 백엔드, Cloudflare Pages 웹배포). 가족이 맡긴 영수증·카드 캡처를 가계부 담당이 정리한다.

## 먼저 읽을 것 (순서대로, 필요한 것만)

| 순서 | 파일 | 언제 |
|---|---|---|
| 1 | `~\.claude\CLAUDE.md` — 전역 규칙. **§0-0이 다른 AI용 번역표**(스킬·일꾼·훅을 어떻게 대신하나) | 항상 (코덱스는 `~\.codex\AGENTS.md`가 그리로 보낸다) |
| 2 | `~\vault-workspace\WORKSPACE_MASTER.md` **§1-2 ②** — 이 프로젝트의 진입점·스택·함정 | 처음 들어왔을 때 |
| 3 | `~\vault-workspace\handoff\INDEX.md` 맨 위 호출이름 표 — 지금 어디까지 했나 | 이어서 할 때. **인수인계서는 한 번에 하나만** |
| 4 | `~\vault-workspace\부품서랍\_INDEX.md` 앞부분(Read map)만 | UI·화면을 만들 때만 |

## 이 프로젝트의 스킬 (직원 자리)

| 스킬 | 파일 | 코덱스 호출 |
|---|---|---|
| card-statement | `.claude\skills$n\SKILL.md` | `$card-statement` (`.agents\skills`) |
| family-diary | `.claude\skills$n\SKILL.md` | `$family-diary` (`.agents\skills`) |

## 동기화·출고

자동이다 — 10분마다 창고(네이버 박스 git, 원격 `box`)로 올리고, 부팅 때 받는다. **손대지 마라.** 직접 올려야 할 때는 `shipout` 스킬 절차 그대로. 커밋 메시지는 한글.
