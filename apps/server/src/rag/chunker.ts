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

interface CodeChunkOptions {
  maxChars?: number;
  overlapLines?: number;
}

// Code chunker: split by lines into bounded-size windows with an overlap of a
// few lines. Line boundaries are never broken — this keeps a chunk readable and
// preserves local context (a whole function/block more often lands in one chunk).
export function chunkCode(text: string, opts: CodeChunkOptions = {}): Chunk[] {
  const maxChars = opts.maxChars ?? 1200;
  const overlapLines = opts.overlapLines ?? 12;

  // Extra-long lines (minified code, large single-line JSON) are force-split —
  // otherwise the chunk won't fit into the embedder's context.
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length <= maxChars) {
      lines.push(line);
    } else {
      for (let i = 0; i < line.length; i += maxChars) lines.push(line.slice(i, i + maxChars));
    }
  }

  const chunks: string[] = [];
  let buffer: string[] = [];
  let size = 0;

  const flush = (): void => {
    const content = buffer.join('\n').trim();
    if (content) chunks.push(content);
  };

  for (const line of lines) {
    if (size + line.length > maxChars && buffer.length > 0) {
      flush();
      buffer = buffer.slice(-overlapLines); // overlap for context
      size = buffer.reduce((n, l) => n + l.length + 1, 0);
    }
    buffer.push(line);
    size += line.length + 1;
  }
  flush();

  return chunks.map((content, index) => ({ index, content }));
}
