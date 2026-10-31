# family-diary — project instructions (shared by all AIs)

> **Read by Claude, Codex and other AIs together.** Claude's `CLAUDE.md` pulls this file in (`@AGENTS.md`). **Write rules only here** — rules written in `CLAUDE.md` are invisible to other AIs.

## What this is

Our family diary — family journal + 💳 household ledger (shared Supabase backend, Cloudflare Pages web deploy). The ledger staff member sorts the receipts and card captures the family hands in.

## Read first (in order, only what you need)

| Order | File | When |
|---|---|---|
| 1 | `~\.claude\CLAUDE.md` — global rules. **§0-0 is the translation table for other AIs** (how to substitute for skills, workers, hooks) | Always (Codex is routed there by `~\.codex\AGENTS.md`) |
| 2 | `~\vault-workspace\WORKSPACE_MASTER.md` **§1-2 ②** — this project's entry point, stack, pitfalls | When first entering the project |
| 3 | `~\vault-workspace\handoff\INDEX.md` top call-name table — how far we got | When resuming. **Open only one handoff note at a time** |
| 4 | `~\vault-workspace\부품서랍\_INDEX.md` front part (Read map) only | Only when building UI/screens |

## This project's skills (staff seats)

| Skill | File | Codex call |
|---|---|---|
| card-statement | `.claude\skills$n\SKILL.md` | `$card-statement` (`.agents\skills`) |
| family-diary | `.claude\skills$n\SKILL.md` | `$family-diary` (`.agents\skills`) |

## Sync and shipping

Automatic — pushed to the warehouse (Naver Box git, remote `box`) every 10 minutes and pulled at boot. **Do not touch it.** When you must push manually, follow the `shipout` skill procedure exactly. Commit messages are in Korean.
