// Structural analysis providers — deterministic code-graph tools called via
// subprocess. They answer structural/impact questions ("who depends on X",
// "all implementers") that embeddings can't answer with completeness. Used
// offline by the pipeline (docgen grouping, bug-flow), NOT in the model's live
// loop. Chosen per-codebase in buddy.config.yaml. Providers implement only the
// capabilities their tool supports.
export type StructuralProviderId = 'none' | 'goda' | 'gograph' | 'codebase-memory';

export interface PackageGraph {
  packages: string[];
  /** pkg -> intra-repo packages it imports. */
  dependencies: Map<string, string[]>;
  /** pkg -> intra-repo packages that import it (impact / "what breaks"). */
  dependents: Map<string, string[]>;
}

export interface SymbolHit {
  name: string;
  qualifiedName: string;
  label: string; // Function | Class | Interface | Variable | Folder | ...
  filePath: string;
  inDegree: number;
  outDegree: number;
}

export interface StructuralProvider {
  readonly id: StructuralProviderId;
  /** Package-level dependency graph (goda). */
  packageGraph?(root: string): Promise<PackageGraph>;
  /** Build/refresh the tool's own index (codebase-memory). Returns project id + stats. */
  index?(root: string): Promise<{ project: string; nodes: number; edges: number }>;
  /** Search symbols by name pattern (codebase-memory). */
  search?(
    root: string,
    pattern: string,
    opts?: { label?: string; limit?: number },
  ): Promise<SymbolHit[]>;
  /** Callers of a function — impact / "who calls" (codebase-memory, gograph). */
  callers?(root: string, functionName: string): Promise<SymbolHit[]>;
}
