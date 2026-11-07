import { describe, expect, it } from "vitest";
import { loadWorkspace, type WorkspaceFs } from "../src/index.js";

class MemoryFs implements WorkspaceFs {
  private files = new Map<string, string>();
  private dirs = new Map<string, string[]>();

  constructor(files: Record<string, string>, dirs: Record<string, string[]>) {
    for (const [k, v] of Object.entries(files)) {
      this.files.set(k.replace(/\\/g, "/"), v);
    }
    for (const [k, v] of Object.entries(dirs)) {
      this.dirs.set(k.replace(/\\/g, "/"), v);
    }
  }

  async readFile(path: string): Promise<string | null> {
    return this.files.get(path.replace(/\\/g, "/")) ?? null;
  }

  async listDirs(path: string): Promise<string[]> {
    return this.dirs.get(path.replace(/\\/g, "/")) ?? [];
  }
}

describe("loadWorkspace", () => {
  it("satisfies acceptance item 6: array workspaces, object packages, pattern validation and skipping missing manifest", async () => {
    const fs = new MemoryFs(
      {
        "root/package.json": JSON.stringify({ workspaces: ["packages/*"] }),
        "root/packages/a/package.json": JSON.stringify({ name: "@x/a" }),
        "root/packages/b/package.json": JSON.stringify({ name: "@x/b" }),
      },
      {
        "root/packages": ["a", "b", "c"], // 'c' has no package.json
      },
    );

    const result = await loadWorkspace(fs, "root");
    expect(result).toEqual({
      "packages/a/package.json": JSON.stringify({ name: "@x/a" }),
      "packages/b/package.json": JSON.stringify({ name: "@x/b" }),
    });
  });

  it("accepts object with packages array and literal paths", async () => {
    const fs = new MemoryFs(
      {
        "my-workspace/package.json": JSON.stringify({
          workspaces: { packages: ["apps/*", "libs/core"] },
        }),
        "my-workspace/apps/web/package.json": JSON.stringify({ name: "web" }),
        "my-workspace/libs/core/package.json": JSON.stringify({ name: "core" }),
      },
      {
        "my-workspace/apps": ["web"],
      },
    );

    const res = await loadWorkspace(fs, "my-workspace");
    expect(res).toEqual({
      "apps/web/package.json": JSON.stringify({ name: "web" }),
      "libs/core/package.json": JSON.stringify({ name: "core" }),
    });
  });

  it("throws unsupported_pattern for double wildcards or parent directory traversal", async () => {
    const fsDoubleWildcard = new MemoryFs(
      {
        "root/package.json": JSON.stringify({ workspaces: ["packages/**"] }),
      },
      {},
    );
    await expect(loadWorkspace(fsDoubleWildcard, "root")).rejects.toThrowError(
      expect.objectContaining({ code: "unsupported_pattern" }),
    );

    const fsTraversal = new MemoryFs(
      {
        "root/package.json": JSON.stringify({ workspaces: ["../outside/*"] }),
      },
      {},
    );
    await expect(loadWorkspace(fsTraversal, "root")).rejects.toThrowError(
      expect.objectContaining({ code: "unsupported_pattern" }),
    );

    const fsQuestion = new MemoryFs(
      {
        "root/package.json": JSON.stringify({ workspaces: ["packages/?"] }),
      },
      {},
    );
    await expect(loadWorkspace(fsQuestion, "root")).rejects.toThrowError(
      expect.objectContaining({ code: "unsupported_pattern" }),
    );
  });

  it("handles missing root package.json, invalid json, or non-workspaces root", async () => {
    const emptyFs = new MemoryFs({}, {});
    await expect(loadWorkspace(emptyFs, "none")).rejects.toThrowError(
      expect.objectContaining({ code: "invalid_manifest" }),
    );

    const badJsonFs = new MemoryFs({ "root/package.json": "invalid" }, {});
    await expect(loadWorkspace(badJsonFs, "root")).rejects.toThrowError(
      expect.objectContaining({ code: "invalid_manifest" }),
    );

    const noWorkspacesFs = new MemoryFs({ "root/package.json": '{"name":"root"}' }, {});
    const res = await loadWorkspace(noWorkspacesFs, "root");
    expect(res).toEqual({});
  });
});
