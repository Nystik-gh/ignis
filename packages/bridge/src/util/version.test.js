import { describe, it, expect } from "vitest";
import { stripBuildMetadata, isNewer } from "./version.js";

describe("isNewer", () => {
  it("is true when latest is strictly newer", () => {
    expect(isNewer("0.8.4", "0.8.3")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
    expect(isNewer("0.9.0", "0.8.9")).toBe(true);
  });

  it("is false for older or equal, so no downgrade is prompted", () => {
    expect(isNewer("0.8.3", "0.8.4")).toBe(false);
    expect(isNewer("0.8.4", "0.8.4")).toBe(false);
    expect(isNewer("0.9.9", "1.0.0")).toBe(false);
  });

  it("is false for malformed versions", () => {
    expect(isNewer("x", "0.8.4")).toBe(false);
    expect(isNewer("0.8", "0.8.4")).toBe(false);
    expect(isNewer("1.x.0", "0.8.4")).toBe(false);
  });

  it("ignores build metadata, so an equal version with a build tag is not newer", () => {
    expect(
      isNewer(stripBuildMetadata("0.8.4"), stripBuildMetadata("0.8.4+q2fmfox")),
    ).toBe(false);
  });
});
