import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";

interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

async function exec(argv: string[]): Promise<Captured> {
  let stdout = "";
  let stderr = "";
  const code = await run(argv, {
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
  });
  return { code, stdout, stderr };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
}

describe("CLI edge cases", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "monorepo-graph-cli-edge-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function cyclicWorkspace(): Promise<void> {
    await writeJson(path.join(dir, "package.json"), { workspaces: ["packages/*"] });
    await writeJson(path.join(dir, "packages", "a", "package.json"), {
      name: "a",
      dependencies: { b: "*" },
    });
    await writeJson(path.join(dir, "packages", "b", "package.json"), {
      name: "b",
      dependencies: { a: "*" },
    });
    await writeJson(path.join(dir, "packages", "c", "package.json"), { name: "c" });
  }

  it("prints each cycle and exits 1 for the cycles command", async () => {
    await cyclicWorkspace();
    const res = await exec(["cycles", "--root", dir]);
    expect(res).toEqual({ code: 1, stdout: "a -> b\n", stderr: "" });
  });

  it("accepts --changed=<list>, trims names and ignores empty entries", async () => {
    await cyclicWorkspace();
    const res = await exec([`--root=${dir}`, "--changed= c , ,", "affected"]);
    expect(res).toEqual({ code: 0, stdout: "c\n", stderr: "" });
  });

  it("prints nothing for affected with an empty --changed= list", async () => {
    await cyclicWorkspace();
    const res = await exec(["affected", `--root=${dir}`, "--changed="]);
    expect(res).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("exits 1 with the plain message for an unknown changed package", async () => {
    await cyclicWorkspace();
    const res = await exec(["affected", "--root", dir, "--changed", "ghost"]);
    expect(res).toEqual({ code: 1, stdout: "", stderr: 'unknown package "ghost"\n' });
  });

  it("exits 2 when --changed has no value", async () => {
    const res = await exec(["affected", "--changed"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toBe("Error: --changed requires package names argument\n");
  });

  it("exits 2 when --root is followed by an empty value", async () => {
    const res = await exec(["order", "--root", ""]);
    expect(res).toEqual({
      code: 2,
      stdout: "",
      stderr: "Error: --root requires a directory argument\n",
    });
  });

  it("rejects unknown options and extra positional arguments", async () => {
    expect(await exec(["order", "--verbose"])).toEqual({
      code: 2,
      stdout: "",
      stderr: 'Error: unknown option or argument "--verbose"\n',
    });
    expect(await exec(["order", "dot"])).toEqual({
      code: 2,
      stdout: "",
      stderr: 'Error: unknown option or argument "dot"\n',
    });
  });

  it("prints usage when only options are given", async () => {
    const res = await exec(["--root", dir]);
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/^Usage: monorepo-graph/);
  });

  it("reports a missing root package.json with its error code and exit 2", async () => {
    const res = await exec(["order", "--root", dir]);
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/^Error \[invalid_manifest\]: root package\.json not found at /);
  });

  it("reports an invalid member manifest with its error code and exit 2", async () => {
    await writeJson(path.join(dir, "package.json"), { workspaces: ["libs/core"] });
    await writeJson(path.join(dir, "libs", "core", "package.json"), "{ not json");
    const res = await exec(["dot", "--root", dir]);
    expect(res.code).toBe(2);
    expect(res.stdout).toBe("");
    expect(res.stderr).toMatch(/^Error \[invalid_manifest\]: invalid JSON in manifest at /);
  });

  it("reports a non-ENOENT filesystem error as a generic error with exit 2", async () => {
    // package.json is a directory, so reading it fails with EISDIR.
    await fs.mkdir(path.join(dir, "package.json"));
    const res = await exec(["order", "--root", dir]);
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/^Error: EISDIR/);
  });

  it("treats a wildcard parent that is a file as an empty directory", async () => {
    await writeJson(path.join(dir, "package.json"), { workspaces: ["packages/*", "tools/*"] });
    await fs.writeFile(path.join(dir, "packages"), "not a directory");
    await writeJson(path.join(dir, "tools", "t", "package.json"), { name: "t" });
    await fs.writeFile(path.join(dir, "tools", "README.md"), "file entries are skipped");
    const res = await exec(["order", "--root", dir]);
    expect(res).toEqual({ code: 0, stdout: "t\n", stderr: "" });
  });

  it("returns 0 with no output for a workspace without members", async () => {
    await writeJson(path.join(dir, "package.json"), { workspaces: ["missing/*"] });
    expect(await exec(["order", "--root", dir])).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(await exec(["cycles", "--root", dir])).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("skips holes in a sparse argv array", async () => {
    await cyclicWorkspace();
    const argv: string[] = ["affected"];
    argv[2] = "--changed=c";
    argv[4] = `--root=${dir}`;
    expect(await exec(argv)).toEqual({ code: 0, stdout: "c\n", stderr: "" });
  });

  it("reports a non-Error value thrown by an output handler and exits 2", async () => {
    await writeJson(path.join(dir, "package.json"), { workspaces: ["pkg"] });
    await writeJson(path.join(dir, "pkg", "package.json"), { name: "pkg" });
    let stderr = "";
    const code = await run(["dot", "--root", dir], {
      stdout: () => {
        throw "stdout closed";
      },
      stderr: (s) => {
        stderr += s;
      },
    });
    expect(code).toBe(2);
    expect(stderr).toBe("Error: stdout closed\n");
  });
});
