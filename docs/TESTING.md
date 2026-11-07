# Testing Strategy

## Structure
- `test/graph.test.ts`: Covers graph creation, dependency edge precedence, topological ordering, Tarjan cycle detection, and affected set logic using static manifest data.
- `test/graph-edge.test.ts`: Covers validation edge cases like malformed JSON, duplicate names, huge manifests, and DOT serialization nuances.
- `test/cli.test.ts` & `test/cli-edge.test.ts`: Tests the CLI interface using real filesystem temporary directories, validating command-line flags and exit codes.
- `test/workspace.test.ts` & `test/workspace-edge.test.ts`: Unit tests for `loadWorkspace` using an in-memory mock `WorkspaceFs`, ensuring wildcard expansion and pattern validation work correctly.