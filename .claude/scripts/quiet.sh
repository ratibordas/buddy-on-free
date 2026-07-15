#!/usr/bin/env bash
# Run a noisy command quietly: hide output on success, show the tail on failure.
# Usage: .claude/scripts/quiet.sh <command> [args...]
#   e.g. .claude/scripts/quiet.sh npm run typecheck
set -o pipefail
tmp="$(mktemp)"
if "$@" >"$tmp" 2>&1; then
  echo "✓ $*"
  rm -f "$tmp"
else
  code=$?
  echo "✗ $* (exit $code)"
  tail -n 40 "$tmp"
  rm -f "$tmp"
  exit "$code"
fi
