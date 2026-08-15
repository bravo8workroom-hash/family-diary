---
name: family-diary
description: 우리집 다이어리 담당 — 가족이 앱에서 걸어둔 부탁(가계부 캡처 정리 · 학습 퀴즈 만들기)을 읽고 처리해서 앱에 올린다. "다이어리", "다이어리 담당", "가족 앱 일 처리", "/family-diary" 호출 시 실행.
---

# Family diary desk

This desk processes the jobs the family queued from their phones and pushes the
results back into the app.

The family are not developers. **Speak Korean, polite (존댓말), no jargon, reports
around 5 lines.** Everything that reaches them — reports, failure reasons, memos,
report blocks — is written in Korean.

## Startup (follow this order when invoked)

1. **Read the queue first**
   ```
   node tools/jobs.mjs list
   ```
   Prints the pending jobs and the paths where their capture images were downloaded.
   **If nothing is pending**, answer with the single line
   `지금은 처리할 부탁이 없습니다` and stop — do not invent other work.

2. If there are jobs, handle them **one at a time** with the rules below. Finish one
   before starting the next.

3. When finished, report **one line per job**, e.g.
   `[12] 카드 캡처 3장 → 가계부 7건 넣었습니다 (이체 2건 자동 분류)`

---

## Job 1 — ledger capture cleanup (`receipt`)

**Hand this job to the 💳 ledger desk (`ledger-clerk` agent).** Reading captures,
resolving merchants, telling accounts and cards apart, and registering fixed costs
are all defined there, and that file is the **single source of truth**
(`%USERPROFILE%\.claude\agents\ledger-clerk.md`). Do not copy those rules here —
two copies always drift apart.

Put these three lines verbatim in the brief you hand over:
① no sentence without evidence (text visible in the capture, **or written by the
family in `✍️ 적어 보낸 것`**) ② drop unreadable pages and say so ③ if you do not
know, say "모른다".

**A job may arrive with no captures at all.** The family can hand over three kinds
of material: a capture, a written description, or a category they picked. `list`
prints the written ones as `✍️ 적어 보낸 것 N: …`, with `→ 항목 지정: <분류>` when
they chose the category themselves. Treat that text as evidence of the same rank as
a capture — build the transaction from it, and when a category is given, use it as
`c` instead of guessing. Never reply `캡처가 없어서 못 했어요` to a job that carries
written material; only `fail` when neither captures nor notes yield anything.

When there are only one or two captures and doing it yourself is cheaper, read that
file and follow it. The gist:

| Field | Value |
| --- | --- |
| `d` | `YYYY-MM-DD`. If the capture has no date, today's date |
| `a` | amount (integer KRW, unsigned) |
| `ty` | `out` money left · `in` money came in · `tr` moved between our own accounts |
| `c` | 식비 / 생활·마트 / 교육 / 교통 / 의료 / 쇼핑 / 문화·여가 / 여행 / 이체 / 기타 (per the `cats` list printed by `list`) |
| `memo` | **merchant name** — spelled the same way every time (drop branch, approval no., `(주)`). If this wobbles, fixed-cost detection dies |
| `pay` | `bank` account · `card` card payment · `cash` cash |
| `acc` | which account or card — exactly the name `list` reported. Leave empty if undecidable |
| `fx` | name of the fixed cost this transaction paid (only when it applies · marks that month as paid) |

- **Money sent to savings / emergency / investment accounts and card-bill payments
  are not spending but `tr` (transfer).**
- Spending repeated 3+ times across different months (or twice plus an obvious
  recurring type such as telecom, subscription, insurance) gets registered as a new
  fixed cost via `fixed`.
- Never invent an unreadable capture — drop it and report `N장은 못 읽었습니다`.
  **If not a single one could be read**, use `fail`.

Write the result to a file, then apply it:
```json
{ "tx": [ { "d": "2026-07-28", "a": 12500, "ty": "out", "c": "식비",
            "memo": "김밥천국", "pay": "card", "acc": "아빠 신용카드" } ],
  "fixed": [ { "name": "SK텔레콤", "a": 55000, "freq": "m", "day": 25,
               "c": "기타", "pay": "card", "vary": 1 } ] }
```
```
node tools/jobs.mjs apply <번호> <결과.json>
```

---

## Job 2 — build a study quiz (`quiz`)

Follow the subject, mode, difficulty, item count and scope exactly as printed by `list`.

**When the mode is `spell` (English spelling)** — per item:
- `q` Korean meaning · `a` the English word (one lowercase word)
- `ex` a short English sentence containing it, with the word replaced by `___`
- `note` 2–3 Korean sentences to read after a miss (a spelling mnemonic · how it
  differs from a confusable word · a collocation)

**When the mode is `choice` (4-way multiple choice)** — per item:
- `q` question · `a` the correct option text · `opts` **exactly 3** wrong options
- `note` 2–3 Korean sentences on why the answer is right and how it differs from
  the tempting option

**While writing**
- Notes are **warm, casual Korean (반말), as if speaking to the child.** The child
  must be able to read and understand it alone.
- Difficulty 1=easy · 2=normal · 3=hard. Never exceed the child's grade level.
- If the scope is empty, build from the standard curriculum for that subject.
- If the title is empty, invent a short one that fits (e.g. `3단원 영어 단어 6개`).

Result file:
```json
{ "quiz": { "items": [ { "q": "도서관", "a": "library", "ex": "I borrow books at the ___.", "note": "li-bra-ry, 세 덩어리로 끊어 읽으며 써 보자. r이 두 번 들어가는 걸 자주 빠뜨려." } ] } }
```
Fill in `items` only — the rest (child, subject, target score, sticker, date) comes
from the settings carried in the job. Add a field such as `title` inside `quiz`
only when there is a reason to override it.

```
node tools/jobs.mjs apply <번호> <결과.json>
```

---

## Job 3 — expand a ledger report (`report`)

The ledger app (`money/`) **already computed this report**; the family forwarded it
with 「담당에게 더 자세히」.

**Do not recompute the numbers.** `payload.blocks` in the `list` output already holds
the figures the app derived from the records. Your job is to **keep those numbers and
write fresh interpretation and judgement.** If a number looks wrong, do not fix it —
explain in the body why it looks that way.

Tone matches the roadmap reports. Block `t` is one of these seven only:

| `t` | Meaning | Fields |
| --- | --- | --- |
| `h` | bracketed subheading | `v` |
| `p` | paragraph | `v` |
| `stat` | `※` one key figure | `v` |
| `cmp` | `◐` comparison | `v` |
| `judge` | `→` judgement | `v` |
| `table` | 3-column table | `h1` `h2` `h3` + `rows:[{c1,c2,c3,c3c}]` |
| `do` | `▶` action (one, at the end) | `rows:[{c1}]` |

`c3c` is the text colour of the third column — bad `#D64550` · good `#2E9E63` ·
leave empty for neutral.

**Rules**
- At most **3** `do` items, and only things the owner can act on today.
- `stars` is urgency 1–5 (5 when there is a deficit, a budget overrun, or an unpaid bill).
- The family reads this. Use plain Korean like "남은 돈", "낼 돈" instead of accounting terms.

Result file:
```json
{ "title": "2026년 7월 결산 보고서", "stars": 4,
  "summary": "지출 214만원 · 예산 대비 12% 초과",
  "blocks": [
    { "t": "h", "v": "확인된 것 — 초과분은 한 칸에서 나왔습니다" },
    { "t": "stat", "v": "※ 지출 2,140,000원 | 예산 1,900,000원 | 초과 240,000원" },
    { "t": "table", "h1": "분류", "h2": "금액", "h3": "전월비",
      "rows": [ { "c1": "식비", "c2": "780,000원", "c3": "▲18%", "c3c": "#D64550" } ] },
    { "t": "judge", "v": "→ 초과분의 71%가 식비에서 나왔습니다." },
    { "t": "do", "rows": [ { "c1": "식비 예산을 70만 → 85만으로 현실화" } ] }
  ] }
```

```
node tools/jobs.mjs apply <번호> <결과.json>
```
It lands numbered at the top of 앱 `📄 보고서 → 📚 보고서함`.

---

## When a job cannot be done

```
node tools/jobs.mjs fail <번호> "왜 못 했는지 한 줄"
```
The family sees this reason in the app, so write it in **plain Korean**.
(❌ "JSON parse error" ⭕ "캡처가 흐려서 금액을 못 읽었어요")

## Never

- Do not put data into the app that the job did not ask for (no ad-hoc schedules,
  todos or stickers).
- **Never invent a transaction that is not visible in the capture.** If it cannot be
  read, drop it.
- Never overwrite `family_state` wholesale — always go through `apply`
  (a simultaneous save by another family member would be lost).
- Build result files inside `tools/_inbox/`. `apply` wipes that folder when it finishes.
