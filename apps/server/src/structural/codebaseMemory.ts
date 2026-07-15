// codebase-memory-mcp adapter — polyglot (TS/Go/…) code graph via tree-sitter +
// hybrid LSP type resolution. Real edges where cxpak came up empty (7069 nodes /
// 17868 edges on crm-front). Deterministic one-shot CLI (`cli <tool> '<json>'`);
// log lines and the JSON result share stdout, so we take the last JSON line.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { StructuralProvider, SymbolHit } from './types.js';

const execFileP = promisify(execFile);

const BIN =
  process.env.CMEM_BIN ?? resolve(process.cwd(), 'node_modules/.bin/codebase-memory-mcp');

// Project id scheme used by the tool: absolute path, leading slash stripped, '/'→'-'.
function projectFor(root: string): string {
  return resolve(root).replace(/^\/+/, '').replace(/\//g, '-');
}

async function runCli(tool: string, payload: unknown): Promise<Record<string, unknown>> {
  const { stdout } = await execFileP(BIN, ['cli', tool, JSON.stringify(payload)], {
    maxBuffer: 128 * 1024 * 1024,
    timeout: 180_000,
  });
  // Skip log/warning lines; the result is the last standalone JSON object.
  const jsonLine = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{') || l.startsWith('['))
    .pop();
  if (!jsonLine) throw new Error(`no JSON output from codebase-memory ${tool}`);
  return JSON.parse(jsonLine) as Record<string, unknown>;
}

function mapHit(r: Record<string, unknown>): SymbolHit {
  return {
    name: String(r.name ?? ''),
    qualifiedName: String(r.qualified_name ?? ''),
    label: String(r.label ?? ''),
    filePath: String(r.file_path ?? ''),
    inDegree: Number(r.in_degree ?? 0),
    outDegree: Number(r.out_degree ?? 0),
  };
}

export const codebaseMemoryProvider: StructuralProvider = {
  id: 'codebase-memory',

  async index(root) {
    const r = await runCli('index_repository', { repo_path: resolve(root) });
    return {
      project: String(r.project ?? projectFor(root)),
      nodes: Number(r.nodes ?? 0),
      edges: Number(r.edges ?? 0),
    };
  },

  async search(root, pattern, opts = {}) {
    const r = await runCli('search_graph', {
      project: projectFor(root),
      name_pattern: pattern,
      ...(opts.label ? { label: opts.label } : {}),
      limit: opts.limit ?? 20,
    });
    const results = Array.isArray(r.results) ? (r.results as Record<string, unknown>[]) : [];
    return results.map(mapHit);
  },

  async callers(root, functionName) {
    const r = await runCli('trace_path', {
      project: projectFor(root),
      function_name: functionName,
      direction: 'in',
    });
    // Shape varies; collect any node-like arrays defensively.
    const arrays = ['callers', 'nodes', 'results', 'path'].flatMap((k) =>
      Array.isArray(r[k]) ? (r[k] as Record<string, unknown>[]) : [],
    );
    return arrays.filter((n) => n && typeof n === 'object' && 'name' in n).map(mapHit);
  },
};
