// AST code chunking via a Python tree-sitter helper (subprocess). Node stays the
// orchestrator; real AST parsing is done by scripts/ast_chunk.py in a local venv.
// If the venv/helper is missing or errors, we fall back to the structure-aware
// chunkCode — so indexing works with or without the AST toolchain installed.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { chunkCode, type Chunk } from './chunker.js';
import { logger } from '../lib/logger.js';

const execFileP = promisify(execFile);
const log = logger.child('ast');

// Resolved relative to the server cwd; overridable for Docker/CI.
const PYTHON = process.env.AST_PYTHON ?? resolve(process.cwd(), '.venv-ast/bin/python');
const HELPER = process.env.AST_HELPER ?? resolve(process.cwd(), 'scripts/ast_chunk.py');

const AST_EXT = new Set(['.go', '.py', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
let disabled = false; // set once if the helper/venv is absent — stop spawning

export async function chunkCodeAst(filePath: string, raw: string, ext: string): Promise<Chunk[]> {
  if (disabled || !AST_EXT.has(ext)) return chunkCode(raw, ext);
  try {
    const { stdout } = await execFileP(PYTHON, [HELPER, filePath, ext], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 20_000,
    });
    const parsed = JSON.parse(stdout) as Chunk[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : chunkCode(raw, ext);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      disabled = true;
      log.warn('AST helper/venv not found — using structure-aware chunker (see scripts/setup-ast.sh)');
    } else {
      log.debug(`AST chunk failed for ${filePath}: ${(err as Error).message} — fallback`);
    }
    return chunkCode(raw, ext);
  }
}
