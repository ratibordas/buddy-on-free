# AI-assisted development (optional)

Tooling for developing **buddy-on itself** with AI agents (Claude Code). Nothing
here affects the build or runtime — skip if you don't use agents. This is about
the *coding agent*, not the support bot's runtime.

Shared agent config: `CLAUDE.md` (rules), `.claude/settings.json` (hooks +
permissions), `.claude/skills/token-diet`, `.claude/scripts/quiet.sh`.

- **Hooks**: block editing generated/built artifacts (`dist/`, `node_modules/`,
  Prisma client); auto-Prettier on `.ts`/`.tsx` if Prettier is installed. Secrets
  (`.env`, `*.pem`, `*.key`) are read/edit-denied.
- **token-diet skill**: frugal mode (`/token-diet`) — quiet.sh for noisy commands,
  `npm run typecheck` as the gate, offset/limit reads, Explore for search.

## Structural / code-graph tooling (for the product's structural layer)

Retrieval (semantic) is handled in-repo: docs by the markdown chunker, code by an
**AST chunker** (`scripts/ast_chunk.py`, tree-sitter via a local venv → our
pgvector). Structural/impact questions ("who depends on X", "all implementers")
need a **deterministic code graph**, provided per-codebase (config `sources[].structural`):

| Language | Tool | Status |
|---|---|---|
| Go | **goda** (`go install github.com/loov/goda@latest`) | ✅ package dependency graph; Go-native (`go/packages`), compiler-accurate. Adapter `src/structural/goda.ts` (verified: crm-api, 85 pkgs, impact works). |
| Go | **GoGraph** (`brew install ozgurcd/tap/gograph`) | SSA call-graph: callers/callees/impact/`implementers`. Richer; adapter TODO. |
| TS / polyglot | **codebase-memory-mcp** (npm devDep) | ✅ tree-sitter + LSP; adapter `src/structural/codebaseMemory.ts` (verified: crm-front, 7069 nodes / 17868 edges). CLI: `codebase-memory-mcp cli index_repository \| search_graph \| trace_path`. |

> **cxpak was evaluated and dropped for the graph role.** Its dependency graph
> came up empty on both Go and TS in our repos (subgraph edges: 0; `references`
> returned only the definition). Symbol map (`overview`) works, but not the
> call-site/dependency completeness we need. Use the Go-native / LSP tools above.

These are called **deterministically via subprocess/MCP** by the offline pipeline
(docgen grouping, bug-confirmation), not by the small local model per question.
