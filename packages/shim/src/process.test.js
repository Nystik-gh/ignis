import { describe, it, expect, vi, afterEach } from "vitest";
import { processShim } from "./process.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("process shim", () => {
  it("returns the process object from its listener methods", () => {
    const listener = () => {};

    for (const method of ["on", "once", "addListener", "removeListener"]) {
      expect(processShim[method]("exit", listener)).toBe(processShim);
    }
  });

  it("reads hrtime from performance.now as seconds and nanoseconds", () => {
    vi.spyOn(performance, "now").mockReturnValue(1500.25);

    expect(processShim.hrtime()).toEqual([1, 500250000]);
  });

  it("borrows a second when hrtime(previous) crosses a second boundary", () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(1500)
      .mockReturnValueOnce(2200);

    const start = processShim.hrtime();

    expect(start).toEqual([1, 500000000]);
    expect(processShim.hrtime(start)).toEqual([0, 700000000]);
  });

  it("returns hrtime.bigint as nanoseconds", () => {
    vi.spyOn(performance, "now").mockReturnValue(1500.25);

    expect(processShim.hrtime.bigint()).toBe(1500250000n);
  });
});
