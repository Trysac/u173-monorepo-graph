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

describe("Graph building and analysis", () => {
  it("satisfies acceptance item 1: buildGraph correctly extracts workspace edges with precedence and sorts", () => {
    const manifests = {
      "packages/a/package.json":
        '{"name":"@x/a","dependencies":{"@x/b":"workspace:*","lodash":"^4"}}',
      "packages/b/package.json": '{"name":"@x/b"}',
      "packages/c/package.json": '{"name":"@x/c","devDependencies":{"@x/a":"1.0.0"}}',
    };
    const graph = buildGraph(manifests);
    expect(graph.edges).toEqual([
      { from: "@x/a", to: "@x/b", kind: "dependencies" },
      { from: "@x/c", to: "@x/a", kind: "devDependencies" },
    ]);
    expect(graph.packages).toEqual(["@x/a", "@x/b", "@x/c"]);
  });

  it("satisfies acceptance item 2: topoOrder, affected and dependents", () => {
    const manifests = {
      "packages/a/package.json":
        '{"name":"@x/a","dependencies":{"@x/b":"workspace:*","lodash":"^4"}}',
      "packages/b/package.json": '{"name":"@x/b"}',
      "packages/c/package.json": '{"name":"@x/c","devDependencies":{"@x/a":"1.0.0"}}',
    };
    const graph = buildGraph(manifests);
    expect(topoOrder(graph)).toEqual(["@x/b", "@x/a", "@x/c"]);
    expect(affected(graph, ["@x/b"])).toEqual(["@x/a", "@x/b", "@x/c"]);
    expect(dependents(graph, "@x/b", { transitive: false })).toEqual(["@x/a"]);
  });

  it("satisfies acceptance item 3: cycle detection and error messaging", () => {
    const manifests = {
      "packages/a/package.json": '{"name":"@x/a","dependencies":{"@x/b":"workspace:*"}}',
      "packages/b/package.json": '{"name":"@x/b","dependencies":{"@x/a":"workspace:*"}}',
    };
    const graph = buildGraph(manifests);
    expect(findCycles(graph)).toEqual([["@x/a", "@x/b"]]);
    expect(() => topoOrder(graph)).toThrowError(GraphError);
    try {
      topoOrder(graph);
    } catch (err: unknown) {
      const gErr = err as GraphError;
      expect(gErr.code).toBe("cycle");
      expect(gErr.message).toBe("cycle: @x/a -> @x/b -> @x/a");
    }
  });

  it("satisfies acceptance item 4: duplicate_package, invalid_manifest, manifest_too_large", () => {
    // duplicate package
    expect(() =>
      buildGraph({
        "packages/a/package.json": '{"name":"@x/a"}',
        "packages/b/package.json": '{"name":"@x/a"}',
      }),
    ).toThrowError(expect.objectContaining({ code: "duplicate_package" }));

    // invalid JSON
    expect(() =>
      buildGraph({
        "packages/a/package.json": "{ bad json",
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_manifest" }));

    // missing name
    expect(() =>
      buildGraph({
        "packages/a/package.json": '{"version":"1.0.0"}',
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_manifest" }));

    // manifest over 1_048_576 characters
    const huge = `{"name":"@x/a","description":"${"x".repeat(1_048_600)}"}`;
    expect(() =>
      buildGraph({
        "packages/a/package.json": huge,
      }),
    ).toThrowError(expect.objectContaining({ code: "manifest_too_large" }));
  });

  it("satisfies acceptance item 5: toDot formatting", () => {
    const manifests = {
      "packages/a/package.json":
        '{"name":"@x/a","dependencies":{"@x/b":"workspace:*","lodash":"^4"}}',
      "packages/b/package.json": '{"name":"@x/b"}',
      "packages/c/package.json": '{"name":"@x/c","devDependencies":{"@x/a":"1.0.0"}}',
    };
    const graph = buildGraph(manifests);
    // The exact string from the acceptance criterion.
    const expectedDot =
      'digraph workspace {\n  "@x/a";\n  "@x/b";\n  "@x/c";\n  "@x/a" -> "@x/b";\n  "@x/c" -> "@x/a" [style=dashed];\n}\n';
    expect(toDot(graph)).toBe(expectedDot);
  });

  it("handles peerDependencies and optionalDependencies in buildGraph and toDot", () => {
    const manifests = {
      "packages/a/package.json":
        '{"name":"@x/a","peerDependencies":{"@x/b":"*"},"optionalDependencies":{"@x/c":"*"}}',
      "packages/b/package.json": '{"name":"@x/b"}',
      "packages/c/package.json": '{"name":"@x/c"}',
    };
    const graph = buildGraph(manifests);
    expect(graph.edges).toEqual([
      { from: "@x/a", to: "@x/b", kind: "peerDependencies" },
      { from: "@x/a", to: "@x/c", kind: "optionalDependencies" },
    ]);
    const dot = toDot(graph);
    expect(dot).toContain('"@x/a" -> "@x/b" [style=dotted];');
    expect(dot).toContain('"@x/a" -> "@x/c";');
  });

  it("ignores __proto__ key in dependencies and handles self-loops", () => {
    const manifests = {
      "packages/self/package.json":
        '{"name":"self-pkg","dependencies":{"self-pkg":"workspace:*","__proto__":"bad"}}',
    };
    const graph = buildGraph(manifests);
    expect(graph.edges).toEqual([{ from: "self-pkg", to: "self-pkg", kind: "dependencies" }]);
    expect(findCycles(graph)).toEqual([["self-pkg"]]);
    expect(() => topoOrder(graph)).toThrowError(expect.objectContaining({ code: "cycle" }));
  });

  it("handles non-string manifest content or non-object json", () => {
    expect(() => buildGraph({ "pkg.json": 123 as unknown as string })).toThrowError(
      expect.objectContaining({ code: "invalid_manifest" }),
    );
    expect(() => buildGraph({ "pkg.json": '["hello"]' })).toThrowError(
      expect.objectContaining({ code: "invalid_manifest" }),
    );
    expect(() => buildGraph({ "pkg.json": '{"name":"a","dependencies":null}' })).toThrowError(
      expect.objectContaining({ code: "invalid_manifest" }),
    );
  });

  it("throws unknown_package on unknown dependents or affected target", () => {
    const graph = buildGraph({ "a/package.json": '{"name":"a"}' });
    expect(() => dependents(graph, "b")).toThrowError(
      expect.objectContaining({ code: "unknown_package" }),
    );
    expect(() => affected(graph, ["b"])).toThrowError(
      expect.objectContaining({ code: "unknown_package" }),
    );
  });

  it("correctly handles transitive dependents chain", () => {
    const manifests = {
      "a/package.json": '{"name":"a"}',
      "b/package.json": '{"name":"b","dependencies":{"a":"*"}}',
      "c/package.json": '{"name":"c","dependencies":{"b":"*"}}',
      "d/package.json": '{"name":"d","dependencies":{"c":"*"}}',
    };
    const graph = buildGraph(manifests);
    expect(dependents(graph, "a", { transitive: true })).toEqual(["b", "c", "d"]);
    expect(dependents(graph, "a", { transitive: false })).toEqual(["b"]);
    expect(affected(graph, ["b"])).toEqual(["b", "c", "d"]);
  });

  it("escapes quotes and backslashes in toDot", () => {
    const manifests = {
      "a/package.json": '{"name":"pkg\\"name","dependencies":{"b":"*"}}',
      "b/package.json": '{"name":"b"}',
    };
    const graph = buildGraph(manifests);
    const dot = toDot(graph);
    expect(dot).toContain('"pkg\\"name" -> "b";');
  });
});
