import { GraphError, type WorkspaceFs } from "./types.js";

const ROOT_MAX_SIZE = 1_048_576;

function normalizeSlash(p: string): string {
  return p.replace(/\\/g, "/");
}

function joinPosix(base: string, child: string): string {
  const cleanBase = base.replace(/\/+$/, "");
  const cleanChild = child.replace(/^\/+/, "");
  if (!cleanBase) return cleanChild;
  if (!cleanChild) return cleanBase;
  return `${cleanBase}/${cleanChild}`;
}

/**
 * Validates a glob-like workspace pattern according to specification rules.
 * Accepted:
 * - literal relative path (e.g. 'libs/core', 'packages/a')
 * - path whose last segment is exactly '*' (e.g. 'packages/*')
 * Unsupported:
 * - paths with '..'
 * - '**', '?', braces '{', '}', negation '!'
 */
function validateWorkspacePattern(pattern: string): { isWildcard: boolean; dirPath: string } {
  if (typeof pattern !== "string") {
    throw new GraphError(
      "unsupported_pattern",
      `workspace pattern must be a string: ${String(pattern)}`,
    );
  }

  const norm = normalizeSlash(pattern.trim());
  if (
    norm === "" ||
    norm.includes("..") ||
    norm.includes("**") ||
    norm.includes("?") ||
    norm.includes("{") ||
    norm.includes("}") ||
    norm.startsWith("!")
  ) {
    throw new GraphError("unsupported_pattern", `unsupported workspace pattern: "${pattern}"`);
  }

  const segments = norm.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new GraphError("unsupported_pattern", `empty workspace pattern: "${pattern}"`);
  }

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (seg?.includes("*")) {
      throw new GraphError(
        "unsupported_pattern",
        `wildcard is only allowed as the last segment: "${pattern}"`,
      );
    }
  }

  const last = segments[segments.length - 1] ?? "";
  if (last.includes("*")) {
    if (last !== "*") {
      throw new GraphError(
        "unsupported_pattern",
        `only exact wildcard '*' is allowed: "${pattern}"`,
      );
    }
    const parent = segments.slice(0, -1).join("/");
    return { isWildcard: true, dirPath: parent };
  }

  return { isWildcard: false, dirPath: segments.join("/") };
}

/**
 * Load workspace manifests given an abstract file system and workspace root path.
 *
 * Reads root/package.json;
 * `workspaces` can be an array of patterns or an object with a `packages` array.
 * Discovers candidate directories, skips directories without package.json,
 * and returns a map of normalized relative paths to package.json contents.
 */
export async function loadWorkspace(
  fs: WorkspaceFs,
  root: string,
): Promise<Record<string, string>> {
  const normalizedRoot = normalizeSlash(root.trim());
  const rootManifestPath = joinPosix(normalizedRoot, "package.json");
  const rootContent = await fs.readFile(rootManifestPath);

  if (rootContent === null) {
    throw new GraphError(
      "invalid_manifest",
      `root package.json not found at "${rootManifestPath}"`,
    );
  }
  if (rootContent.length > ROOT_MAX_SIZE) {
    throw new GraphError(
      "manifest_too_large",
      `root manifest at "${rootManifestPath}" exceeds maximum size`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rootContent);
  } catch (cause) {
    throw new GraphError(
      "invalid_manifest",
      `invalid JSON in root manifest at "${rootManifestPath}": ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GraphError(
      "invalid_manifest",
      `root manifest at "${rootManifestPath}" must be a JSON object`,
    );
  }

  const rootPkg = parsed as { workspaces?: unknown };
  let patternList: unknown[] = [];

  if (Array.isArray(rootPkg.workspaces)) {
    patternList = rootPkg.workspaces;
  } else if (
    rootPkg.workspaces &&
    typeof rootPkg.workspaces === "object" &&
    Array.isArray((rootPkg.workspaces as { packages?: unknown }).packages)
  ) {
    patternList = (rootPkg.workspaces as { packages: unknown[] }).packages;
  } else {
    return {};
  }

  const candidateDirs = new Set<string>();

  for (const rawPattern of patternList) {
    if (typeof rawPattern !== "string") {
      throw new GraphError(
        "unsupported_pattern",
        `workspace pattern must be a string, got ${typeof rawPattern}`,
      );
    }
    const { isWildcard, dirPath } = validateWorkspacePattern(rawPattern);
    if (isWildcard) {
      const scanPath = dirPath ? joinPosix(normalizedRoot, dirPath) : normalizedRoot;
      let subdirs: string[] = [];
      try {
        subdirs = await fs.listDirs(scanPath);
      } catch {
        subdirs = [];
      }
      const sortedSubdirs = [...subdirs].sort();
      for (const subdir of sortedSubdirs) {
        const relDir = dirPath ? joinPosix(dirPath, subdir) : subdir;
        candidateDirs.add(relDir);
      }
    } else {
      candidateDirs.add(dirPath);
    }
  }

  const sortedCandidates = Array.from(candidateDirs).sort();
  const result: Record<string, string> = {};

  for (const dir of sortedCandidates) {
    const relManifest = joinPosix(dir, "package.json");
    const fullManifest = joinPosix(normalizedRoot, relManifest);
    let content: string | null = null;
    try {
      content = await fs.readFile(fullManifest);
    } catch {
      content = null;
    }
    if (content !== null) {
      result[relManifest] = content;
    }
  }

  return result;
}
