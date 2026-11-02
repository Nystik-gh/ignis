import { describe, it, expect } from "vitest";
import { Worker } from "./worker_threads.js";

describe("worker_threads shim", () => {
  it("throws on constructing a worker", () => {
    expect(() => new Worker("./task.js")).toThrow(
      "worker_threads.Worker() is not available in the web version.",
    );
  });
});
