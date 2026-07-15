// File grouping for doc generation. A group = one package's files (seed, fed
// whole) plus the feature-relevant chunks of its graph neighbours (related),
// so cross-file rules are synthesized. Without a structural provider it falls
// back to plain directory groups. For Go, goda supplies the package graph;
// neighbour files contribute only chunks matching the feature keyword (so a huge
// shared file like rabbitmq/client.go contributes just its webhook consumer, not
// all 40 handlers).
import { readdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, relative, dirname, extname, basename } from 'node:path';
import { chunkCode } from '../rag/chunker.js';
import { getStructuralProvider } from '../structural/index.js';
import type { StructuralProviderId } from '../structural/types.js';
import { logger } from '../lib/logger.js';

const log = logger.child('docgen-group');

const CODE_EXT = new Set([
  '.go', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.java', '.rs',
]);
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'vendor', 'dist', 'build', '.next', 'testdata', 'mocks', 'docs',
]);

function isGenerated(name: string): boolean {
  return (
    name.endsWith('.d.ts') ||
    name.endsWith('_test.go') ||
    name.endsWith('.test.ts') ||
    name.endsWith('.test.tsx') ||
    name.includes('.gen.') ||
    name.includes('mock')
  );
}

async function* walkCode(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) yield* walkCode(full);
    } else if (CODE_EXT.has(extname(entry.name).toLowerCase()) && !isGenerated(entry.name)) {
      yield full;
    }
  }
}

export interface FileGroup {
  name: string;
  seedFiles: string[]; // the package's own files (fed whole)
  relatedFiles: string[]; // graph-neighbour files (fed as keyword-matching chunks only)
  keyword: string; // feature keyword (seed directory name)
}

async function filesByDir(root: string): Promise<Map<string, string[]>> {
  const byDir = new Map<string, string[]>();
  for await (const file of walkCode(root)) {
    const dir = dirname(relative(root, file)) || '.';
    const list = byDir.get(dir) ?? [];
    list.push(file);
    byDir.set(dir, list);
  }
  return byDir;
}

function goModule(root: string): string | null {
  try {
    const m = readFileSync(join(root, 'go.mod'), 'utf8').match(/^module\s+(\S+)/m);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

export async function groupFiles(root: string, providerId: StructuralProviderId): Promise<FileGroup[]> {
  const byDir = await filesByDir(root);
  const nameOf = (dir: string) => (dir === '.' ? basename(root) : dir.replace(/[/\\]+/g, '-'));
  const kwOf = (dir: string) => (dir === '.' ? basename(root) : basename(dir));
  const base = (): FileGroup[] =>
    [...byDir.entries()].map(([dir, files]) => ({
      name: nameOf(dir),
      seedFiles: files,
      relatedFiles: [],
      keyword: kwOf(dir),
    }));

  // Graph-augmented grouping is currently implemented for Go via goda.
  if (providerId !== 'goda') return base();
  const provider = getStructuralProvider('goda');
  const modulePath = goModule(root);
  if (!provider?.packageGraph || !modulePath) return base();

  let graph;
  try {
    graph = await provider.packageGraph(root);
  } catch (err) {
    log.warn(`goda grouping failed (${(err as Error).message}) — using directory groups`);
    return base();
  }

  const pkgOf = (dir: string) => (dir === '.' ? modulePath : `${modulePath}/${dir.replace(/\\/g, '/')}`);
  const dirOf = (pkg: string): string | null =>
    pkg === modulePath ? '.' : pkg.startsWith(`${modulePath}/`) ? pkg.slice(modulePath.length + 1) : null;

  const groups: FileGroup[] = [];
  for (const [dir, files] of byDir.entries()) {
    const pkg = pkgOf(dir);
    const neighbours = new Set([
      ...(graph.dependencies.get(pkg) ?? []),
      ...(graph.dependents.get(pkg) ?? []),
    ]);
    const related: string[] = [];
    for (const np of neighbours) {
      const nd = dirOf(np);
      if (nd && nd !== dir) related.push(...(byDir.get(nd) ?? []));
    }
    groups.push({ name: nameOf(dir), seedFiles: files, relatedFiles: related, keyword: kwOf(dir) });
  }
  return groups;
}

/** Assemble a group's code blob: seed files whole + keyword-matching chunks of neighbours. */
export async function buildGroupBlob(group: FileGroup, maxChars: number): Promise<string> {
  let blob = '';
  const seedBudget = Math.floor(maxChars * 0.7);
  for (const f of group.seedFiles) {
    const text = await readFile(f, 'utf8');
    if (blob.length + text.length > seedBudget && blob) break;
    blob += `// FILE: ${basename(f)}\n${text}\n\n`;
  }

  const kw = group.keyword.toLowerCase();
  if (group.relatedFiles.length > 0 && kw.length >= 3) {
    outer: for (const f of group.relatedFiles) {
      const text = await readFile(f, 'utf8');
      for (const c of chunkCode(text, extname(f))) {
        // Include a neighbour chunk only if its DECLARATION name mentions the feature
        // keyword — tight enough to pull e.g. StartWebhookConsumer while dropping code
        // that merely references the feature in passing.
        const decl =
          c.content.split('\n').find((l) => /^\s*(func|type|class|interface|export|const|var)\b/.test(l)) ??
          '';
        if (!decl.toLowerCase().includes(kw)) continue;
        if (blob.length + c.content.length > maxChars) break outer;
        blob += `// RELATED (${basename(f)}):\n${c.content}\n\n`;
      }
    }
  }
  return blob;
}
