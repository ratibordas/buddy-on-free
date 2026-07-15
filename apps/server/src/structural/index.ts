// Registry: map a configured provider id to an adapter.
//   goda            — Go package graph (implemented)
//   gograph         — Go SSA call-graph / implementers (TODO: install + adapter)
//   codebase-memory — polyglot (Go+TS) tree-sitter+LSP graph (TODO: install + adapter)
import type { StructuralProvider, StructuralProviderId } from './types.js';
import { godaProvider } from './goda.js';
import { codebaseMemoryProvider } from './codebaseMemory.js';
import { logger } from '../lib/logger.js';

const log = logger.child('structural');

export function getStructuralProvider(id: StructuralProviderId): StructuralProvider | null {
  switch (id) {
    case 'goda':
      return godaProvider;
    case 'codebase-memory':
      return codebaseMemoryProvider;
    case 'gograph':
      log.warn('structural provider "gograph" not wired yet — install GoGraph and add its adapter');
      return null;
    case 'none':
    default:
      return null;
  }
}

export type { StructuralProvider, StructuralProviderId, PackageGraph } from './types.js';
