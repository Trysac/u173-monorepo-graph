import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { affected, buildGraph, findCycles, toDot, topoOrder } from "./graph.js";
import { GraphError, type WorkspaceFs } from "./types.js";
import { loadWorkspace } from "./workspace.js";

/**
 * WorkspaceFs implementation using Node.js filesystem.
 */
class NodeWorkspaceFs implements WorkspaceFs {
  async readFile(filePath: string): Promise<string | null> {
    try {
      return await nodeFs.readFile(filePath, "utf-8");
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async listDirs(dirPath: string): Promise<string[]> {
    try {
      const entries = await nodeFs.readdir(dirPath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }
}

export interface CliIo {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

/**
 * Run the CLI with the given arguments and I/O handlers.
 *
 * Commands:
 * - order: prints packages in topological build order (one per line)
 * - cycles: prints cycles detected in workspace
 * - affected --changed a,b: prints affected packages
 * - dot: prints Graphviz DOT output
 *
 * Options:
 * - --root <dir>: workspace root directory (default: '.')
 *
 * Returns:
 * - 0 on success
 * - 1 on cycle or unknown package error
 * - 2 on usage or I/O error
 */
export async function run(argv: string[], io: CliIo): Promise<number> {
  try {
    let root = ".";
    let command: string | undefined;
    let changedArg: string | undefined;

    const args = [...argv];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === undefined) continue;
      if (arg === "--root") {
        i++;
        const nextVal = args[i];
        if (i >= args.length || !nextVal) {
          io.stderr("Error: --root requires a directory argument\n");
          return 2;
        }
        root = nextVal;
      } else if (arg.startsWith("--root=")) {
        root = arg.slice("--root=".length);
      } else if (arg === "--changed") {
        i++;
        const nextVal = args[i];
        if (i >= args.length || !nextVal) {
          io.stderr("Error: --changed requires package names argument\n");
          return 2;
        }
        changedArg = nextVal;
      } else if (arg.startsWith("--changed=")) {
        changedArg = arg.slice("--changed=".length);
      } else if (!arg.startsWith("-") && !command) {
        command = arg;
      } else {
        io.stderr(`Error: unknown option or argument "${arg}"\n`);
        return 2;
      }
    }

    if (!command) {
      io.stderr(
        "Usage: monorepo-graph <order|cycles|affected|dot> [--root <path>] [--changed <pkgs>]\n",
      );
      return 2;
    }

    if (
      command !== "order" &&
      command !== "cycles" &&
      command !== "affected" &&
      command !== "dot"
    ) {
      io.stderr(`Error: unknown command "${command}"\n`);
      return 2;
    }

    if (command === "affected" && changedArg === undefined) {
      io.stderr("Error: affected command requires --changed <a,b,...>\n");
      return 2;
    }

    const fs = new NodeWorkspaceFs();
    const resolvedRoot = nodePath.resolve(root);
    const manifests = await loadWorkspace(fs, resolvedRoot);
    const graph = buildGraph(manifests);

    switch (command) {
      case "order": {
        const order = topoOrder(graph);
        for (const pkg of order) {
          io.stdout(`${pkg}\n`);
        }
        return 0;
      }
      case "cycles": {
        const cycles = findCycles(graph);
        if (cycles.length > 0) {
          for (const cycle of cycles) {
            io.stdout(`${cycle.join(" -> ")}\n`);
          }
          return 1;
        }
        return 0;
      }
      case "affected": {
        const changed = (changedArg ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        const aff = affected(graph, changed);
        for (const pkg of aff) {
          io.stdout(`${pkg}\n`);
        }
        return 0;
      }
      case "dot": {
        const dotOutput = toDot(graph);
        io.stdout(dotOutput);
        return 0;
      }
    }
  } catch (err: unknown) {
    if (err instanceof GraphError) {
      if (err.code === "cycle" || err.code === "unknown_package") {
        io.stderr(`${err.message}\n`);
        return 1;
      }
      io.stderr(`Error [${err.code}]: ${err.message}\n`);
      return 2;
    }
    const msg = err instanceof Error ? err.message : String(err);
    io.stderr(`Error: ${msg}\n`);
    return 2;
  }
}
