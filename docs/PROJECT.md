# Project Record

## Objective
Provide a lightweight, deterministic monorepo dependency graph builder without pulling in complex orchestration frameworks.

## Scope
- Parsing `package.json` manifests into a directed graph.
- Dependency resolution across `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies`.
- Computing topological order, cycle detection, transitive dependents, and affected package sets.
- Exporting to Graphviz DOT format.
- Workspace discovery via `package.json` workspaces fields.
- CLI interface supporting `order`, `cycles`, `affected`, and `dot` commands.

## Out of Scope
- pnpm-workspace.yaml, lockfile parsing, task running, caching, and version bumping.

## Factory run u173 (measured from API usage)

| Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|
| generation | gemini-3.8-flash | yes | 4613 | 16069 | 0 | 0 | 0.0319 |
| fix-1 | gemini-3.8-flash | no | 99975 | 1178 | 0 | 1107257 | 0.1624 |
| fix-2 | gemini-3.8-flash | no | 45879 | 2777 | 0 | 206134 | 0.0603 |
| fix-3 | gemini-3.8-flash | no | 29864 | 776 | 0 | 89495 | 0.0320 |
| fix-4 | gemini-3.8-flash | no | 47689 | 753 | 0 | 171359 | 0.0514 |
| audit | gemini-3.1-flash-lite | no | 42978 | 667 | 0 | 93424 | 0.0141 |
| docs | gemini-3.1-flash-lite | no | 23867 | 1269 | 0 | 0 | 0.0079 |

Total: $0.3600. Prices: Anthropic list prices.
