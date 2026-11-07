import { describe, expect, it } from "vitest";
import { loadWorkspace, type WorkspaceFs } from "../src/index.js";

function memoryFs(
  files: Record<string, string>,
  dirs: Record<string, string[]> = {},
  failing: { read?: string[]; list?: string[] } = {},
): WorkspaceFs {
  return {
    async readFile(path: string): Promise<string | null> {
      if (failing.read?.includes(path)) throw new Error(`EACCES: ${path}`);
      return files[path] ?? null;
    },
    async listDirs(path: string): Promise<string[]> {
      if (failing.list?.includes(path)) throw new Error(`EACCES: ${path}`);
      return dirs[path] ?? [];
    },
  };
}

function rootWith(workspaces: unknown): WorkspaceFs {
  return memoryFs({ "root/package.json": JSON.stringify({ workspaces }) });
}

describe("loadWorkspace edge cases", () => {
  it.each([
    ["empty pattern", ""],
    ["slash-only pattern", "/"],
    ["wildcard in a middle segment", "packages/*/sub"],
    ["partial wildcard", "packages/pkg-*"],
    ["braces", "packages/{a,b}"],
    ["negation", "!packages/a"],
  ])("rejects %s with unsupported_pattern", async (_label, pattern) => {
    await expect(loadWorkspace(rootWith([pattern]), "root")).rejects.toMatchObject({
      name: "GraphError",
      code: "unsupported_pattern",
    });
  });

  it("rejects non-string patterns with a message naming the type", async () => {
    await expect(loadWorkspace(rootWith([42]), "root")).rejects.toMatchObject({
      code: "unsupported_pattern",
      message: "workspace pattern must be a string, got number",
    });
  });

  it("rejects oversized root manifests with manifest_too_large", async () => {
    const big = JSON.stringify({ workspaces: [], pad: "x".repeat(1_048_577) });
    await expect(
      loadWorkspace(memoryFs({ "root/package.json": big }), "root"),
    ).rejects.toMatchObject({ code: "manifest_too_large" });
  });

  it.each([
    ["an array", "[]"],
    ["null", "null"],
    ["a number", "7"],
  ])("rejects a root manifest that is %s", async (_label, content) => {
    await expect(
      loadWorkspace(memoryFs({ "root/package.json": content }), "root"),
    ).rejects.toMatchObject({
      code: "invalid_manifest",
      message: 'root manifest at "root/package.json" must be a JSON object',
    });
  });

  it("returns no manifests when workspaces is an object without a packages array", async () => {
    expect(await loadWorkspace(rootWith({ nohoist: ["x"] }), "root")).toEqual({});
    expect(await loadWorkspace(rootWith({ packages: "apps/*" }), "root")).toEqual({});
    expect(await loadWorkspace(rootWith("apps/*"), "root")).toEqual({});
  });

  it("expands a root-level wildcard and deduplicates candidates", async () => {
    const fs = memoryFs(
      {
        "root/package.json": JSON.stringify({ workspaces: ["*", "b", "b/"] }),
        "root/a/package.json": '{"name":"a"}',
        "root/b/package.json": '{"name":"b"}',
      },
      { root: ["b", "a"] },
    );
    expect(await loadWorkspace(fs, "root")).toEqual({
      "a/package.json": '{"name":"a"}',
      "b/package.json": '{"name":"b"}',
    });
  });

  it("normalizes backslashes and trailing slashes in root and patterns", async () => {
    const fs = memoryFs(
      {
        "C:/ws/package.json": JSON.stringify({ workspaces: ["libs\\core"] }),
        "C:/ws/libs/core/package.json": '{"name":"core"}',
      },
      {},
    );
    expect(await loadWorkspace(fs, " C:\\ws\\ ")).toEqual({
      "libs/core/package.json": '{"name":"core"}',
    });
  });

  it("treats an empty root as the current directory", async () => {
    const fs = memoryFs({
      "package.json": JSON.stringify({ workspaces: ["pkg"] }),
      "pkg/package.json": '{"name":"pkg"}',
    });
    expect(await loadWorkspace(fs, "")).toEqual({ "pkg/package.json": '{"name":"pkg"}' });
  });

  it("skips directories whose listing or manifest read fails", async () => {
    const fs = memoryFs(
      {
        "root/package.json": JSON.stringify({ workspaces: ["broken/*", "apps/*"] }),
        "root/apps/ok/package.json": '{"name":"ok"}',
        "root/apps/locked/package.json": '{"name":"locked"}',
      },
      { "root/apps": ["ok", "locked"] },
      { list: ["root/broken"], read: ["root/apps/locked/package.json"] },
    );
    expect(await loadWorkspace(fs, "root")).toEqual({ "apps/ok/package.json": '{"name":"ok"}' });
  });

  it("propagates a failure reading the root manifest", async () => {
    const fs = memoryFs({}, {}, { read: ["root/package.json"] });
    await expect(loadWorkspace(fs, "root")).rejects.toThrow("EACCES: root/package.json");
  });
});
