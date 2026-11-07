# Separation of pure graph queries from filesystem discovery

Status: accepted (generated, pending human review)

## Context

Monorepo tools often couple manifest parsing and topological sorting directly to Node.js filesystem operations, preventing reuse in custom runners, browsers, or test fixtures.

## Decision

Isolate all graph construction and query logic into pure functions operating on plain readonly data objects, abstracting file system interactions behind the WorkspaceFs interface and keeping runtime dependencies empty.

## Consequences

Graph operations can be thoroughly tested with in-memory records and run deterministically in any JavaScript environment without filesystem access.
