import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";

describe("CLI run", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "monorepo-graph-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("satisfies acceptance item 7: order, affected, cycle error and unknown command", async () => {
    // Setup workspace files
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
    );
    await fs.mkdir(path.join(tempDir, "packages", "a"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "packages", "b"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "packages", "c"), { recursive: true });

    await fs.writeFile(
      path.join(tempDir, "packages", "a", "package.json"),
      JSON.stringify({ name: "@x/a", dependencies: { "@x/b": "workspace:*", lodash: "^4" } }),
    );
    await fs.writeFile(
      path.join(tempDir, "packages", "b", "package.json"),
      JSON.stringify({ name: "@x/b" }),
    );
    await fs.writeFile(
      path.join(tempDir, "packages", "c", "package.json"),
      JSON.stringify({ name: "@x/c", devDependencies: { "@x/a": "1.0.0" } }),
    );

    let stdout = "";
    let stderr = "";
    const io = {
      stdout: (s: string) => {
        stdout += s;
      },
      stderr: (s: string) => {
        stderr += s;
      },
    };

    // 1. run(['order', '--root', dir], io)
    const codeOrder = await run(["order", "--root", tempDir], io);
    expect(codeOrder).toBe(0);
    expect(stdout.trim().split("\n")).toEqual(["@x/b", "@x/a", "@x/c"]);

    // 2. run(['affected', '--root', dir, '--changed', '@x/b'], io)
    stdout = "";
    stderr = "";
    const codeAffected = await run(["affected", "--root", tempDir, "--changed", "@x/b"], io);
    expect(codeAffected).toBe(0);
    expect(stdout.trim().split("\n")).toEqual(["@x/a", "@x/b", "@x/c"]);

    // 3. dot command
    stdout = "";
    stderr = "";
    const codeDot = await run(["dot", `--root=${tempDir}`], io);
    expect(codeDot).toBe(0);
    expect(stdout).toContain("digraph workspace {");

    // 4. cycles command on acyclic workspace
    stdout = "";
    stderr = "";
    const codeCycles = await run(["cycles", "--root", tempDir], io);
    expect(codeCycles).toBe(0);
    expect(stdout).toBe("");

    // 5. unknown command
    stdout = "";
    stderr = "";
    const codeUnknown = await run(["foobar", "--root", tempDir], io);
    expect(codeUnknown).toBe(2);
    expect(stderr).toContain("unknown command");

    // 6. cyclic workspace returns 1 with cycle message on stderr
    await fs.writeFile(
      path.join(tempDir, "packages", "b", "package.json"),
      JSON.stringify({ name: "@x/b", dependencies: { "@x/c": "workspace:*" } }),
    );
    stdout = "";
    stderr = "";
    const codeOrderCycle = await run(["order", "--root", tempDir], io);
    expect(codeOrderCycle).toBe(1);
    expect(stderr).toContain("cycle:");
  });

  it("handles CLI argument errors and missing flags", async () => {
    let stdout = "";
    let stderr = "";
    const io = {
      stdout: (s: string) => {
        stdout += s;
      },
      stderr: (s: string) => {
        stderr += s;
      },
    };

    // Missing command
    expect(await run([], io)).toBe(2);
    expect(stderr).toContain("Usage");
    expect(stdout).toBe("");

    // Missing --root parameter
    stderr = "";
    expect(await run(["order", "--root"], io)).toBe(2);
    expect(stderr).toContain("--root requires");

    // Missing --changed parameter
    stderr = "";
    expect(await run(["affected", "--root", tempDir], io)).toBe(2);
    expect(stderr).toContain("requires --changed");
  });
});
