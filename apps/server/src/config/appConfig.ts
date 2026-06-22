// Behavior config loaded from buddy.config.yaml (validated with zod at startup).
// Separate from src/config/index.ts, which holds infra/secrets from .env.
import { readFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const CONFIG_PATH = resolve(process.cwd(), process.env.BUDDY_CONFIG ?? 'buddy.config.yaml');

const sourceSchema = z.object({
  collection: z.string().min(1),
  type: z.enum(['docs', 'code']),
  path: z.string().min(1),
});

const schema = z.object({
  generation: z.object({
    model: z.string().min(1),
    temperature: z.number().min(0).max(2).default(0.1),
  }),
  retrieval: z.object({
    mode: z.enum(['vector', 'lexical', 'hybrid']).default('hybrid'),
    topK: z.number().int().positive().default(5),
    minScore: z.number().min(0).max(1).default(0.35),
    expandQuery: z.boolean().default(true), // LLM keyword expansion for the lexical arm
    agentic: z.boolean().default(false), // ReAct loop: model drives its own multi-step search
  }),
  sources: z.array(sourceSchema).default([]),
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
  // Resolve relative source paths against the config file's directory.
  const base = dirname(CONFIG_PATH);
  cfg.sources = cfg.sources.map((s) => ({
    ...s,
    path: isAbsolute(s.path) ? s.path : resolve(base, s.path),
  }));
  return cfg;
}

export const appConfig = load();
export type AppConfig = typeof appConfig;
