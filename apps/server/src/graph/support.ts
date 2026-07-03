// LangGraph graph for the first-line support: retrieve -> generate.
//
//   question --> [retrieve] --(RAG hits)--> [generate] --> answer + sources
//
// RAG search comes from rag/search (our pgvector), generation — ChatOllama.
import { Annotation, StateGraph } from '@langchain/langgraph';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { appConfig } from '../config/appConfig.js';
import { logger } from '../lib/logger.js';
import { chatModel } from '../llm/chat.js';
import { expandQuery } from '../rag/expand.js';
import { search, type SearchHit } from '../rag/search.js';
import { runAgenticGraph } from './agentic.js';
import { verifyGrounded, DECLINE } from './guard.js';

const log = logger.child('graph');

const GraphState = Annotation.Root({
  question: Annotation<string>(),
  collections: Annotation<string[]>({ reducer: (_, next) => next, default: () => [] }),
  hits: Annotation<SearchHit[]>({ reducer: (_, next) => next, default: () => [] }),
  answer: Annotation<string>({ reducer: (_, next) => next, default: () => '' }),
  sources: Annotation<string[]>({ reducer: (_, next) => next, default: () => [] }),
});

type State = typeof GraphState.State;

async function retrieve(state: State): Promise<Partial<State>> {
  const { mode, topK, minScore, expandQuery: doExpand } = appConfig.retrieval;
  // Expand the query into keywords for the lexical arm (lexical/hybrid only).
  const lexicalTerms = mode !== 'vector' && doExpand ? await expandQuery(state.question) : [];
  const hits = await search(state.question, topK, {
    collections: state.collections,
    mode,
    minScore,
    lexicalTerms,
  });
  log.debug(`retrieve(${mode}): ${hits.length} hits`);
  return { hits };
}

const SYSTEM_PROMPT = appConfig.prompts.system;

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

  const res = await chatModel.invoke([new SystemMessage(SYSTEM_PROMPT), new HumanMessage(user)]);
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
  // Agentic mode: the model drives its own multi-step retrieval (ReAct loop).
  let result: SupportResult;
  if (appConfig.retrieval.agentic) {
    result = await runAgenticGraph(question, collections);
  } else {
    const out = await compiled.invoke({ question, collections });
    result = { answer: out.answer, sources: out.sources, hits: out.hits };
  }

  // Anti-hallucination: if the answer isn't supported by the retrieved context, decline.
  if (appConfig.retrieval.groundingCheck && result.hits.length > 0) {
    const grounded = await verifyGrounded(result.answer, result.hits);
    if (!grounded) return { answer: DECLINE, sources: [], hits: result.hits };
  }
  return result;
}
