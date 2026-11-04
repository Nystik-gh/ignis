import { describe, it, expect } from "vitest";
import { constants } from "./os.js";

describe("os.constants", () => {
  it("holds the Linux errno, signals and priority tables", () => {
    expect(Object.keys(constants)).toEqual(["errno", "signals", "priority"]);
    expect(constants.errno.ENOENT).toBe(2);
    expect(constants.errno.EBADF).toBe(9);
    expect(constants.signals.SIGTERM).toBe(15);
    expect(constants.priority.PRIORITY_HIGHEST).toBe(-20);
  });
});
