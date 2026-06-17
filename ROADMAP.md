# Roadmap

This document captures the planned **v2 refactor** and the **remaining
features**. It reflects decisions and findings made during early prototyping.

## 1. Current state (works today)

- RAG over **markdown and code**, embeddings via Ollama (`nomic-embed-text`),
  stored in **Postgres + pgvector**; incremental re-indexing (sha256 dedup).
- **Multi-collection** indexing (e.g. `markdown`, `frontend`, `backend`) with
  per-collection search scoping.
- **LangGraph** answering graph: `retrieve → generate`, grounded prompt that
  declines instead of hallucinating.
- **Async pipeline**: `POST /messages` → RabbitMQ → worker → `GET /status/:jobId`,
  with queue position and ETA (moving average of real processing time).
- **JWT** auth, CORS / Helmet / rate-limit, graceful shutdown, resilient
  RabbitMQ reconnect.

## 2. Key finding that drives the refactor

A natural-language question over **raw code** ("which event format can be booked
only on weekends") **failed at retrieval**: the dense embedder could not connect
the NL question to the code logic (`format === 'sbornye'` + `['Subbota']`). The
relevant chunk was indexed but never reached the top-K.

**Conclusion:** the bottleneck is retrieval, not the model. Pure dense vector
search is insufficient for code QA → we need **hybrid retrieval** (lexical +
vector), and/or NL summaries generated from code.

## 3. Open decisions (confirm before starting)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Default retrieval mode | `hybrid` (lexical + vector); `lexical`-only is the single-model option |
| D2 | Config file format | TS (type-safe) vs YAML (ops-friendly) |
| D3 | Single generation model | **Gemma 4** — `gemma4:e4b` on CPU now, `gemma4:26b` (MoE, 4B active) on GPU |
| D4 | Rollout | all refactor items at once vs phased |

## 4. v2 refactor

### R1 — Startup config file
A single `buddy.config.{ts,yaml}`, validated with zod at startup, replacing CLI
args and the hardcoded system prompt. Holds:
- `generation`: model, temperature
- `retrieval`: mode (`hybrid`/`lexical`/`vector`), topK
- `sources[]`: `{ collection, type: code|docs, path }` — multiple indexing targets
- `reindex`: `{ onStartup, cron }`
- `prompts`: system prompt(s)

### R2 — Indexing at startup + scheduled re-indexing
- On boot (after migrations): ensure the vector index exists; if a configured
  collection is empty, index it **before** the server reports `ready` (never
  answer against an empty index).
- Daily re-index via a scheduler (`node-cron`) that **publishes a `reindex` job**
  to RabbitMQ; a worker consumes it. (RabbitMQ is not a scheduler — it needs a
  trigger.) Incremental dedup keeps this cheap.

### R3 — Hybrid retrieval
- Add a lexical arm: Postgres full-text search (and/or `pg_trgm`) over chunk
  content. Fuse with the vector arm via **Reciprocal Rank Fusion**.
- Mode switchable in config; `lexical`-only drops the embedder (single model).
- Optional later: LLM query-expansion / reranking on top.

### R4 — Single configurable model
- One generation model, set in config (Gemma 4). Switching tiers
  (`e4b` → `26b`) is a one-line config change; no code edits.

### R5 — `userId` on Job + one active job per user
- Add `userId` to `Job` (from the JWT subject).
- Reject a new `POST /messages` while the user has a `queued`/`processing` job
  (HTTP 409 + the active `jobId`). Toggle in config for API clients that need
  concurrency.

### R6 — Push-based answer delivery (SSE)
- `GET /messages/:jobId/stream` holds the connection and pushes the answer when
  ready — no busy polling, no WebSocket complexity. Polling stays as fallback.

## 5. Remaining features (after the refactor)

### F1 — Question vs bug classification
A classifier node in the graph routes a message to either the answer path or the
bug path. Drives F2/F3.

### F2 — Codebase scan for bug confirmation
For suspected bugs, retrieve relevant code (hybrid) and have the model judge
whether the report corresponds to a real defect, with cited code locations.

### F3 — YouTrack MCP: file bug reports
On a confirmed bug, create a ticket via the YouTrack MCP and return the ticket
link to the chat. (Gemma 4 has native function-calling, which helps here.)

### F4 — Messenger adapters (Telegram, then Slack)
Adapters normalize incoming messages into the existing pipeline
(`IncomingMessage` / `MessageChannel` already exist) and post answers back.
Per-user single-in-flight (R5) maps naturally to a chat conversation.

### F5 — GitLab MCP
Scan remote repositories (in addition to local code) for retrieval and bug
confirmation.

### F6 — Semantic answer cache
The `AnswerCache` model already exists. Embed the question, look up a close
previously-answered question; if the index version is unchanged, return the
cached answer without calling the LLM. Invalidate on re-index.

## 6. Suggested sequencing

1. R1 (config) → R4 (single model) — foundation everything else reads from.
2. R2 (startup/scheduled indexing) — guarantees a ready index.
3. R3 (hybrid retrieval) — fixes the core retrieval gap; re-run the code-QA test.
4. R5 + R6 (per-user gating, SSE) — UX/operational polish.
5. F1 → F2 → F3 (classification → code scan → YouTrack) — the bug-report flow.
6. F4 (messengers), F5 (GitLab), F6 (cache) — breadth and optimization.
