export interface Chunk {
  index: number;
  content: string;
}

interface ChunkOptions {
  maxChars?: number;
  overlap?: number;
}

// Simple markdown chunker:
//  1) split on headings (#..######), keeping the heading at the start of the section;
//  2) further split large sections by size with overlap, to avoid breaking context.
export function chunkMarkdown(text: string, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = opts.maxChars ?? 1200;
  const overlap = opts.overlap ?? 200;

  const lines = text.split(/\r?\n/);
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) && current.length > 0) {
      sections.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) sections.push(current.join('\n'));

  const chunks: string[] = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    if (trimmed.length <= maxChars) {
      chunks.push(trimmed);
      continue;
    }

    let start = 0;
    while (start < trimmed.length) {
      const end = Math.min(start + maxChars, trimmed.length);
      const piece = trimmed.slice(start, end).trim();
      if (piece) chunks.push(piece);
      if (end >= trimmed.length) break;
      start = end - overlap; // overlap to preserve context
    }
  }

  return chunks.map((content, index) => ({ index, content }));
}

const MERGE_TARGET = 1200; // merge small consecutive units up to this size
const HARD_MAX = 1800; // a single unit larger than this is split by lines

function splitLongLines(text: string, cap: number): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length <= cap) out.push(line);
    else for (let i = 0; i < line.length; i += cap) out.push(line.slice(i, i + cap));
  }
  return out;
}

// Bounded line windows — fallback for a single oversized declaration.
function chunkByLines(lines: string[], maxChars = MERGE_TARGET, overlapLines = 10): string[] {
  const chunks: string[] = [];
  let buffer: string[] = [];
  let size = 0;
  const flush = (): void => {
    const c = buffer.join('\n').trim();
    if (c) chunks.push(c);
  };
  for (const line of lines) {
    if (size + line.length > maxChars && buffer.length > 0) {
      flush();
      buffer = buffer.slice(-overlapLines);
      size = buffer.reduce((n, l) => n + l.length + 1, 0);
    }
    buffer.push(line);
    size += line.length + 1;
  }
  flush();
  return chunks;
}

const isCommentOnly = (block: string): boolean =>
  block.split('\n').every((l) => {
    const t = l.trim();
    return (
      t === '' ||
      t.startsWith('//') ||
      t.startsWith('#') ||
      t.startsWith('*') ||
      t.startsWith('/*') ||
      t.startsWith('*/')
    );
  });

// Group source lines into top-level units: brace-balanced blocks for C-like
// languages, indentation for Python. Heuristic (no full parse) — braces inside
// strings can shift a boundary — but the merge/split bounds keep chunks sane.
function toplevelUnits(lines: string[], python: boolean): string[] {
  const units: string[] = [];
  let cur: string[] = [];

  if (python) {
    const startsTop = (l: string) => /^(async\s+def |def |class |@)/.test(l);
    for (const line of lines) {
      if (startsTop(line) && cur.length > 0) {
        units.push(cur.join('\n'));
        cur = [];
      }
      cur.push(line);
    }
  } else {
    let depth = 0;
    for (const line of lines) {
      cur.push(line);
      for (const ch of line) {
        if (ch === '{') depth++;
        else if (ch === '}') depth = Math.max(0, depth - 1);
      }
      if (depth === 0) {
        units.push(cur.join('\n'));
        cur = [];
      }
    }
  }
  if (cur.length > 0) units.push(cur.join('\n'));
  return units.filter((u) => u.trim() !== '');
}

// Structure-aware code chunker: one chunk per top-level declaration (whole
// function/class/type), doc-comments attached to the following declaration,
// small units merged, oversized ones split by lines. Keeps a function whole —
// which plain line windows don't (and embedding half a function is near-useless).
export function chunkCode(text: string, ext = ''): Chunk[] {
  const lines = splitLongLines(text, MERGE_TARGET);
  const rawUnits = toplevelUnits(lines, ext === '.py');

  const chunks: string[] = [];
  let pending = ''; // comment carry — attach to the next declaration
  let buffer = '';
  const flush = (): void => {
    if (buffer.trim()) chunks.push(buffer.trim());
    buffer = '';
  };

  for (const raw of rawUnits) {
    if (isCommentOnly(raw)) {
      pending += (pending ? '\n' : '') + raw;
      continue;
    }
    const unit = pending ? `${pending}\n${raw}` : raw;
    pending = '';

    if (unit.length > HARD_MAX) {
      flush();
      for (const c of chunkByLines(unit.split('\n'))) chunks.push(c);
    } else {
      if (buffer.length + unit.length > MERGE_TARGET) flush();
      buffer += (buffer ? '\n\n' : '') + unit;
    }
  }
  if (pending.trim()) buffer += (buffer ? '\n\n' : '') + pending;
  flush();

  return chunks.map((content, index) => ({ index, content }));
}
