// Agentic retrieval (ReAct loop): the model decides what to search, reads the
// results, and refines its queries until it can answer — instead of a single
// fixed top-K lookup. This closes the "symptom -> mechanism" gap (e.g. the user
// asks about a number "not being visible", the model searches "encryption").
//
//   question -> [agent] --tool_calls--> [tools: search] --> [agent] -> ... -> answer
//
// State (messages, hits) lives in the graph invocation, so it is concurrency-safe.
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { appConfig } from '../config/appConfig.js';
import { logger } from '../lib/logger.js';
import { chatModel } from '../llm/chat.js';
import { search, type SearchHit } from '../rag/search.js';

const log = logger.child('agentic');

const MAX_ITERS = 4; // safety cap on agent<->tools loops

// The model only needs the tool's name/description/schema; execution happens in
// the tools node below (so we can capture hits into graph state).
const searchToolDef = tool(async () => '', {
  name: 'search_docs',
  description:
    'Search the product documentation and source code for relevant information. ' +
    'Call it multiple times with different keywords/synonyms or likely technical terms ' +
    'if the first results are not enough.',
  schema: z.object({
    query: z.string().describe('Search keywords or a short phrase.'),
  }),
});

const llmWithTools = chatModel.bindTools([searchToolDef]);

const AGENT_SYSTEM = `${appConfig.prompts.system}

You can use the "search_docs" tool to look things up before answering:
- Always search at least once; never answer from assumptions.
- Do NOT say "I don't have information" after a single search. If the first results don't contain the answer, you MUST try at least 1-2 more searches for the underlying TECHNICAL MECHANISM, not the user's wording. A user symptom maps to an implementation term:
  * "number not visible / hidden" -> search "encryption", "masking", "privacy"
  * "only on weekends" -> search the specific day names, the feature/format slug
  * "can't log in" -> search "auth", "token", "session"
- Only conclude you have no information after 2-3 distinct searches come back empty.
- When you have enough information, stop calling tools and write the final answer following the rules above.`;

const State = Annotation.Root({
  collections: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  messages: Annotation<BaseMessage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  hits: Annotation<SearchHit[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  iterations: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
});
type S = typeof State.State;

async function agent(state: S): Promise<Partial<S>> {
  const res = await llmWithTools.invoke([new SystemMessage(AGENT_SYSTEM), ...state.messages]);
  return { messages: [res], iterations: state.iterations + 1 };
}

async function tools(state: S): Promise<Partial<S>> {
  const last = state.messages.at(-1) as AIMessage;
  const calls = last.tool_calls ?? [];
  const { topK, minScore, mode } = appConfig.retrieval;
  const msgs: BaseMessage[] = [];
  const collected: SearchHit[] = [];

  for (const call of calls) {
    const query = String((call.args as { query?: string }).query ?? '').trim();
    const hits = query
      ? await search(query, topK, {
          collections: state.collections,
          mode,
          minScore,
          lexicalTerms: [query],
        })
      : [];
    collected.push(...hits);
    log.debug(`search "${query}" -> ${hits.length} hits`);
    const content = hits.length
      ? hits.map((h, i) => `[${i + 1}] (${h.path})\n${h.content}`).join('\n\n')
      : 'No results found.';
    msgs.push(new ToolMessage({ content, tool_call_id: call.id ?? '' }));
  }
  return { messages: msgs, hits: collected };
}

async function finalize(state: S): Promise<Partial<S>> {
  // Iteration cap reached while still requesting tools — force an answer.
  const res = await chatModel.invoke([
    new SystemMessage(AGENT_SYSTEM),
    ...state.messages,
    new HumanMessage('Answer now using the information gathered above. Do not call any tools.'),
  ]);
  return { messages: [res] };
}

function route(state: S): 'tools' | 'finalize' | typeof END {
  const last = state.messages.at(-1) as AIMessage;
  const wantsTools = (last.tool_calls?.length ?? 0) > 0;
  if (!wantsTools) return END;
  return state.iterations < MAX_ITERS ? 'tools' : 'finalize';
}

const compiled = new StateGraph(State)
  .addNode('agent', agent)
  .addNode('tools', tools)
  .addNode('finalize', finalize)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', route, { tools: 'tools', finalize: 'finalize', [END]: END })
  .addEdge('tools', 'agent')
  .addEdge('finalize', END)
  .compile();

export interface AgenticResult {
  answer: string;
  sources: string[];
  hits: SearchHit[];
}

export async function runAgenticGraph(
  question: string,
  collections: string[] = [],
): Promise<AgenticResult> {
  const out = await compiled.invoke({ collections, messages: [new HumanMessage(question)] });
  const last = out.messages.at(-1);
  const answer = typeof last?.content === 'string' ? last.content : String(last?.content ?? '');
  const sources = [...new Set(out.hits.map((h) => h.path))];
  return { answer, sources, hits: out.hits };
}
