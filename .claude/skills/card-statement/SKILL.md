---
name: card-statement
description: 카드 이용대금명세서·통장 입출금 캡처(은행 문자 알림 / 은행 앱 거래내역)를 돈이 틀리지 않게 읽어내는 기술 — 버튼에 가려진 숫자 살리기, 카드사 합계·잔액 체인으로 검산하기, 연속 스크롤 캡처의 겹침·빈틈 판단, 할부·취소·선결제·0원 줄 처리, 가계부 대상 밖 계좌 걸러내기. 가계부 캡처를 읽을 때(💳 가계부 담당 `ledger-clerk`), "명세서 정리", "카드 내역 읽어줘", "입출금 캡처", 영수증 캡처에서 금액을 뽑아야 할 때 실행.
---

# Reading card statements

Numbers that enter the ledger **must not be wrong, and must be left blank when unknown.**
What follows was verified on 2026-08-15 against 13 real Shinhan / Lotte card statements.

## ⛔ Source material is destroyed once it is entered (owner's order, 2026-08-15 — no exceptions)

> "내가 가계부에 올리는 모든 자료는 **데이터 업데이트 후 모두 버리도록** 해. 보관하지 마."

**Every raw item** the family handed to the ledger — capture images, transaction files
downloaded from the bank (`.xls`), receipt photos — **is deleted the moment it has been
applied to the app.** Nothing is stockpiled.

| What | When / by whom |
|---|---|
| images downloaded into `tools/_inbox/<번호>/` | `apply` / `done` delete them **automatically** (nothing to do) |
| the family's original uploads (Supabase image storage) | `apply` / `done` delete them **automatically** — ⚠ **irreversible.** See ⛔ below |
| files handed over in a folder by the owner (`Downloads\엑셀\*.xls` etc.) | **I delete them** after confirming the data landed |
| intermediate files made while working (zoomed PNGs, working JSON) | keep them in the scratchpad — **never create them inside the project folder** |

- **Never reverse the order.** Run `node tools/jobs.mjs state`, **see** the counts and
  balances actually land, and only then delete. Delete before entering and nothing can
  bring it back.
- This material carries account numbers, balances and merchant names. **Never copy it
  anywhere that gets committed to git (the project folder).**
- After deleting, **report what was deleted and how many** (§7).

### ⛔ `apply` / `done` erase the photos for good — read everything first

Photos the family left in the app's tray are deleted **from the image storage itself**
the moment `apply` (enter) or `done` (close) runs. That is deliberate: it stops the same
capture being processed twice and inflating spending that never happened.

- You cannot look again, so press it **only after reading everything and finishing the
  reconciliation (§5)**.
- If it cannot be read, do not use `apply` / `done` — leave **`fail <번호> "이유"`**.
  Failed jobs keep their photos.
- The app-side tray empties the moment the job is submitted. Its disappearance from the
  family's screen is not a bug.

### 📷 Labels attached to a photo (`payload.tags`)

A capture the family attached **to a specific transaction from 「고치는 칸」** arrives with
a label. `list` prints it as
`📷 사진 3번 = 8/14 · 롯데하이마트 할부 (36/36) · 26,100원`.

- That photo is **evidence for an existing transaction, not a new one.** Do not create a
  transaction — it would double-count.
- The job is to **fill that row in**: what was bought on an instalment (`installBuys`),
  the subcategory (`sub`), a merchant-name correction.
- Distinct from the 🧾 label (request answer), which answers a "what did you buy" request.

## 0. The order (just do this)

```
1. 캡처를 훑어 「무슨 화면인지」부터 정한다   → §1 (통장이면 §1-1)
2. 겹치는 캡처·같은 사진을 먼저 걸러낸다      → §2
3. 줄을 그대로 옮겨 적는다 (아직 해석 금지)   → §3
4. 가려진 숫자는 확대해서 살린다              → §4
5. 카드사 합계(통장이면 잔액 체인)로 검산한다 ★가장 중요 → §5
6. 그제서야 가계부 규칙으로 옮긴다             → §6
```

**Never skip step 5.** When the total matches, every number on that screen is proven at
once. When it does not match, something is wrong — keep it out of the ledger until it does.

---

## 1. Decide what the screen is, first

| Clue | What it is |
|---|---|
| 「이용대금명세서」 + 소계/청구합계 | **one month's bill.** A total sits at the bottom → reconcilable |
| 「N월 N일 명세서」 + 총 N건 | Lotte (LOCA) bill. **The statement date is the payment date** |
| 「이용내역」 + filters (전체카드/일시불) | a lookup screen. Filters mean **you may be seeing only part of it** |
| `[Web발신]` + account number + 「잔액」 | **bank SMS alert.** This is an account capture → §1-1 ① |
| date heading + per-row time and balance | **bank app transaction list.** An account capture → §1-1 ② |

- **Several cards get mixed together.** When the card marker differs per row
  (「본인0307」 vs 「본인985*」) they are **different cards**. Never lump them into one.
- A visible billing account (「청구합계-○○은행 \*\*\*374」 — **bank plus last digits only**)
  is **the account the card bill is drawn from**. Register it as an account.
- If the card issuer's logo is too blurry to tell, **leave it 「불명」 and move on.** Another
  clue on the screen (an affiliate banner, etc.) usually settles it later.

## 1-1. Account transactions arrive by three routes (added from field work, 2026-08-15)

The family sends more than card statements — **they send account activity too.** There are
exactly three routes.

| Route | What | How |
|---|---|---|
| **① bank SMS alert** | capture of an SMS / RCS thread | ① below — read by eye |
| **② bank app transaction list** | capture of the account detail screen | ② below — read by eye |
| **③ transaction file downloaded from the bank** | `.xls` etc. | no reading needed. Enter directly with `node tools/jobs.mjs import <결과.json>` |

③ is already numerically exact, so §3 and §4 do not apply — but **§1-1 ③ (filtering out
non-ledger accounts) and §5 (the balance chain) apply exactly the same.**
And all three routes **destroy the source material once entered** (⛔ section at the top).

The decisive difference between captures (①②) and a card statement: **there is no
「총 N건·소계」 total.** Instead every row carries a **balance**, and that balance is the
reconciliation tool that replaces the total → §5.

### ① Bank SMS alert (a capture of the SMS / RCS thread)

```
[Web발신]
신한08/14 07:29        ← 은행 + 거래 월·일 시:분   ⚠ 연도가 없다
(계좌번호)             ← 어느 통장인지 가르는 유일한 단서 — ⚠ 실제 번호는 여기 적지 않는다
출금      7,400        ← 출금 / 입금 + 금액
잔액    152,021        ← 이 거래가 끝난 뒤 잔액
현장발권-s             ← 상대처(가맹점·이체 상대)
```

| Trap | What to do |
|---|---|
| **no year** (only `08/14`) | use the year the capture arrived. **The year flips across the Dec↔Jan boundary** — if ambiguous, ask instead of inventing |
| grey text **outside** the bubble (`(어제) 오후 12:33`) | that is when the message was received, not when the transaction happened. Always use the time **inside** the body |
| the top is covered by the back button / contact badge, the bottom by the input bar (`문자 메시지 · RCS`) | **discard** half-visible bubbles and use the row that appears whole in the next capture |
| the counterparty name arrives truncated (`주식회사 버킷?`) | the question mark and symbols may be part of the name, and the app spells it differently (`우아한형제들` ↔ `(주)우아한형제`) → unify the name with the §6 rule |
| **several accounts** are mixed in one thread | read the account-number line **on every single entry**. A balance that suddenly jumps usually means a different account |

### ② Bank app transaction list (account detail screen)

```
7월 29일                       ← 날짜 머리글 — 그 아래 줄 전부에 적용된다
파리바게뜨원주      -6,770원    ← 상대처 / 거래금액 (− 출금, + 입금은 파란색)
21:36:03 · 체크카드     410원   ← 시각 · 거래수단 / 이 거래가 끝난 뒤 잔액
```

| Trap | What to do |
|---|---|
| ★ **the small number at the bottom right is the balance, not the amount** | the large number is the transaction. Swapping them makes the whole ledger wrong. The most common accident on this screen |
| **the account number is not on screen** — scrolling pushes the account name and number off the top | if you do not know which account it is, **do not enter it.** Ask for **one capture of the very top** where the account name is visible |
| the top filter `3개월 · 전체 · 최신순` | check period and sort order first. **Newest-first means the newest is on top**, which reverses the direction of the balance check |
| the floating `↑` button covers amounts near the bottom | recover it by zooming (§4); failing that, **derive it from the balances** (§5) |
| the capture is cut off **above** a date heading | those rows have **no known date**. Ask again for a capture that includes the date heading |
| rows marked `체크카드` | account activity, but the payment method is a card (`pay:"card"`). **They never appear on a credit-card statement**, so there is no risk of double entry |

### ③ Accounts that are not part of the ledger get mixed in

When the family captures a whole SMS inbox or account list, **personal accounts unrelated
to the ledger** are caught in the frame.

> ## ⛔ Account numbers come only from the private repository (owner's order, 2026-08-15)
>
> **This project (`family-diary`) is a public repository.** Anything written here is
> visible on the internet. The only source of truth for account numbers is the
> **「가계부 대상 계좌」 table in `%USERPROFILE%\.claude\agents\ledger-clerk.md`** (private).
>
> - **Open that table and look** when checking. Never judge from memory.
> - **Never copy a number you read into anywhere in this project** — documents, comments,
>   memos, result JSON, commit messages and reports all included. **Not even a masked form
>   that keeps the leading digits** (the leading digits themselves identify bank and branch).
> - In reports to the family, use the **account's name** instead of a number
>   (`신한은행 통합계좌`).
>
> ### Personal-data check before committing / deploying (owner's order, 2026-08-15 — all three)
>
> 1. **On commit and deploy, an account number may show only 「bank + last digits」.**
>    The leading digits identify bank and branch, so they must always be hidden
>    (e.g. `○○은행 ***374`). Worked examples in documents use only this form.
> 2. **Masking is not my call.** When personal data is found somewhere visible, **ask the
>    owner how to hide it and change it only after approval.** Never delete or alter it
>    on my own initiative.
> 3. **Report it regardless.** Awkwardness is not a reason to stay quiet — state
>    **what, in which file and line, and whether it is already public.** Quietly moving on
>    is the worst option.
>
> ⚠ **Fixing a file does not remove it from past commits.** Erasing it completely needs a
> history rewrite, so that decision goes to the owner too.

- Compare every row with a different account number against that table.
- **If it is out of scope, do not read it and do not enter it.** The balance chain (§5) is
  also tracked per account.
- If a number appears that is **not in the table**, do not enter it — ask the family.

## 2. Filter out overlaps and duplicates first

Captures taken while scrolling a statement **overlap top and bottom.** Entering all of them
inflates spending.

- **The same file submitted repeatedly**: `node tools/jobs.mjs list` flags it with
  `⚠ N번과 같은 사진`. Close that job with `done` and **do not enter the transactions twice.**
- **Overlapping rows**: the last row of one capture is often the first row of the next.
  Same merchant, amount and date means **one transaction**.
- **Gaps**: if one capture ends on 23 June and the next starts on 4 July, the middle may be
  missing. If the §5 reconciliation matches, **there were no transactions in the gap**;
  if it does not, **a capture is missing**.
- Truncated rows (half-visible at the very top or bottom) are usually whole in the
  neighbouring capture. If not, leave them blank.
- **Different screen types can still be the same transaction**: one SMS alert and one app
  row can be the same event. Same `account + date + amount` means **one transaction**
  (do not separate by time — the seconds will not agree).

## 3. Transcribe the rows as they are (interpret later)

At this stage do no categorising and no transfer judgements. Write down **only the letters
and digits you can see.**

Per row: `날짜머리글 / 상호명 / 금액 / 종류(일시불·할부N/M·취소·선결제) / 카드표시`

- A date heading applies to **every row beneath it**.
- Lotte (LOCA) carries a separate **year band** such as 「2023년」. The date on an instalment
  row is **the day it was originally bought**, not this month.
- If even one digit of an amount is unreadable, **leave it blank.** Filling it with a
  plausible number is the worst thing that can happen in this job.

## 4. Recovering hidden numbers (this genuinely works)

On phone captures, **floating buttons** (the `↑` scroll button, the 「연관메뉴 +」 pill, the
「LOCA」 badge) sit on top of amounts. When a button is **semi-transparent**, zooming makes
the digits readable — they were only lost to the small source resolution.

```powershell
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile("<capture.jpg>")
$rect = New-Object System.Drawing.Rectangle(0, <crop y>, $src.Width, <height>)
$s = 5   # 5x
$bmp = New-Object System.Drawing.Bitmap ($src.Width*$s), (<height>*$s)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.DrawImage($src, (New-Object System.Drawing.Rectangle(0,0,($src.Width*$s),(<height>*$s))), $rect, [System.Drawing.GraphicsUnit]::Pixel)
$bmp.Save("<zoomed.png>", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $src.Dispose()
```

Then **open the zoomed file again with Read.** (Measured: all 3 hidden amounts on a
507×1100 capture were recovered at 5× zoom.)

- Check the source size first with `$src.Width/$src.Height`. Phone captures are usually
  500–1200px wide.
- Amounts sit at the right edge, so cropping the **bottom band (y = height-200 onward)**
  usually catches them.
- **An opaque overlay stays unreadable at any zoom.** If only white space shows, that row
  **has no amount at all** (the 0-won row in §6).
- Even when recovered, **confirm it once more with the §5 reconciliation.** Never trust
  zoom-reading alone.

## 5. ★ Reconcile against the card issuer's own total (the heart of this document)

A statement carries numbers the issuer printed itself:
`총 N건 · 소계 · 청구합계 · 상단 청구금액`

**Add up the amounts you read and match that number to the last won.**

```
맞으면  → 그 화면의 모든 금액·건수가 한꺼번에 증명된다. 빠진 거래도 없다.
안 맞으면 → 넣지 마라. 아래를 의심하라.
```

| Difference | Suspect |
|---|---|
| short by exactly one entry's amount | that row was missed (cut off in an overlapping capture) |
| nearly twice too much | **two months got mixed.** The statement screen also shows the previous month's activity |
| moderately too much | cancellations or prepayments were not subtracted |
| moderately too little | an instalment row was missed |
| the count matches but money is left over | there is a **row with no amount** (0 won, §6) |

**Field cases (2026-08-15):**
- The Shinhan 0307 statement showed May–July transactions but its subtotal was 583,253 won.
  Everything summed to 1,131,818 — twice as much. Summing **only July (7/4–7/19)** hit
  583,253 exactly; June had been the previous month's billing. → When you get double,
  **cut it by month.**
- A Lotte statement had 「DB손해보험 할부(2/5)」 on two rows, the second with a blank amount
  column. The other 5 entries summed exactly to the total, proving **the second row was
  0 won.** → An invisible value can be **fixed by deriving it from the total.**
- The unreadable 192,200 and 15,340 were **mathematically confirmed**: only those values
  make the total come to 583,253.

**A screen with no total to check against** (a mid-scroll capture) must not be settled on
its own — judge it together with a capture that has the total. If reconciliation is
ultimately impossible, say so in the report.

### An account has no total — reconcile with the **balance chain** (added 2026-08-15)

Neither SMS alerts nor app lists carry 「총 N건·소계」, so it is tempting to conclude §5 does
not apply. It does. **Whether the balance printed on each row connects to its neighbour**
carries exactly the same force as the issuer's total.

```
(오래된 줄의 잔액) − 출금 + 입금 = (그 다음 줄의 잔액)
```
※ When the app list is **newest-first**, the direction on screen is **bottom → top**.
Check the sort order first (§1-1 ②).

**If it connects, no transaction is missing from that stretch.** This is what separates a
gap between captures (§2) that was 「a day with no transactions」 from one where 「a capture
is missing」 — proof, not guesswork.

**Field cases (2026-08-15):**

- 4 SMS alerts — `159,421 −7,400→ 152,021 −71,010→ 81,011 −11,800→ 69,211`
  All four linked up, **proving nothing was missing between them.**
- 7 app rows — `24,680 −17,000→ 7,680 −6,300→ 1,380 +20,000→ 21,380 −9,200→ 12,180 −5,000→ 7,180 −6,770→ 410`
  27 July connected straight to 29 July → **28 July was a day with no transactions, not a
  missing capture.**
- On the same screen, `-18,0??원` hidden under the `↑` button **could not be recovered** —
  the balance *before* that row was off-screen, so there was no pair to derive from.
  → **Derivation works only when both balances are visible.** With only one, leave it blank
  and ask for more captures.

| If the chain does not match | Meaning |
|---|---|
| the gap equals **exactly one entry's amount** | that row was missed (hidden, or cut from an overlap) |
| the gap is an odd figure | there is an **invisible transaction** in between — ask for more captures |
| the balance range is wildly different | **it is a different account.** Re-read the account number (§1-1 ①·③) |
| the amount was hidden and unreadable | if both balances are visible, **derive it from the balance difference.** Stronger than zoom-reading (§4) |

**Bonus — the balance is confirmed too**: account material that passes §5 also proves
**the balance at that moment**. Send it in `accounts[].amt` and `apply` / `import` will
**replace** the account balance under 🏦 자산 with the latest figure (owner's order
2026-08-15 "현 통장 잔액에 맞출 것" — an account with a matching name has only its balance
overwritten).

⚠ **It is an overwrite, so send only 「the balance of the very last row」.** Sending a
balance from the middle of the chain sends the account back in time.
Check the sort order first — **the top row** when the app list is newest-first, the
**latest timestamp** for SMS alerts.
And confirm **the captured account really is the registered account** before sending
(§1-1 ③).

## 6. Moving it into the ledger (per row type)

| What the statement / account shows | What goes in the ledger |
|---|---|
| **일시불** (single payment) | one entry as-is. Date = **the day it was used** |
| **할부 (N/M)** (instalment) | this is money actually leaving this month. Date = **the statement's payment date** (e.g. Lotte 「8월 14일 명세서」 → `2026-08-14`). Do not date it to the original purchase (2023 etc.) |
| **취소** (cancellation — same day, same merchant, same amount) | **drop both the payment and the cancellation.** Net money moved is zero |
| **취소 (부분)** (partial cancellation) | **subtract** it from the original and enter one entry. Put `(취소 N원 반영)` in the memo |
| **선결제** (prepayment, negative) | **do not enter.** The original transaction is already in, so this double-counts |
| **a row with a blank amount** | it is 0 won. Do not enter (confirm via §5) |
| **a final instalment printed as 0 won** | do not enter |
| **card bill payment (account → card issuer)** | ⛔ **do not enter** (changed by the 2026-08-15 order — it used to be `tr`). The spending was already recorded on the day the card was used |
| **account — a row marked `체크카드`** | one spending entry. `pay:"card"` (it leaves the account, but the method is a card) |
| **account — money moved between our own accounts or between family members** (a person's name + transfer) | ⛔ **do not enter. Not as a transaction, not as `tr`.** Instead correct the **balance only** via `accounts[].amt` → ⛔ section below |
| **account — money that came from or went outside the family** | enter as `in` / `out`. **If you cannot tell whether it is family or an outsider, ask instead of entering** |
| **account — 1-won account verification · 0-won rows · deposit closures** | do not enter |
| **account — rows from an account outside the ledger's scope** | do not enter (§1-1 ③) |
| **account — a machine counterparty such as `자판기` or `현장발권`** | one spending entry as-is. With no merchant name, use the visible text as the memo (never invent one) |

> 📅 **A consequence of the two date rules above — keep it in mind, do not "fix" it.**
> Inside one statement the dates split: 일시불 rows land on the **use date** (a July telecom bill from the
> August statement → `2026-07-13`), while 할부 rows land on the **payment date** (`2026-08-14`).
> So a card's newest ledger date can be August while its August spending has not been billed yet.
> The app allows for this — `fxDataUntil` in `money/index.html` ignores 할부 when it works out how far a
> card's data has arrived, so a fixed cost whose statement has not come out yet reads 「📭 자료 기다리는 중」
> instead of a red 「납부일 지남」 (2026-08-16). Do not re-date rows to make the months line up.

> 🧩 **Categorising has two levels** — set the main category `c`, then pick the subcategory
> `sub` within it (외식비 · 식재료비 · 차량유지비 …).
> The usable names are defined by the 「🧩 쓸 수 있는 소분류」 table in
> `node tools/jobs.mjs list`, and how to choose is in §①-1 of `ledger-clerk`.
> **When a payment does not record what was bought (Coupang, 11st, Naver Pay), do not
> guess** — request a capture via `asks` in the result JSON.

### ⛔ Money moved among ourselves is settled by 「balance」, not by 「records」 (owner's order, 2026-08-15)

> "통장 식구간 오간 기록은 없이 **현 통장 잔액에 맞추어야 됨.**"

Account material is full of **money moved between our own accounts and between family
members**. Recording all of it buries the ledger under our own money going back and forth,
**hiding the money that actually left the household.**

```
✅ 밖으로 나간 돈 / 밖에서 들어온 돈  → 거래로 넣는다
⛔ 우리끼리 오간 돈                    → 안 넣는다. 대신 accounts[].amt 로 잔액만 맞춘다
```

What gets dropped by ⛔ (in the 2026-08-15 pass, **157 of 260 entries** fell here):
**transfers between family members or our own accounts · card-bill payments · 1-won account
verification · deposit closures · 0-won rows**

- **Do not enter it as `tr` either.** The old rule (record as a `tr` transfer) **was changed
  by this order. Do not revert it.**
- Dropping them makes the account look off, but **replacing the balance with the current
  figure makes it right again** (§5 "Bonus").
- Report the dropped count **broken down by type** (§7). Dropping them silently makes the
  family think entries went missing.
- ⚠ A transfer you cannot judge (an unfamiliar person's name) is **neither dropped nor
  entered — ask.** It may be money that left the household.

### Naming an instalment — the sequence goes in brackets

```
memo:  "롯데하이마트 할부 (35/36)"   ← 다음 달엔 (36/36)
고정비: "롯데하이마트 할부"           ← 회차 없이
```
The tool strips `(N/M)` before matching names (`norm` in `jobs.mjs`), so **the item stays
linked** as the sequence advances. Writing the sequence without brackets (`할부 35/36`)
creates a new item every month and kills recurrence detection.

### An instalment also records **what was bought** (owner's order, 2026-08-15)

Statements print **only the shop name**. Months later, `롯데하이마트 할부 (35/36)` tells
nobody what the money was for.

```
tx: { "memo": "롯데하이마트 할부 (35/36)", "buy": "냉장고" }
```

- **Enter it once.** The app keys on `name + total instalments`
  (`롯데하이마트할부#36`) and carries `📦 냉장고` into every month's rows from then on.
- Because the total is part of the key, **two instalments at the same shop** (a 36-month
  and a 12-month one) never merge.
- Instalments still missing this appear with a `⚠` in the **「── 할부 ──」** block of
  `jobs.mjs list` / `state`.
- **Never invent one that is not in the capture.** Ask the family and leave it blank until
  they answer.

### The same merchant on different cards

```
memo = 고정비 이름 = "KT통신요금 (신한)" / "KT통신요금 (롯데)"
```
**Keep the two identical.** If the names diverge, recurrence detection splits and the fixed
cost gets registered twice.

## 7. What the report must always state

- Which screens **reconciled** and which **could not**, separately
- Which numbers were **recovered by zooming**, and which rows were **dropped as unreadable**
- How many captures were **not entered because they overlapped**
- Which periods could not be entered because of a **gap** between captures
- For account captures, the stretches where the **balance chain connected** and where it
  **broke** (ask for more captures for the broken stretches)
- How many rows were dropped for belonging to an **account outside the ledger's scope**
- **What source material was destroyed and how many items** (⛔ section — if I do not say it
  was deleted, the owner assumes it is still there)

> The family has no way to check the numbers themselves. **Telling them how far it has been
> verified is the desk's job.**
