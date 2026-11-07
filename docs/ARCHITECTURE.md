# Architecture

`@trysac/monorepo-graph` is designed as a standalone, dependency-free library for querying and computing dependency graphs in JavaScript monorepos.

## Core Principles

1. **Separation of Graph Math from I/O**:
   `src/graph.ts` contains pure functions operating on plain objects (`Graph`, `Edge`). No file system calls, child processes, or node modules are used in graph computation.

2. **Abstract Workspace Discovery**:
   `src/workspace.ts` interacts with monorepo directories strictly through the `WorkspaceFs` interface (`readFile`, `listDirs`). This allows testing with in-memory filesystems and running in browsers or worker environments.

3. **Deterministic Kahn's Ordering**:
   `topoOrder` sorts zero-in-degree ready queues by lexicographical code-unit order at every step, guaranteeing identical ordering across platforms.

4. **Tarjan's SCC Cycle Detection**:
   Cycle analysis detects both multi-node circular chains and self-loops, reporting clear cycle paths when `topoOrder` fails.
