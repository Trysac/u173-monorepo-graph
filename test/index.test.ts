import { describe, expect, it } from "vitest";
import {
  affected,
  buildGraph,
  dependents,
  findCycles,
  GraphError,
  loadWorkspace,
  toDot,
  topoOrder,
} from "../src/index.js";

describe("public exports", () => {
  it("exports all public API functions and classes", () => {
    expect(typeof buildGraph).toBe("function");
    expect(typeof topoOrder).toBe("function");
    expect(typeof findCycles).toBe("function");
    expect(typeof dependents).toBe("function");
    expect(typeof affected).toBe("function");
    expect(typeof toDot).toBe("function");
    expect(typeof loadWorkspace).toBe("function");
    expect(typeof GraphError).toBe("function");
  });
});
