// Confluence connector: pulls the current pages of a space via the REST API and
// converts their storage-format HTML to markdown-ish text for the RAG index.
// Cloud uses Basic auth (email + API token); Server/DC uses a Bearer PAT (leave
// CONFLUENCE_USER empty). Base URL and creds live in .env.
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import type { DocRecord } from '../indexer.js';

const log = logger.child('confluence');

function authHeader(): string {
  if (config.CONFLUENCE_USER) {
    const basic = Buffer.from(`${config.CONFLUENCE_USER}:${config.CONFLUENCE_TOKEN}`).toString('base64');
    return `Basic ${basic}`;
  }
  return `Bearer ${config.CONFLUENCE_TOKEN}`;
}

async function api(pathAndQuery: string): Promise<any> {
  const res = await fetch(`${config.CONFLUENCE_BASE_URL}${pathAndQuery}`, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Confluence ${pathAndQuery} → ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return res.json();
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

// Storage format is XHTML. Keep headings/list/paragraph structure as markdown and
// drop the rest of the markup — good enough for chunking + embedding.
function htmlToText(html: string): string {
  return html
    .replace(/<\s*(h[1-6])[^>]*>/gi, (_m, tag: string) => `\n${'#'.repeat(Number(tag[1]))} `)
    .replace(/<\/\s*h[1-6]\s*>/gi, '\n\n')
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|tr|ul|ol|table)\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Yield each Confluence page as a markdown document keyed by its page id. */
export async function* fetchConfluence(opts: { space?: string }): AsyncGenerator<DocRecord> {
  if (!config.CONFLUENCE_BASE_URL || !config.CONFLUENCE_TOKEN) {
    throw new Error('CONFLUENCE_BASE_URL / CONFLUENCE_TOKEN are not set — cannot index a Confluence source');
  }
  const limit = 50;
  let start = 0;
  let n = 0;
  for (;;) {
    const space = opts.space ? `&spaceKey=${encodeURIComponent(opts.space)}` : '';
    const data = await api(
      `/rest/api/content?type=page&status=current${space}&expand=body.storage&limit=${limit}&start=${start}`,
    );
    const results: any[] = data.results ?? [];
    for (const page of results) {
      const html = page.body?.storage?.value ?? '';
      const body = htmlToText(html);
      n++;
      yield { path: String(page.id), content: `# ${page.title ?? 'Untitled'}\n\n${body}`.trim() };
    }
    if (results.length < limit) break;
    start += limit;
  }
  log.info(`fetched ${n} Confluence page(s)`);
}
