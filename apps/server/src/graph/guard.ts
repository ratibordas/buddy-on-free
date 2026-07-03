// Grounding guard (anti-hallucination): after an answer is produced, verify that
// every factual claim in it is supported by the retrieved context. If not, we
// replace the answer with a safe decline. This is a faithfulness check — more
// robust than prompt-only grounding, and it covers both the simple and agentic
// paths (agentic mode in particular tends to loosen grounding).
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { chatModel } from '../llm/chat.js';
import { logger } from '../lib/logger.js';
import type { SearchHit } from '../rag/search.js';

const log = logger.child('guard');

export const DECLINE = "I don't have information about that. Please contact human support.";

const GUARD_SYSTEM = `You are a strict fact-checker. Given CONTEXT and an ANSWER, decide whether EVERY factual claim in the ANSWER is directly supported by the CONTEXT.
Reply with exactly one word: SUPPORTED or UNSUPPORTED.
If the ANSWER states it has no information or suggests contacting support, reply SUPPORTED.`;

/** Returns true if the answer is supported by the context (or there is nothing to check). */
export async function verifyGrounded(answer: string, hits: SearchHit[]): Promise<boolean> {
  if (hits.length === 0) return true; // no context → the generator already declined

  const context = hits.map((h, i) => `[${i + 1}] ${h.content}`).join('\n\n');
  const res = await chatModel.invoke([
    new SystemMessage(GUARD_SYSTEM),
    new HumanMessage(`CONTEXT:\n${context}\n\nANSWER:\n${answer}`),
  ]);
  const verdict = (typeof res.content === 'string' ? res.content : '').toUpperCase();

  // "UNSUPPORTED" contains "SUPPORTED", so check for the negative first.
  const supported = !verdict.includes('UNSUPPORTED') && verdict.includes('SUPPORTED');
  if (!supported) log.warn('answer failed grounding check — overriding with decline');
  return supported;
}
