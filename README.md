# @trysac/monorepo-graph

[![CI](https://github.com/Trysac/u173-monorepo-graph/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u173-monorepo-graph/actions/workflows/ci.yml)

In npm, Yarn or pnpm workspaces, build order, release order and what to test after a change all depend on the internal dependency graph, yet teams keep that knowledge in scripts that miss devDependencies or loop forever on cycles. Full monorepo tools such as Nx or Turborepo bring a whole build system. This library computes the graph and the common queries from manifests alone, deterministically.

## Installation

```bash
npm install @trysac/monorepo-graph
```

## Usage

```typescript
import { buildGraph, topoOrder, affected } from '@trysac/monorepo-graph';

const graph = buildGraph({
  'packages/a/package.json': '{"name":"@x/a","dependencies":{"@x/b":"*"}}',
  'packages/b/package.json': '{"name":"@x/b"}',
});
console.log(topoOrder(graph)); // ['@x/b', '@x/a']
```

## API Summary

### Functions
- `buildGraph(manifests: Record<string, string>): Graph`: Parses manifests. Rejects if JSON is invalid, name is missing, `__proto__` is used, or size > 1 MiB (`manifest_too_large`).
- `topoOrder(graph: Graph): string[]`: Returns sorted topological order. Throws `GraphError('cycle')` if cycles exist.
- `findCycles(graph: Graph): string[][]`: Detects cycles via Tarjan's algorithm.
- `dependents(graph: Graph, name: string, opts?: { transitive?: boolean }): string[]`: Finds packages depending on the target. Throws `unknown_package`.
- `affected(graph: Graph, changed: readonly string[]): string[]`: Computes changed package + transitive dependents.
- `toDot(graph: Graph): string`: Serializes to Graphviz DOT.
- `loadWorkspace(fs: WorkspaceFs, root: string): Promise<Record<string, string>>`: Discovers manifests based on root `package.json` workspaces. Patterns support literal paths or trailing `*`.

### Options & Limits
- Max manifest size: 1,048,576 characters.
- Supported patterns: literal paths and `path/*`.
- Unsupported patterns: `**`, `?`, braces, `!`, or `..` traversals.

## Why not Nx or Turborepo?
This is a dependency-free library for the graph questions alone, avoiding the overhead of heavy orchestration frameworks.

See [Security](docs/SECURITY.md) for detailed threat model.