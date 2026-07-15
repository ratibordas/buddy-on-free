# Sizing guide

This doc maps use cases to the cheapest local setup that can handle them. The
numbers come from benchmarks I ran on my own hardware; anything I didn't measure
myself is marked as an estimate.

## Memory bandwidth is the constraint

Local LLM inference is bound by memory bandwidth, not compute. A decent
approximation is `tokens/sec ≈ bandwidth / active-weight-bytes`, which leaves
you with two levers: where the weights live (system RAM vs VRAM) and how large
the active weight set is.

| Memory | Bandwidth | Notes |
|---|---|---|
| DDR5-5600 (CPU, dual channel) | ~50–70 GB/s effective | ok for embeddings and tiny models |
| RTX 5060 Ti 16GB (GDDR7) | ~448 GB/s | my test GPU, roughly 7x the CPU |
| RTX 3090/4090 24GB | ~940–1000 GB/s | fits 26B-MoE / 31B |
| RTX 5090 32GB | ~1800 GB/s | headroom for 31B with a large context |

Two things worth knowing before buying hardware:

- An eGPU over OCuLink or Thunderbolt does not bottleneck inference. The GPU
  serves from its own VRAM at full bandwidth; the link only slows down the
  one-time model load. What actually matters is VRAM size — the whole model plus
  KV cache must fit, otherwise layers spill to system RAM and speed collapses.
- MoE models change the math. Gemma 4 26B has about 4B active parameters, so it
  generates at the speed of a 4B model while needing ~16GB resident. You get
  big-model quality at small-model speed, but realistically it wants a 24GB card.

## Model tiers

| Tier | Hardware | Model | Fits? | Use case |
|---|---|---|---|---|
| 0 | CPU only (32GB DDR5) | gemma4 e4b | yes | privacy-first, rare questions, latency-tolerant |
| 1 | 1×16GB (5060 Ti) | gemma4 12b Q4 | yes, ~8GB | internal support, low/medium QPS, docs+code RAG (the tier I tested) |
| 2 | 1×24GB (3090/4090) | gemma4 26b-MoE or 31b | yes | agentic code-QA, harder reasoning, more throughput |
| 3 | server / multi-GPU + vLLM | 32B+, batched | — | high concurrency, hundreds of users |

Switching tiers is a one-line change in `buddy.config.yaml`
(`generation.model`).

## The setup that worked (Tier 1, 12B on a 5060 Ti)

- Retrieval: hybrid. Vector search (pgvector HNSW) and lexical search (Postgres
  FTS) fused with RRF; LLM query expansion feeds the lexical arm.
- Generation: a single model at `temperature 0.1` with `think: false` — see the
  note on thinking mode below.
- Safety: a grounding guard runs after generation and checks the answer against
  the retrieved context. If the answer isn't supported by it, the bot declines
  instead of guessing.
- Mode: non-agentic, single-shot. I tried agentic ReAct loops at this tier and
  they lost on every axis — vaguer answers, higher latency, and the thinking
  mode made them flaky. Agentic setups make sense from Tier 2 up.
- Known gap: questions phrased as symptoms ("the number isn't visible") don't
  retrieve well against raw code, because the user's words don't match code
  vocabulary. Generating natural-language docs offline and indexing those closes
  the gap — details below.

## Measured numbers (gemma4:12b, 5060 Ti 16GB)

Indexing a real production Go backend — 417 Go files, ~141k LOC, ~600 files
total — produced 6202 chunks in about 2 minutes with zero failures, embeddings
running on the GPU.

- Throughput: ~47 tok/s on a single stream.
- Short answer (~80 tokens), including the grounding guard: 4–5 s, or roughly
  12–14 questions/min.
- Detailed answer (~250 tokens): 7–10 s, roughly 7 questions/min.
- Scaling: `OLLAMA_NUM_PARALLEL` at 2–4 gives a near-linear 2–4x. For real
  concurrency, vLLM with continuous batching should reach tens to hundreds of
  questions/min on the same card (estimate, not measured).

## What works and what doesn't at real scale

Tested against the same 141k-LOC codebase:

- Direct-vocabulary questions work on raw code, even at this scale. "How does
  clock in work?" came back accurate — I verified the answer against the
  source, including logic synthesized across several files — with retrieval
  picking the right chunks out of 6202. Most real employee questions look like
  this, since people use product terms.
- Symptom-to-mechanism questions fail on raw code. Retrieval can't bridge "the
  number isn't visible" to `encryption`. Generated docs solve this; I verified
  it on exactly this class of questions.
- Precise rules spread across files need a two-step doc generation (extract the
  rules first, then write the doc) with related files fed together. A naive
  single pass produces vague text.
- High concurrency needs vLLM batching. Ollama is single-stream at heart.

## Offline doc generation

Generated docs exist to bridge the symptom-to-mechanism gap, and the cost stays
manageable for a few reasons. Generation is one-time, offline and incremental —
files are deduplicated by sha256, so in steady state you only regenerate the
diff, as a background job next to reindexing. You also don't need the whole
codebase: only the user-facing behavior surface matters (skip tests, type
definitions, boilerplate and vendor code), and raw-code RAG keeps handling the
direct questions. The first full pass parallelizes well — `OLLAMA_NUM_PARALLEL`,
vLLM, or a rented multi-GPU burst, after which serving stays local and cheap.
For genuinely hard logic, use the two-step extract-then-write flow and feed
related files together, which at large scale wants some form of dependency
grouping.

## Gemma 4's thinking mode

Gemma 4 is a reasoning model, and with thinking enabled, hard prompts (rule
extraction, agentic tool decisions) can burn the entire token budget on
reasoning and return an empty answer once they hit the cap — while also being
slower. Setting `think: false` fixed cross-file rule extraction outright and
stabilized the whole pipeline. It's exposed in the config as `generation.think`.

## When RAG isn't enough

The escalation ladder looks like this: RAG first — it's cheap, dynamic and never
goes stale. If the model needs a specific style, domain vocabulary or output
format, QLoRA/LoRA fine-tuning fits in 8–24GB and runs locally. Deep behavior
change means a full fine-tune at roughly 16 bytes per parameter, which puts you
in multi-A100/H100 territory — rent the burst, train, then serve the resulting
small model on your own cheap hardware. Training hardware and serving hardware
are different problems.
