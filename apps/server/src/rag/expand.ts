// LLM query expansion: turns a natural-language question into search keywords
// (synonyms, likely code identifiers, concrete implied values). This bridges the
// gap between how users ask and how code/docs are written — feeding the lexical
// arm of hybrid retrieval so e.g. "weekend" can reach code that says "Saturday".
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { chatModel } from '../llm/chat.js';
import { logger } from '../lib/logger.js';

const log = logger.child('expand');

const SYSTEM = `You expand a user's question into search keywords for retrieving relevant documentation or source code.
Return ONLY a comma-separated list of 5-12 keywords. Include:
- key nouns and synonyms from the question (keep the question's language),
- likely code identifiers / function or variable names (camelCase or snake_case),
- concrete values implied by the question (e.g. specific weekday names for "weekend").
No explanations — just the comma-separated keywords.`;

export async function expandQuery(question: string): Promise<string[]> {
  try {
    const res = await chatModel.invoke([new SystemMessage(SYSTEM), new HumanMessage(question)]);
    const text = typeof res.content === 'string' ? res.content : '';
    const terms = text
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 16);
    log.debug(`expanded into ${terms.length} terms`);
    return [question, ...terms]; // keep the original question words too
  } catch (err) {
    log.warn(`query expansion failed, using raw question: ${(err as Error).message}`);
    return [question];
  }
}
