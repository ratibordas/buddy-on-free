#!/usr/bin/env bash
# Set up the local Python venv used by the AST code chunker (scripts/ast_chunk.py).
# Optional: without it, indexing falls back to the structure-aware chunker.
# Run from apps/server/.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 -m venv .venv-ast
./.venv-ast/bin/pip install -q --upgrade pip
./.venv-ast/bin/pip install -q \
  "tree-sitter>=0.23,<0.26" \
  tree-sitter-go \
  tree-sitter-python \
  tree-sitter-javascript \
  tree-sitter-typescript

echo "AST venv ready at apps/server/.venv-ast"
