import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { validate } = require("./settings.js");
const settings = require("../settings.js");

describe("settings validate", () => {
  it("rejects an unknown proxy mode", () => {
    expect(() => validate({ proxyMode: "bogus" })).toThrow();
  });

  it("rejects negative or non-integer numbers", () => {
    expect(() => validate({ contentCacheBytes: -1 })).toThrow();
    expect(() => validate({ contentCacheBytes: 1.5 })).toThrow();
    expect(() => validate({ contentCacheBytes: "5" })).toThrow();
  });

  it("enforces maxBodyBytes bounds", () => {
    expect(() => validate({ maxBodyBytes: 0 })).toThrow();
    expect(() =>
      validate({ maxBodyBytes: settings.MAX_BODY_BACKSTOP + 1 }),
    ).toThrow();
    expect(validate({ maxBodyBytes: 1048576 })).toEqual({
      maxBodyBytes: 1048576,
    });
  });

  it("enforces the writeCoalesceMs ceiling", () => {
    expect(() =>
      validate({ writeCoalesceMs: settings.MAX_WRITE_COALESCE_MS + 1 }),
    ).toThrow();
    expect(validate({ writeCoalesceMs: 5000 })).toEqual({
      writeCoalesceMs: 5000,
    });
  });

  it("trims a valid proxy allowlist", () => {
    expect(
      validate({ proxyAllowlist: [" api.example.com ", "github.com"] }),
    ).toEqual({ proxyAllowlist: ["api.example.com", "github.com"] });
  });

  it("trims a valid direct-fetch host list", () => {
    expect(
      validate({ directFetchHosts: [" api.example.com ", "imt.example.com"] }),
    ).toEqual({ directFetchHosts: ["api.example.com", "imt.example.com"] });
  });

  it("rejects a non-array allowlist or an empty entry", () => {
    expect(() => validate({ proxyAllowlist: "x" })).toThrow();
    expect(() => validate({ proxyAllowlist: ["ok", "  "] })).toThrow();
  });

  it("ignores wsOrigins, which is env-only", () => {
    expect(validate({ wsOrigins: ["https://evil.example.com"] })).toEqual({});
  });

  it("ignores unknown keys", () => {
    expect(validate({ bogusKey: 1 })).toEqual({});
  });
});
