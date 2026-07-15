// goda adapter — Go-native package dependency graph (github.com/loov/goda).
// Uses `go/packages` under the hood → compiler-accurate, unlike tree-sitter graphs
// (which is why cxpak came up empty on Go). Deterministic, local, no LLM.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PackageGraph, StructuralProvider } from './types.js';

const execFileP = promisify(execFile);

export const godaProvider: StructuralProvider = {
  id: 'goda',

  async packageGraph(root: string): Promise<PackageGraph> {
    const { stdout } = await execFileP(
      'goda',
      ['list', '-f', '{{.ID}}|{{range .Imports}}{{.ID}} {{end}}', './...'],
      { cwd: root, maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
    );

    const rows = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [pkgRaw = '', imports = ''] = l.split('|');
        return { pkg: pkgRaw.trim(), imports: imports.trim().split(/\s+/).filter(Boolean) };
      })
      .filter((r) => r.pkg !== '');

    const packages = new Set(rows.map((r) => r.pkg));
    const dependencies = new Map<string, string[]>();
    const dependents = new Map<string, string[]>();
    for (const p of packages) dependents.set(p, []);

    for (const { pkg, imports } of rows) {
      const intra = imports.filter((i) => packages.has(i)); // keep intra-repo edges only
      dependencies.set(pkg, intra);
      for (const dep of intra) dependents.get(dep)?.push(pkg);
    }

    return { packages: [...packages], dependencies, dependents };
  },
};
