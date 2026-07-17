// Behavior config (buddy.config.yaml). Infra and secrets stay in .env — see config/index.ts.
import { readFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { StructuralProviderId } from '../structural/types.js';

const CONFIG_PATH = resolve(process.cwd(), process.env.BUDDY_CONFIG ?? 'buddy.config.yaml');

const STRUCTURAL_PROVIDERS = ['none', 'goda', 'gograph', 'codebase-memory'] as const;

const sourceSchema = z
  .object({
    collection: z.string().min(1),
    // Local sources read from disk: docs (markdown chunker) | code (AST chunker).
    // Remote doc connectors (credentials in .env): notion | confluence.
    type: z.enum(['docs', 'code', 'notion', 'confluence']).default('docs'),
    // Filesystem path — required for docs/code, ignored for remote connectors.
    path: z.string().min(1).optional(),
    // Source language (go | typescript | javascript | python | ...). Used to pick the
    // structural provider from `structuralByLanguage` when `structural` is not set.
    language: z.string().optional(),
    // Explicit structural/graph provider for this source (overrides structuralByLanguage).
    structural: z.enum(STRUCTURAL_PROVIDERS).optional(),
    // Remote connector scope (what to pull). Auth tokens live in .env, never here.
    space: z.string().optional(), // Confluence space key
    database: z.string().optional(), // Notion database id (optional; else all shared pages)
  })
  .refine((s) => (s.type === 'docs' || s.type === 'code' ? !!s.path : true), {
    message: 'sources of type docs/code require a `path`',
  });

const schema = z.object({
  generation: z.object({
    model: z.string().min(1),
    temperature: z.number().min(0).max(2).default(0.1),
    // Thinking/reasoning mode (Gemma 4 et al). Off by default: for grounded QA it
    // adds latency and, under a token cap, can consume the budget and return an
    // empty answer. Enable only for tasks that clearly benefit from reasoning.
    think: z.boolean().default(false),
  }),
  retrieval: z.object({
    mode: z.enum(['vector', 'lexical', 'hybrid']).default('hybrid'),
    topK: z.number().int().positive().default(5),
    minScore: z.number().min(0).max(1).default(0.35),
    // Preset that sets the LLM-pass flags below (speed vs quality). Trades how many
    // chat calls run per question. 'custom' keeps the explicit flags as written.
    //   fast     = generate only                     (1 call)
    //   balanced = generate + grounding guard         (2 calls)
    //   quality  = expand + generate + guard          (3 calls, non-agentic; best on 12B)
    //   max      = quality + agentic ReAct loop       (needs a strong model, Tier 2+)
    profile: z.enum(['fast', 'balanced', 'quality', 'max', 'custom']).default('balanced'),
    expandQuery: z.boolean().default(true), // LLM keyword expansion for the lexical arm
    agentic: z.boolean().default(false), // ReAct loop: model drives its own multi-step search
    groundingCheck: z.boolean().default(true), // verify the answer is supported by context (anti-hallucination)
  }),
  sources: z.array(sourceSchema).default([]),
  // Default structural provider per language (a source's own `structural` overrides).
  structuralByLanguage: z.record(z.string(), z.enum(STRUCTURAL_PROVIDERS)).default({}),
  reindex: z
    .object({
      onStartup: z.boolean().default(true),
      cron: z.string().optional(),
    })
    .default({ onStartup: true }),
  prompts: z.object({
    system: z.string().min(1),
  }),
});

function load(): z.infer<typeof schema> {
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    console.error(`❌ Config file not found: ${CONFIG_PATH} (set BUDDY_CONFIG to override)`);
    process.exit(1);
  }

  const parsed = schema.safeParse(parseYaml(raw));
  if (!parsed.success) {
    console.error(`❌ Invalid ${CONFIG_PATH}:`);
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  const cfg = parsed.data;

  // Apply the retrieval profile (unless 'custom', which keeps the explicit flags).
  const PROFILES = {
    fast: { expandQuery: false, groundingCheck: false, agentic: false },
    balanced: { expandQuery: false, groundingCheck: true, agentic: false },
    quality: { expandQuery: true, groundingCheck: true, agentic: false },
    max: { expandQuery: true, groundingCheck: true, agentic: true },
  } as const;
  if (cfg.retrieval.profile !== 'custom') {
    Object.assign(cfg.retrieval, PROFILES[cfg.retrieval.profile]);
  }

  // Resolve relative source paths against the config file's directory.
  // Remote connectors (notion/confluence) have no path — leave them untouched.
  const base = dirname(CONFIG_PATH);
  cfg.sources = cfg.sources.map((s) => ({
    ...s,
    path: s.path ? (isAbsolute(s.path) ? s.path : resolve(base, s.path)) : s.path,
  }));
  return cfg;
}

export const appConfig = load();
export type AppConfig = typeof appConfig;

/** Effective structural provider for a source: explicit override, else by language, else none. */
export function resolveStructural(source: {
  language?: string;
  structural?: StructuralProviderId;
}): StructuralProviderId {
  if (source.structural) return source.structural;
  if (source.language) {
    const byLang = appConfig.structuralByLanguage[source.language];
    if (byLang) return byLang;
  }
  return 'none';
}
