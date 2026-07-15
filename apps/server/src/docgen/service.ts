// Offline doc generation: turn code into end-user NL docs the RAG index can
// answer against, closing the symptom→mechanism gap. Two-step per group:
//   1) extract exact rules/behaviors from the code (resolving negations etc.)
//   2) write plain-language FAQ docs from those rules
// The two-step flow + think:false (from config) is what made cross-file rules
// come out precise instead of vague. Output .md files are then indexed as a
// normal docs collection. Requires Ollama; run offline as a batch.
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { chatModel } from '../llm/chat.js';
import { logger } from '../lib/logger.js';
import { groupFiles, buildGroupBlob } from './grouping.js';
import type { StructuralProviderId } from '../structural/types.js';

const log = logger.child('docgen');

const MAX_GROUP_CHARS = 20_000; // bound the code blob fed per group (seed + related chunks)

// Auto-pick the structural provider that drives graph-aware grouping.
function detectProvider(sourceDir: string): StructuralProviderId {
  if (existsSync(join(sourceDir, 'go.mod'))) return 'goda';
  return 'none';
}

const STEP1_SYSTEM = `You analyze source code and extract its EXACT behavior as a list of rules.
For each feature/handler, state: what it does, its user-facing effect, and any conditions/restrictions — quoting concrete values (names, days, limits) from the code.
Pay attention to negations (a condition that disables everything except X means "only X").
Only state what is explicitly in the code. Output a plain list, no prose.`;

const STEP2_SYSTEM = `You write END-USER support documentation from a list of extracted rules, for customers/managers/support agents who have NO access to the code.
Write short FAQ-style entries in plain language. Be specific about restrictions and concrete values.
No code, no file names, no identifiers, no jargon.`;

async function ask(system: string, user: string): Promise<string> {
  const res = await chatModel.invoke([new SystemMessage(system), new HumanMessage(user)]);
  return typeof res.content === 'string' ? res.content : String(res.content);
}

export interface DocgenStats {
  groups: number;
  written: number;
}

export async function generateDocs(
  sourceDir: string,
  outDir: string,
  opts: { only?: string } = {},
): Promise<DocgenStats> {
  const provider = detectProvider(sourceDir);
  const all = await groupFiles(sourceDir, provider);
  const groups = opts.only ? all.filter((g) => g.name.includes(opts.only!)) : all;
  log.info(`grouping: provider=${provider}, ${groups.length}/${all.length} groups`);
  await mkdir(outDir, { recursive: true });
  let written = 0;

  for (const group of groups) {
    const code = await buildGroupBlob(group, MAX_GROUP_CHARS);
    if (!code.trim()) continue;

    const rules = await ask(STEP1_SYSTEM, code);
    if (!rules.trim()) {
      log.warn(`no rules extracted for "${group.name}" — skipping`);
      continue;
    }
    const doc = await ask(STEP2_SYSTEM, rules);
    if (!doc.trim()) continue;

    await writeFile(join(outDir, `${group.name}.md`), doc, 'utf8');
    written++;
    log.info(`generated "${group.name}.md" (${group.seedFiles.length} seed + ${group.relatedFiles.length} related)`);
  }

  log.info('docgen finished', { groups: groups.length, written });
  return { groups: groups.length, written };
}
