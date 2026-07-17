// Notion connector: pulls pages (a whole database, or every page shared with the
// integration) and normalizes their blocks to markdown so the RAG index can treat
// them like any other docs collection. Auth is an internal-integration token in
// .env (NOTION_TOKEN); the pages/databases must be shared with that integration.
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import type { DocRecord } from '../indexer.js';

const log = logger.child('notion');
const API = 'https://api.notion.com/v1';

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.NOTION_TOKEN}`,
    'Notion-Version': config.NOTION_API_VERSION,
    'Content-Type': 'application/json',
  };
}

async function api(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Notion ${path} → ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json();
}

// One page of results from a database query / global search.
async function* listPages(database?: string): AsyncGenerator<{ id: string; title: string }> {
  let cursor: string | undefined;
  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    let data: any;
    if (database) {
      data = await api(`/databases/${database}/query`, body);
    } else {
      body.filter = { value: 'page', property: 'object' };
      data = await api('/search', body);
    }
    for (const page of data.results ?? []) {
      if (page.object !== 'page') continue;
      yield { id: page.id, title: pageTitle(page) };
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
}

// Notion has no single "title" field — find the title-typed property.
function pageTitle(page: any): string {
  const props = page.properties ?? {};
  for (const key of Object.keys(props)) {
    const p = props[key];
    if (p?.type === 'title') return richText(p.title) || 'Untitled';
  }
  return 'Untitled';
}

function richText(rt: any[] | undefined): string {
  return (rt ?? []).map((t) => t.plain_text ?? '').join('');
}

// Convert a page's block tree to markdown. Recurses into nested blocks.
async function blocksToMarkdown(blockId: string, depth = 0): Promise<string> {
  if (depth > 4) return ''; // guard against pathological nesting
  let out = '';
  let cursor: string | undefined;
  do {
    const q = cursor ? `?start_cursor=${cursor}&page_size=100` : '?page_size=100';
    const data = await api(`/blocks/${blockId}/children${q}`);
    for (const b of data.results ?? []) {
      out += renderBlock(b);
      if (b.has_children) out += await blocksToMarkdown(b.id, depth + 1);
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return out;
}

function renderBlock(b: any): string {
  const t = b.type;
  const text = richText(b[t]?.rich_text);
  switch (t) {
    case 'heading_1':
      return `\n# ${text}\n\n`;
    case 'heading_2':
      return `\n## ${text}\n\n`;
    case 'heading_3':
      return `\n### ${text}\n\n`;
    case 'bulleted_list_item':
      return `- ${text}\n`;
    case 'numbered_list_item':
      return `1. ${text}\n`;
    case 'to_do':
      return `- [${b.to_do?.checked ? 'x' : ' '}] ${text}\n`;
    case 'quote':
      return `> ${text}\n\n`;
    case 'callout':
      return `> ${text}\n\n`;
    case 'code':
      return `\n\`\`\`\n${text}\n\`\`\`\n\n`;
    case 'paragraph':
      return text ? `${text}\n\n` : '';
    default:
      return text ? `${text}\n\n` : '';
  }
}

/** Yield each Notion page as a markdown document keyed by its page id. */
export async function* fetchNotion(opts: { database?: string }): AsyncGenerator<DocRecord> {
  if (!config.NOTION_TOKEN) {
    throw new Error('NOTION_TOKEN is not set — cannot index a Notion source');
  }
  let n = 0;
  for await (const page of listPages(opts.database)) {
    const body = await blocksToMarkdown(page.id);
    n++;
    yield { path: page.id, content: `# ${page.title}\n\n${body}`.trim() };
  }
  log.info(`fetched ${n} Notion page(s)`);
}
