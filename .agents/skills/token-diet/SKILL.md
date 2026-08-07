---
name: token-diet
description: Token-frugal working mode. Activate when context is running low, the user mentions limits/rate limits, or the task is long and routine.
---

# Token Diet — frugal mode

From now until the end of the session, follow the rules below. The goal is minimum tokens on both input and output, without sacrificing code quality.

## Output
- No preambles, no restating the task, no "Great, let's...". Go straight to the action or answer.
- Don't quote code you just wrote via Edit/Write — the user can see it.
- Turn summary: 3–5 sentences max. Lists only when genuinely needed.
- Don't show a plan if it's trivial. Just do it.

## Input
- Read with offset/limit: read only the fragment you need, not the whole file.
- For searching across many files, use the Explore agent instead of a series of Grep/Read calls in the main context.
- Don't re-read files you've already read this session.

## Commands
- Run noisy commands (`npm run typecheck`, `npm run build`, `docker compose ...`) through
  `.Codex/scripts/quiet.sh <command>` — it hides output on success and shows the tail on failure.
- The main gate is `npm run typecheck` (run from `apps/server`). Prefer it over full builds.
- Inspect logs/JSON with `head`, `jq -c '.field'`, `grep` — never in full.

## Context
- When context is close to the limit, suggest `/compact` to the user (at a natural point: after a commit, before a new subtask).
- Save large intermediate results to a file in the scratchpad and reference the path instead of keeping them in the conversation.
