import { type DependencyKind, type Edge, type Graph, GraphError } from "./types.js";

const MAX_MANIFEST_SIZE = 1_048_576; // 1 MiB
const DEPENDENCY_KINDS: readonly DependencyKind[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

interface RawPackageJson {
  name?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  optionalDependencies?: unknown;
  [key: string]: unknown;
}

/**
 * Parse and build a dependency graph from a map of package.json paths to their string contents.
 *
 * @param manifests - Map of relative package.json file paths to JSON manifest contents.
 * @returns The constructed workspace Graph.
 */
export function buildGraph(manifests: Record<string, string>): Graph {
  const paths: Record<string, string> = Object.create(null);
  const parsedManifests = new Map<string, RawPackageJson>();

  for (const [manifestPath, rawContent] of Object.entries(manifests)) {
    if (typeof rawContent !== "string") {
      throw new GraphError("invalid_manifest", `invalid manifest content at "${manifestPath}"`);
    }
    if (rawContent.length > MAX_MANIFEST_SIZE) {
      throw new GraphError(
        "manifest_too_large",
        `manifest at "${manifestPath}" exceeds maximum size of ${MAX_MANIFEST_SIZE} characters`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch (cause) {
      throw new GraphError(
        "invalid_manifest",
        `invalid JSON in manifest at "${manifestPath}": ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new GraphError(
        "invalid_manifest",
        `manifest at "${manifestPath}" must be a JSON object`,
      );
    }

    const rawPkg = parsed as RawPackageJson;
    const name = rawPkg.name;
    if (typeof name !== "string" || name.trim() === "") {
      throw new GraphError(
        "invalid_manifest",
        `manifest at "${manifestPath}" is missing a valid non-empty "name" string`,
      );
    }

    if (paths[name] !== undefined) {
      throw new GraphError(
        "duplicate_package",
        `duplicate package name "${name}" found at "${manifestPath}" and "${paths[name]}"`,
      );
    }

    for (const kind of DEPENDENCY_KINDS) {
      const depField = rawPkg[kind];
      if (depField !== undefined) {
        if (depField === null || typeof depField !== "object" || Array.isArray(depField)) {
          throw new GraphError(
            "invalid_manifest",
            `field "${kind}" in manifest at "${manifestPath}" must be an object`,
          );
        }
      }
    }

    paths[name] = manifestPath;
    parsedManifests.set(name, rawPkg);
  }

  const packageNames = Object.keys(paths).sort();
  const packageSet = new Set(packageNames);
  const rawEdges: Edge[] = [];

  for (const fromPkg of packageNames) {
    const rawPkg = parsedManifests.get(fromPkg);
    if (!rawPkg) continue;

    for (const kind of DEPENDENCY_KINDS) {
      const deps = rawPkg[kind];
      if (deps && typeof deps === "object" && !Array.isArray(deps)) {
        for (const depName of Object.keys(deps)) {
          if (depName === "__proto__") continue;
          if (packageSet.has(depName)) {
            rawEdges.push({
              from: fromPkg,
              to: depName,
              kind,
            });
          }
        }
      }
    }
  }

  const kindPriority: Record<DependencyKind, number> = {
    dependencies: 0,
    devDependencies: 1,
    peerDependencies: 2,
    optionalDependencies: 3,
  };

  rawEdges.sort((a, b) => {
    if (a.from !== b.from) {
      return a.from < b.from ? -1 : 1;
    }
    if (a.to !== b.to) {
      return a.to < b.to ? -1 : 1;
    }
    return kindPriority[a.kind] - kindPriority[b.kind];
  });

  return {
    packages: packageNames,
    paths,
    edges: rawEdges,
  };
}

/**
 * Find all cycles in the graph using Tarjan's Strongly Connected Components algorithm.
 * Returns SCCs of size > 1 plus self-loops. Each component is sorted by name, and the
 * list of components is sorted by the first name.
 */
export function findCycles(graph: Graph): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const pkg of graph.packages) {
    adjacency.set(pkg, new Set());
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.add(edge.to);
  }

  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Map<string, boolean>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongConnect(v: string) {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.set(v, true);

    const neighbors = adjacency.get(v) ?? new Set();
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongConnect(w);
        const vLow = lowlink.get(v) ?? 0;
        const wLow = lowlink.get(w) ?? 0;
        lowlink.set(v, Math.min(vLow, wLow));
      } else if (onStack.get(w)) {
        const vLow = lowlink.get(v) ?? 0;
        const wIdx = indices.get(w) ?? 0;
        lowlink.set(v, Math.min(vLow, wIdx));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        const popped = stack.pop();
        if (popped === undefined) break;
        w = popped;
        onStack.set(w, false);
        scc.push(w);
      } while (w !== v);

      if (scc.length > 1) {
        scc.sort();
        sccs.push(scc);
      } else {
        // Check for self-loop
        if (adjacency.get(v)?.has(v)) {
          sccs.push(scc);
        }
      }
    }
  }

  for (const pkg of graph.packages) {
    if (!indices.has(pkg)) {
      strongConnect(pkg);
    }
  }

  sccs.sort((a, b) => {
    const firstA = a[0] ?? "";
    const firstB = b[0] ?? "";
    return firstA < firstB ? -1 : firstA > firstB ? 1 : 0;
  });

  return sccs;
}

/**
 * Reconstruct an elementary directed cycle from an SCC for clear error reporting.
 */
function findElementaryCycle(scc: string[], graph: Graph): string[] {
  const firstPkg = scc[0] ?? "";
  const sccSet = new Set(scc);
  if (scc.length === 1) {
    return [firstPkg, firstPkg];
  }

  const adj = new Map<string, string[]>();
  for (const pkg of scc) {
    adj.set(pkg, []);
  }
  for (const edge of graph.edges) {
    if (sccSet.has(edge.from) && sccSet.has(edge.to)) {
      adj.get(edge.from)?.push(edge.to);
    }
  }
  for (const [, neighbors] of adj) {
    neighbors.sort();
  }

  const start = firstPkg;
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(curr: string): string[] | null {
    path.push(curr);
    visited.add(curr);
    const neighbors = adj.get(curr) ?? [];
    for (const next of neighbors) {
      if (next === start && path.length > 1) {
        return [...path, start];
      }
      if (!visited.has(next)) {
        const found = dfs(next);
        if (found) return found;
      }
    }
    visited.delete(curr);
    path.pop();
    return null;
  }

  const cycle = dfs(start);
  if (cycle) return cycle;

  // Fallback: BFS/DFS from first node that finds any cycle
  for (const candidate of scc) {
    path.length = 0;
    visited.clear();
    function dfsCandidate(curr: string): string[] | null {
      path.push(curr);
      visited.add(curr);
      const neighbors = adj.get(curr) ?? [];
      for (const next of neighbors) {
        if (next === candidate && path.length > 1) {
          return [...path, candidate];
        }
        if (!visited.has(next)) {
          const found = dfsCandidate(next);
          if (found) return found;
        }
      }
      visited.delete(curr);
      path.pop();
      return null;
    }
    const res = dfsCandidate(candidate);
    if (res) return res;
  }

  return [...scc, firstPkg];
}

/**
 * Compute topological order using Kahn's algorithm with dependencies before dependents
 * and a sorted ready queue for deterministic results.
 *
 * Throws GraphError with code 'cycle' if a cycle exists.
 */
export function topoOrder(graph: Graph): string[] {
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const pkg of graph.packages) {
    inDegree.set(pkg, 0);
    outgoing.set(pkg, []);
  }

  // In a build order (dependencies before dependents):
  // If A depends on B (edge from A to B), B must be built before A.
  // Thus edge from A to B means B -> A in build order.
  // inDegree[A] counts how many dependencies A has.
  for (const edge of graph.edges) {
    inDegree.set(edge.from, (inDegree.get(edge.from) ?? 0) + 1);
    outgoing.get(edge.to)?.push(edge.from);
  }

  const readyQueue: string[] = [];
  for (const pkg of graph.packages) {
    if ((inDegree.get(pkg) ?? 0) === 0) {
      readyQueue.push(pkg);
    }
  }
  readyQueue.sort();

  const result: string[] = [];
  while (readyQueue.length > 0) {
    const current = readyQueue.shift();
    if (current === undefined) break;
    result.push(current);

    const dependentsList = outgoing.get(current) ?? [];
    const newlyReady: string[] = [];
    for (const dep of dependentsList) {
      const updated = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, updated);
      if (updated === 0) {
        newlyReady.push(dep);
      }
    }
    if (newlyReady.length > 0) {
      for (const p of newlyReady) {
        readyQueue.push(p);
      }
      readyQueue.sort();
    }
  }

  if (result.length < graph.packages.length) {
    const cycles = findCycles(graph);
    const firstScc = cycles[0];
    let cyclePath: string[];
    if (firstScc && firstScc.length > 0) {
      cyclePath = findElementaryCycle(firstScc, graph);
    } else {
      cyclePath = graph.packages.slice(0, 2);
      if (cyclePath[0]) cyclePath.push(cyclePath[0]);
    }
    throw new GraphError("cycle", `cycle: ${cyclePath.join(" -> ")}`);
  }

  return result;
}

/**
 * Find packages that depend on `name`.
 *
 * @param graph - Monorepo graph.
 * @param name - Target package name.
 * @param opts - Options; `transitive` defaults to `true`.
 * @returns Sorted list of dependents excluding `name`.
 */
export function dependents(graph: Graph, name: string, opts?: { transitive?: boolean }): string[] {
  if (!graph.packages.includes(name)) {
    throw new GraphError("unknown_package", `unknown package "${name}"`);
  }
  const transitive = opts?.transitive !== false;

  // If from depends on to, then from is a dependent of to.
  const directDependents = new Map<string, Set<string>>();
  for (const pkg of graph.packages) {
    directDependents.set(pkg, new Set());
  }
  for (const edge of graph.edges) {
    directDependents.get(edge.to)?.add(edge.from);
  }

  if (!transitive) {
    const direct = Array.from(directDependents.get(name) ?? new Set<string>());
    direct.sort();
    return direct.filter((p) => p !== name);
  }

  const visited = new Set<string>();
  const queue: string[] = Array.from(directDependents.get(name) ?? new Set<string>());

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current === name) continue;
    if (!visited.has(current)) {
      visited.add(current);
      const nextDeps = directDependents.get(current) ?? new Set();
      for (const n of nextDeps) {
        if (!visited.has(n) && n !== name) {
          queue.push(n);
        }
      }
    }
  }

  const result = Array.from(visited);
  result.sort();
  return result;
}

/**
 * Compute affected packages: the changed packages plus all their transitive dependents,
 * sorted and unique.
 *
 * @param graph - Monorepo graph.
 * @param changed - List of changed package names.
 */
export function affected(graph: Graph, changed: readonly string[]): string[] {
  const affectedSet = new Set<string>();

  for (const pkg of changed) {
    if (!graph.packages.includes(pkg)) {
      throw new GraphError("unknown_package", `unknown package "${pkg}"`);
    }
    affectedSet.add(pkg);
    const deps = dependents(graph, pkg, { transitive: true });
    for (const d of deps) {
      affectedSet.add(d);
    }
  }

  const result = Array.from(affectedSet);
  result.sort();
  return result;
}

function escapeDotString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Serialize the workspace graph to Graphviz DOT format.
 * - Every package as a quoted node line
 * - devDependencies edges with ' [style=dashed]'
 * - peerDependencies edges with ' [style=dotted]'
 * - Duplicate from/to pairs emitted once (the first kind in precedence order wins)
 */
export function toDot(graph: Graph): string {
  const lines: string[] = ["digraph workspace {"];

  for (const pkg of graph.packages) {
    lines.push(`  "${escapeDotString(pkg)}";`);
  }

  const seenPairs = new Set<string>();
  for (const edge of graph.edges) {
    const pairKey = `${edge.from}\0${edge.to}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const fromStr = `"${escapeDotString(edge.from)}"`;
    const toStr = `"${escapeDotString(edge.to)}"`;

    let attr = "";
    if (edge.kind === "devDependencies") {
      attr = " [style=dashed]";
    } else if (edge.kind === "peerDependencies") {
      attr = " [style=dotted]";
    }

    lines.push(`  ${fromStr} -> ${toStr}${attr};`);
  }

  lines.push("}");
  return `${lines.join("\n")}\n`;
}
