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
EXHAUSTIVELY enumerate every condition under which the main action does NOT happen — is skipped, fails, is dropped, filtered out, or never runs — including implicit ones: early returns, error/retry-exhausted paths, missing/disabled/not-found records, scoping/ownership filters (e.g. only records of a matching brand/tenant), and consumer/queue failures that stop processing.
Only state what is explicitly in the code. Output a plain list, no prose.`;

const CRITIC_SYSTEM = `You review a list of extracted rules against the source code for COMPLETENESS.
Output ONLY behaviors/conditions that are present in the code but MISSING from the rules — especially NEGATIVE paths: skips, failures, dropped/filtered items, early returns, retries-exhausted, ownership/scoping filters (e.g. only records of a matching brand/tenant), consumer/queue failures that stop processing.
Output a plain list of the missing items only. If nothing is missing, output an empty response.`;

const STEP2_SYSTEM = `You write END-USER support documentation from a list of extracted rules, for customers/managers/support agents who have NO access to the code.
Write short FAQ-style entries in plain language. Be specific about restrictions and concrete values. Cover every rule, including all the negative/failure conditions.
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
  opts: { only?: string; critic?: boolean } = {},
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

    let rules = await ask(STEP1_SYSTEM, code);
    if (!rules.trim()) {
      log.warn(`no rules extracted for "${group.name}" — skipping`);
      continue;
    }
    // Completeness critic: a second pass finds conditions the extraction missed.
    if (opts.critic !== false) {
      const missing = await ask(CRITIC_SYSTEM, `CODE:\n${code}\n\nRULES SO FAR:\n${rules}`);
      if (missing.trim()) rules += `\n\nAdditional conditions:\n${missing}`;
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
