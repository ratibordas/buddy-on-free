# buddy-on

A first-line support bot that answers user questions from your docs and your
codebase, powered by a fully local LLM. I built it to answer real support
questions against a production Go backend (~141k LOC) without a single byte
leaving the infrastructure: the model runs in [Ollama](https://ollama.com) on a
machine in the LAN, vectors live in Postgres.

The interesting part isn't the CRUD around it — it's the retrieval. Pure vector
search turned out to be not enough for code QA, so the pipeline is hybrid
(pgvector + Postgres FTS fused with RRF), with LLM query expansion feeding the
lexical arm and a grounding guard that checks every answer against the retrieved
context before it reaches the user. Numbers and hardware recipes are in
[SIZING.md](SIZING.md) — all measured on real hardware, including what didn't
work.

## Stack

Fastify · LangGraph.js · Ollama · Postgres + pgvector (Prisma) · RabbitMQ · JWT

## How it works

```
POST /messages (JWT) ──► Job (queued) in DB ──► RabbitMQ
                                                   │
                                          worker (prefetch = N)
                                                   │
                          LangGraph: retrieve (hybrid) ──► generate ──► grounding guard
                                                   │
                          Job (done, answer, sources) ◄── GET /status/:jobId
```

Docs and code are indexed ahead of time into pgvector (incremental, sha256
dedup). A question goes through query expansion, hybrid retrieval and
generation; if the grounding guard finds the answer unsupported by the retrieved
context, the bot declines instead of inventing one.

## Configuration

Two layers, deliberately separate:

- `.env` — infra and secrets: DB, RabbitMQ, Ollama URL, JWT, ports.
- `apps/server/buddy.config.yaml` — behavior: generation model, retrieval mode,
  speed/quality profile (`fast` / `balanced` / `quality` / `max`), sources to
  index, re-index schedule, system prompt. Validated with zod at startup.

Switching the model tier (see [SIZING.md](SIZING.md)) is a one-line change.

On boot the server applies migrations, indexes the configured sources — it never
answers against an empty index — and schedules a daily incremental re-index.

## Quick start — Docker

```bash
cp .env.example .env                          # optional; compose has sane defaults
export OLLAMA_BASE_URL=http://<ollama-host>:11434
docker compose up -d --build                  # Postgres + RabbitMQ + the server
```

## Quick start — local dev

```bash
docker compose up -d postgres rabbitmq        # infra only
cd apps/server
cp ../../.env.example .env                     # point OLLAMA_BASE_URL at your Ollama host
npm install
npm run prisma:deploy
npm run dev                                    # HTTP + worker; seed-indexes on boot
```

Health checks: `GET /health` (liveness), `GET /ready` (DB / RabbitMQ / Ollama).

On the Ollama host: set `OLLAMA_HOST=0.0.0.0:11434`, open the port and pull the
models:

```bash
ollama pull nomic-embed-text          # embeddings
ollama pull gemma4:12b                # generation (set in buddy.config.yaml)
```

## REST API

| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | — | create a user, returns a JWT |
| `POST` | `/auth/login` | — | log in, returns a JWT |
| `POST` | `/messages` | JWT | enqueue a question, returns `{ jobId, position, etaSeconds }` |
| `GET` | `/status/:jobId` | JWT | job status; when done includes `answer` + `sources` |

Answers are computed asynchronously — the client polls `/status/:jobId` or
passes a `webhookUrl` to get the result pushed back.

## CLI

| Command | Description |
|---|---|
| `npm run index -- <dir> [collection]` | index markdown/code into a collection |
| `npm run search -- "query"` | inspect retrieval without the LLM |
| `npm run ask -- [--collection=a,b] "question"` | run the full graph from the terminal |

## Status

The pipeline is complete and tested against a real production codebase: hybrid
retrieval, query expansion, grounding guard, async queue with position/ETA,
startup + scheduled indexing, webhook delivery. Things I'd add if I pick it up
again: messenger adapters (the `IncomingMessage` model is already
channel-agnostic), a semantic answer cache (the `AnswerCache` table exists), and
a classifier that routes bug reports to ticket creation.
