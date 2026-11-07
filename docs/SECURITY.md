# Security

## Threat Model

### Defended
- **Resource Exhaustion**: Manifest parsing is strictly limited to 1 MiB per file to prevent memory exhaustion attacks.
- **Prototype Pollution**: Dependency object iteration explicitly filters out `__proto__` keys.
- **Path Traversal**: Workspace discovery rejects any pattern containing `..`, preventing access to files outside the workspace root.
- **Input Validation**: Manifests must be valid JSON objects with a non-empty `name` string; arbitrary structures or recursive dependencies are identified and rejected.

### Not Defended
- **External Content**: This utility does not fetch external resources; security assumes the filesystem provided to `WorkspaceFs` is trusted.