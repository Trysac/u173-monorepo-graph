/**
 * Dependency kind matching package.json dependency fields in precedence order.
 */
export type DependencyKind =
  | "dependencies"
  | "devDependencies"
  | "peerDependencies"
  | "optionalDependencies";

/**
 * A directed dependency edge between two packages in the workspace.
 */
export interface Edge {
  readonly from: string;
  readonly to: string;
  readonly kind: DependencyKind;
}

/**
 * Workspace dependency graph representation.
 */
export interface Graph {
  readonly packages: string[];
  readonly paths: Record<string, string>;
  readonly edges: Edge[];
}

/**
 * Error codes emitted by GraphError.
 */
export type GraphErrorCode =
  | "invalid_manifest"
  | "manifest_too_large"
  | "duplicate_package"
  | "unknown_package"
  | "cycle"
  | "unsupported_pattern";

/**
 * Typed error for workspace graph operations.
 */
export class GraphError extends Error {
  readonly code: GraphErrorCode;

  constructor(code: GraphErrorCode, message: string) {
    super(message);
    this.name = "GraphError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Minimal file system abstraction for workspace discovery.
 */
export interface WorkspaceFs {
  readFile(path: string): Promise<string | null>;
  listDirs(path: string): Promise<string[]>;
}
