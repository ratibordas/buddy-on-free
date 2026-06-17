// LangGraph graph for the first-line support: retrieve -> generate.
//
//   question --> [retrieve] --(RAG hits)--> [generate] --> answer + sources
//
// RAG search comes from rag/search (our pgvector), generation — ChatOllama.
import { Annotation, StateGraph } from '@langchain/langgraph';
import { ChatOllama } from '@langchain/ollama';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { search, type SearchHit } from '../rag/search.js';

const log = logger.child('graph');

// Hits below this score are considered irrelevant and not put into the context —
// so the model doesn't "make up" an answer from noisy matches.
const MIN_SCORE = 0.35;

const llm = new ChatOllama({
  baseUrl: config.OLLAMA_BASE_URL,
  model: config.OLLAMA_CHAT_MODEL,
  temperature: 0.1,
});

const GraphState = Annotation.Root({
  question: Annotation<string>(),
  collections: Annotation<string[]>({ reducer: (_, next) => next, default: () => [] }),
  hits: Annotation<SearchHit[]>({ reducer: (_, next) => next, default: () => [] }),
  answer: Annotation<string>({ reducer: (_, next) => next, default: () => '' }),
  sources: Annotation<string[]>({ reducer: (_, next) => next, default: () => [] }),
});

type State = typeof GraphState.State;

async function retrieve(state: State): Promise<Partial<State>> {
  const hits = (await search(state.question, 5, { collections: state.collections })).filter(
    (h) => h.score >= MIN_SCORE,
  );
  log.debug(`retrieve: ${hits.length} relevant hits`);
  return { hits };
}

const SYSTEM_PROMPT = `You are a first-line support assistant. Answer the user's question using ONLY the documentation context provided.
Rules:
- If the context does not contain the answer, say you don't have that information and suggest contacting human support. Never invent details.
- Be concise and practical; prefer concrete steps.
- Base every statement on the context.`;

async function generate(state: State): Promise<Partial<State>> {
  const { question, hits } = state;

  if (hits.length === 0) {
    return {
      answer:
        "I don't have information about that in the documentation. Please contact with our support.",
      sources: [],
    };
  }

  const context = hits.map((h, i) => `[${i + 1}] (${h.path})\n${h.content}`).join('\n\n');
  const user = `Documentation context:\n${context}\n\nQuestion: ${question}`;

  const res = await llm.invoke([new SystemMessage(SYSTEM_PROMPT), new HumanMessage(user)]);
  const answer = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
  const sources = [...new Set(hits.map((h) => h.path))];

  return { answer, sources };
}

const workflow = new StateGraph(GraphState)
  .addNode('retrieve', retrieve)
  .addNode('generate', generate)
  .addEdge('__start__', 'retrieve')
  .addEdge('retrieve', 'generate')
  .addEdge('generate', '__end__');

const compiled = workflow.compile();

export interface SupportResult {
  answer: string;
  sources: string[];
  hits: SearchHit[];
}

export async function runSupportGraph(
  question: string,
  collections: string[] = [],
): Promise<SupportResult> {
  const out = await compiled.invoke({ question, collections });
  return { answer: out.answer, sources: out.sources, hits: out.hits };
}
