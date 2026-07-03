# Sizing & Recipes

How to match a **use case → the cheapest viable local setup**. Numbers below are
**measured** on the prototype rig unless marked as estimates.

## The one rule that governs everything

Local LLM speed is bound by **memory bandwidth**, not compute. Tokens/sec ≈
`bandwidth / active-weight-bytes`. So the two levers are (1) where the weights
live (system RAM vs VRAM) and (2) how big the *active* weight set is.

| Memory | Bandwidth | Notes |
|---|---|---|
| DDR5-5600 (CPU, dual channel) | ~50–70 GB/s effective | fine for embeddings + tiny models |
| RTX 5060 Ti 16GB (GDDR7) | ~448 GB/s | our test GPU (~×7 vs CPU) |
| RTX 3090/4090 24GB | ~940–1000 GB/s | fits 26B-MoE / 31B |
| RTX 5090 32GB | ~1800 GB/s | headroom for 31B + big context |

**eGPU note:** OCuLink / Thunderbolt does **not** bottleneck inference — the GPU
runs from its own VRAM at full bandwidth. The link only affects one-time model
load. The real constraint is **VRAM size** (the whole model + KV cache must fit,
or layers spill to RAM and speed collapses).

**MoE note:** Gemma 4 `26b` is MoE with ~4B **active** params → runs at ~4B speed
but needs ~16GB resident. Big-model quality at small-model speed — but wants 24GB.

## Model tiers

| Tier | Hardware | Model | Fits? | Use case |
|---|---|---|---|---|
| 0 | CPU only (32GB DDR5) | gemma4 `e4b` | ✅ | privacy-first, rare questions, latency-tolerant |
| **1** | **1×16GB (5060 Ti)** | **gemma4 `12b` Q4** | ✅ ~8GB | **internal support, low/medium QPS, docs+code RAG** ← tested |
| 2 | 1×24GB (3090/4090) | gemma4 `26b`-MoE / `31b` | ✅ | agentic code-QA, harder reasoning, more throughput |
| 3 | server / multi-GPU + vLLM | 32B+ , batched | — | high concurrency (hundreds of users) |

Switching tier = one line in `buddy.config.yaml` (`generation.model`).

## The proven recipe (Tier 1 — measured on 12B / 5060 Ti)

- **Retrieval:** hybrid — vector (pgvector HNSW) + lexical (Postgres FTS) fused
  with RRF; LLM query-expansion feeds the lexical arm.
- **Generation:** single model, `temperature 0.1`, **`think: false`** (see finding).
- **Safety:** grounding guard — a post-answer faithfulness check; if the answer
  isn't supported by the retrieved context, it's replaced with a safe decline.
- **Mode:** **non-agentic single-shot** for 12B. (Agentic ReAct loops lose to it
  at this tier — vaguer answers, higher latency, thinking-flaky. Reserve agentic
  for Tier 2+ models.)
- **Coverage gap:** for **symptom→mechanism** questions (user's words ≠ code terms),
  generate NL docs offline and index them (see Doc-gen).

## Measured numbers (gemma4:12b, 5060 Ti 16GB)

- **Throughput:** ~47 tok/s single stream.
- **Indexing:** 417 Go files / ~141k LOC / ~600 files → **6202 chunks in ~2 min**, 0 failures (embeddings on GPU).
- **Latency / QPS (single stream, incl. grounding guard):**
  - short answer (~80 tok): ~4–5 s → **~12–14 questions/min**
  - detailed answer (~250 tok): ~7–10 s → **~7 questions/min**
- **Scaling QPS:** `OLLAMA_NUM_PARALLEL` 2–4 → ~×2–4; **vLLM** continuous batching → tens–hundreds/min on the same card (estimate).

## What works vs what needs work (at real scale)

Tested on a real 141k-LOC Go backend:
- ✅ **Direct-vocabulary questions work on raw code at scale.** "How does clock in
  work?" was answered **accurately** (verified against source, incl. multi-file
  synthesis) — retrieval found the right chunks among 6202. No doc-gen needed.
  This is likely the majority of real employee questions (they use product terms).
- ⚠️ **Symptom→mechanism questions fail on raw code** (retrieval can't bridge
  "number not visible" → `encryption`). **Generated docs solve this** (proven).
- ⚠️ **Cross-file precise rules** need **2-step doc-gen** (extract rules → write)
  + feeding related files together; naive single-pass is vague.
- ⚠️ **High concurrency** needs vLLM batching, not Ollama single-stream.

## Doc-gen strategy (offline, cheap in steady state)

Generated docs bridge the symptom→mechanism gap. Cost is manageable because:
- **One-time + offline + incremental** (sha256 dedup → only changed files re-gen;
  steady-state ≈ the diff). Runs as a background job next to reindex.
- **Not the whole base** — only the user-facing behavior surface (skip tests,
  types, boilerplate, vendor); keep raw-code RAG for direct questions.
- **First pass parallelizes** — `OLLAMA_NUM_PARALLEL`, vLLM, or a rented multi-GPU
  burst (then serve cheap locally).
- **2-step for hard logic** — "extract exact rules → write user doc"; feed related
  files together (needs code-graph/dependency grouping at large scale).

## Key finding: control Gemma 4's thinking mode

Gemma 4 is a reasoning model. With thinking **on**, hard prompts (rule extraction,
agentic tool decisions) spend the token budget "thinking" and can return an
**empty** answer under a cap; it's also slower. Setting **`think: false`** fixed
cross-file rule extraction and stabilized the pipeline. Config: `generation.think`.

## Fine-tuning tiers (when RAG isn't enough)

Ladder: **RAG** (cheap, dynamic, never stale) → **QLoRA/LoRA** (style/domain/format;
fits 8–24GB locally) → **full fine-tune** (deep behavior change; ~16 bytes/param →
multi-A100/H100, **rent the burst**, then deploy the small model locally). Training
hardware ≠ serving hardware — rent for the training burst, serve cheap.
