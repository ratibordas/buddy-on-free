#!/usr/bin/env python3
"""AST code chunker: one chunk per top-level declaration (whole function/class),
comments attached to the following declaration, small ones merged, big ones split
by lines. Prints a JSON array [{"index", "content"}] to stdout.

Usage: ast_chunk.py <file-path> <ext>
Empty output ([]) or non-zero exit → caller falls back to its own chunker.
"""
import sys
import json

EXT_MODULE = {
    ".go": "tree_sitter_go",
    ".py": "tree_sitter_python",
    ".js": "tree_sitter_javascript",
    ".jsx": "tree_sitter_javascript",
    ".mjs": "tree_sitter_javascript",
    ".cjs": "tree_sitter_javascript",
    ".ts": "tree_sitter_typescript",
    ".tsx": "tree_sitter_typescript",
}
MERGE_TARGET = 1200
HARD_MAX = 1800


def get_language(ext):
    name = EXT_MODULE.get(ext)
    if not name:
        return None
    from tree_sitter import Language
    mod = __import__(name)
    if name == "tree_sitter_typescript":
        fn = mod.language_tsx if ext == ".tsx" else mod.language_typescript
        return Language(fn())
    return Language(mod.language())


def chunk_by_lines(text):
    out, buf, size = [], [], 0

    def flush():
        c = "\n".join(buf).strip()
        if c:
            out.append(c)

    for ln in text.split("\n"):
        if size + len(ln) > MERGE_TARGET and buf:
            flush()
            buf = buf[-10:]
            size = sum(len(l) + 1 for l in buf)
        buf.append(ln)
        size += len(ln) + 1
    flush()
    return out


def main():
    path, ext = sys.argv[1], sys.argv[2]
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        src = f.read()

    lang = get_language(ext)
    if lang is None:
        print("[]")
        return

    from tree_sitter import Parser

    data = src.encode("utf-8")
    tree = Parser(lang).parse(data)
    root = tree.root_node
    if root.named_child_count == 0:
        print("[]")
        return

    chunks, pending, buffer = [], "", ""

    def flush():
        nonlocal buffer
        if buffer.strip():
            chunks.append(buffer.strip())
        buffer = ""

    for child in root.named_children:
        text = data[child.start_byte:child.end_byte].decode("utf-8", errors="replace")
        if "comment" in child.type:
            pending = (pending + "\n" + text) if pending else text
            continue
        unit = (pending + "\n" + text) if pending else text
        pending = ""
        if len(unit) > HARD_MAX:
            flush()
            chunks.extend(chunk_by_lines(unit))
        else:
            if len(buffer) + len(unit) > MERGE_TARGET:
                flush()
            buffer += ("\n\n" + unit) if buffer else unit
    if pending.strip():
        buffer += ("\n\n" + pending) if buffer else pending
    flush()

    print(json.dumps([{"index": i, "content": c} for i, c in enumerate(chunks)]))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 — any failure signals fallback
        sys.stderr.write(str(e))
        sys.exit(1)
