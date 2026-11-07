import { describe, expect, it } from "vitest";
import {
  affected,
  buildGraph,
  dependents,
  findCycles,
  GraphError,
  toDot,
  topoOrder,
} from "../src/index.js";

function pkg(name: string, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ name, ...fields });
}

describe("buildGraph validation", () => {
  it.each([
    ["missing name", "{}"],
    ["blank name", pkg("   ")],
    ["numeric name", '{"name":1}'],
    ["array devDependencies", pkg("a", { devDependencies: ["b"] })],
    ["string peerDependencies", pkg("a", { peerDependencies: "b" })],
    ["null optionalDependencies", pkg("a", { optionalDependencies: null })],
    ["invalid JSON", "{name:"],
    ["JSON null", "null"],
  ])("rejects a manifest with %s as invalid_manifest", (_label, content) => {
    expect(() => buildGraph({ "a/package.json": content })).toThrowError(
      expect.objectContaining({ name: "GraphError", code: "invalid_manifest" }),
    );
  });

  it("names the field in the error for an invalid dependency field", () => {
    expect(() => buildGraph({ "a/package.json": pkg("a", { dependencies: [] }) })).toThrow(
      'field "dependencies" in manifest at "a/package.json" must be an object',
    );
  });

  it("reports both paths for duplicate package names", () => {
    expect(() =>
      buildGraph({ "x/package.json": pkg("dup"), "y/package.json": pkg("dup") }),
    ).toThrow('duplicate package name "dup" found at "y/package.json" and "x/package.json"');
  });

  it("returns an empty graph for no manifests", () => {
    const graph = buildGraph({});
    expect(graph).toEqual({ packages: [], paths: {}, edges: [] });
    expect(topoOrder(graph)).toEqual([]);
    expect(findCycles(graph)).toEqual([]);
    expect(affected(graph, [])).toEqual([]);
    expect(toDot(graph)).toBe("digraph workspace {\n}\n");
  });

  it("keeps one edge per kind and sorts edges by from, to, then kind precedence", () => {
    const graph = buildGraph({
      "z/package.json": pkg("z", {
        optionalDependencies: { a: "*" },
        peerDependencies: { a: "*" },
        devDependencies: { b: "*", a: "*" },
        dependencies: { a: "*" },
      }),
      "a/package.json": pkg("a"),
      "b/package.json": pkg("b"),
    });
    expect(graph.edges).toEqual([
      { from: "z", to: "a", kind: "dependencies" },
      { from: "z", to: "a", kind: "devDependencies" },
      { from: "z", to: "a", kind: "peerDependencies" },
      { from: "z", to: "a", kind: "optionalDependencies" },
      { from: "z", to: "b", kind: "devDependencies" },
    ]);
    expect(graph.paths).toEqual({ a: "a/package.json", b: "b/package.json", z: "z/package.json" });
    const dot = toDot(graph);
    expect(dot).toContain('  "z" -> "a";\n');
    expect(dot.match(/"z" -> "a"/g)).toHaveLength(1);
    expect(dot).toContain('  "z" -> "b" [style=dashed];\n');
  });

  it("emits optionalDependencies-only edges without a style attribute", () => {
    const graph = buildGraph({
      "a/package.json": pkg("a", { optionalDependencies: { b: "*" } }),
      "b/package.json": pkg("b"),
    });
    expect(toDot(graph)).toBe('digraph workspace {\n  "a";\n  "b";\n  "a" -> "b";\n}\n');
  });

  it("escapes backslashes in DOT node names", () => {
    const graph = buildGraph({ "a/package.json": pkg("a\\b") });
    expect(toDot(graph)).toContain('  "a\\\\b";');
  });
});

describe("cycles and ordering", () => {
  it("reports multiple SCCs sorted by first member and excludes acyclic nodes", () => {
    const graph = buildGraph({
      "a/package.json": pkg("m", { dependencies: { n: "*" } }),
      "b/package.json": pkg("n", { dependencies: { m: "*" } }),
      "c/package.json": pkg("c", { dependencies: { d: "*" } }),
      "d/package.json": pkg("d", { dependencies: { e: "*" } }),
      "e/package.json": pkg("e", { dependencies: { c: "*" } }),
      "f/package.json": pkg("free", { dependencies: { c: "*" } }),
    });
    expect(findCycles(graph)).toEqual([
      ["c", "d", "e"],
      ["m", "n"],
    ]);
    expect(() => topoOrder(graph)).toThrow("cycle: c -> d -> e -> c");
  });

  it("reconstructs a multi-hop elementary cycle following sorted neighbors", () => {
    // a -> b, a -> c, b -> d, d -> c, c -> a: the walk follows "b" before "c".
    const graph = buildGraph({
      "a/package.json": pkg("a", { dependencies: { b: "*", c: "*" } }),
      "b/package.json": pkg("b", { dependencies: { d: "*" } }),
      "c/package.json": pkg("c", { dependencies: { a: "*" } }),
      "d/package.json": pkg("d", { dependencies: { c: "*" } }),
    });
    expect(findCycles(graph)).toEqual([["a", "b", "c", "d"]]);
    let caught: unknown;
    try {
      topoOrder(graph);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GraphError);
    expect((caught as GraphError).code).toBe("cycle");
    expect((caught as GraphError).message).toBe("cycle: a -> b -> d -> c -> a");
  });

  it("reports a self-loop cycle as the package pointing to itself", () => {
    const graph = buildGraph({
      "a/package.json": pkg("a"),
      "s/package.json": pkg("s", { devDependencies: { s: "*" } }),
    });
    expect(() => topoOrder(graph)).toThrow("cycle: s -> s");
  });

  it("orders independent packages alphabetically while respecting dependencies", () => {
    const graph = buildGraph({
      "a/package.json": pkg("app", { dependencies: { lib: "*", util: "*" } }),
      "b/package.json": pkg("lib", { dependencies: { util: "*" } }),
      "c/package.json": pkg("util"),
      "d/package.json": pkg("zeta"),
      "e/package.json": pkg("beta"),
    });
    expect(topoOrder(graph)).toEqual(["beta", "util", "lib", "app", "zeta"]);
  });
});

describe("dependents and affected", () => {
  const cyclic = buildGraph({
    "a/package.json": pkg("a", { dependencies: { b: "*" } }),
    "b/package.json": pkg("b", { dependencies: { a: "*" } }),
    "c/package.json": pkg("c", { dependencies: { b: "*" } }),
    "s/package.json": pkg("s", { dependencies: { s: "*" } }),
  });

  it("excludes the package itself from dependents even inside a cycle", () => {
    expect(dependents(cyclic, "a")).toEqual(["b", "c"]);
    expect(dependents(cyclic, "a", {})).toEqual(["b", "c"]);
    expect(dependents(cyclic, "a", { transitive: false })).toEqual(["b"]);
    expect(dependents(cyclic, "s")).toEqual([]);
    expect(dependents(cyclic, "s", { transitive: false })).toEqual([]);
    expect(dependents(cyclic, "c")).toEqual([]);
  });

  it("merges and deduplicates affected sets for several changed packages", () => {
    expect(affected(cyclic, ["c", "a", "c"])).toEqual(["a", "b", "c"]);
    expect(affected(cyclic, ["s"])).toEqual(["s"]);
  });

  it("reports the unknown package name in the error message", () => {
    expect(() => affected(cyclic, ["a", "ghost"])).toThrow('unknown package "ghost"');
    expect(() => dependents(cyclic, "ghost", { transitive: false })).toThrow(
      'unknown package "ghost"',
    );
  });
});

describe("edge ordering in a large workspace", () => {
  it("sorts many unsorted dependency declarations by from, to and kind", () => {
    const count = 60;
    const names = Array.from({ length: count }, (_, i) => `p${String(i).padStart(2, "0")}`);
    const manifests: Record<string, string> = {};
    for (let i = 0; i < count; i++) {
      // Declare dependencies in descending order so edges are pushed unsorted.
      const deps: Record<string, string> = {};
      for (let j = count - 1; j > i; j -= 7) deps[names[j] as string] = "*";
      const devDeps: Record<string, string> = {};
      if (i > 0) devDeps[names[i - 1] as string] = "*";
      manifests[`pkgs/${names[i]}/package.json`] = pkg(names[i] as string, {
        devDependencies: devDeps,
        dependencies: deps,
      });
    }
    const graph = buildGraph(manifests);
    const expected = [...graph.edges].sort((a, b) =>
      a.from === b.from ? (a.to === b.to ? 0 : a.to < b.to ? -1 : 1) : a.from < b.from ? -1 : 1,
    );
    expect(graph.edges.length).toBeGreaterThan(64);
    expect(graph.edges).toEqual(expected);
    expect(graph.edges[0]).toEqual({ from: "p00", to: "p03", kind: "dependencies" });
    expect(graph.edges.at(-1)).toEqual({ from: "p59", to: "p58", kind: "devDependencies" });
  });
});
