# buddy-on — AI support bot

A first-line support / knowledge bot powered by a **local LLM**. It reads
questions and bug reports from messengers (Slack/Telegram, planned) and via a
REST API, finds answers in documentation and codebases (RAG), and — once the
relevant feature lands — files a ticket in YouTrack for confirmed bugs.

Everything runs locally: the LLM is served by **Ollama** (typically on a
separate machine in the LAN), and no data leaves your infrastructure.

## Editions

- **Free** — Node.js + TypeScript + LangGraph (this repository, `apps/server`).
- **Paid** — a Go server (goroutines, lower memory footprint) — later, `apps/server-go`.

## Stack (free edition)

| Layer | Technology |
|---|---|
| HTTP | Fastify |
| Orchestration | LangGraph.js + LangChain.js |
| LLM | Ollama (local only, over the network) |
| DB + vectors | Postgres + pgvector (Prisma) |
| Queue | RabbitMQ |
| Auth | JWT (no roles) |

## How it works

```
POST /messages (JWT) ──► Job (queued) in DB ──► RabbitMQ
                                                   │
                                          worker (prefetch = N)
                                                   │
                          LangGraph: retrieve (pgvector) ──► generate (Ollama)
                                                   │
                          Job (done, answer, sources) ◄── GET /status/:jobId
```

Documentation and code are indexed ahead of time into pgvector. A question is
embedded, matched against the indexed chunks, and the retrieved context is sent
to the local LLM, which answers grounded in that context (and declines when the
context has no answer, instead of inventing one).

## Configuration

Two layers:
- **`.env`** — infra/secrets (DB, RabbitMQ, Ollama URL, JWT, ports).
- **`apps/server/buddy.config.yaml`** — behavior: generation model, retrieval
  settings, **sources to index**, re-index schedule, and the system prompt.
  Validated with zod at startup.

On boot the server applies migrations, **indexes the configured sources** (so it
never answers against an empty index), and schedules a daily incremental
re-index. Relative source paths resolve against the config file.

## Quick start — Docker (all-in-one)

```bash
cp .env.example .env                          # optional; compose has sane defaults
export OLLAMA_BASE_URL=http://<ollama-host>:11434
docker compose up -d --build                  # Postgres + RabbitMQ + the server
```

The `server` container runs migrations, seed-indexes the sources from
`buddy.config.yaml`, and serves on `http://localhost:3000`.

## Quick start — local dev

```bash
docker compose up -d postgres rabbitmq        # infra only
cd apps/server
cp ../../.env.example .env                     # set OLLAMA_BASE_URL to your Ollama host
npm install
npm run prisma:deploy                          # apply migrations
npm run dev                                    # HTTP + worker; seed-indexes on boot
```

Health checks: `GET /health` (liveness), `GET /ready` (DB / RabbitMQ / Ollama).

Ad-hoc indexing (outside the configured sources) still works via the CLI:
`npm run index -- <dir> [collection]`.

### LLM (Ollama)

The LLM runs in Ollama, usually on another machine in the LAN. On that host set
`OLLAMA_HOST=0.0.0.0:11434`, open port `11434`, and point `OLLAMA_BASE_URL` at
it. Pull the models referenced in `.env`:

```bash
ollama pull nomic-embed-text          # embeddings (required for RAG)
ollama pull gemma4:e4b                # generation (model set in buddy.config.yaml)
```

## REST API

| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | — | create a user, returns a JWT |
| `POST` | `/auth/login` | — | log in, returns a JWT |
| `POST` | `/messages` | JWT | enqueue a question, returns `{ jobId, position, etaSeconds }` |
| `GET` | `/status/:jobId` | JWT | job status; when done includes `answer` + `sources` |

The answer is computed asynchronously; the client polls `/status/:jobId` (a
push-based delivery mechanism is on the roadmap).

## CLI

| Command | Description |
|---|---|
| `npm run index -- <dir> [collection]` | index markdown/code into a collection |
| `npm run search -- "query"` | inspect semantic search (no LLM) |
| `npm run ask -- [--collection=a,b] "question"` | run the full retrieve → answer graph |

## Status & roadmap

The core pipeline (RAG over markdown and code, async queue with position/ETA,
JWT, graph-based answering) is working. A v2 refactor and the remaining features
(hybrid retrieval, startup/scheduled indexing, single configurable model,
messenger adapters, MCP integrations) are described in
[ROADMAP.md](ROADMAP.md).

> Detailed setup/usage docs are being rewritten alongside the v2 refactor.
