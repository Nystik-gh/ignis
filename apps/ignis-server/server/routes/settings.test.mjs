import { describe, it, expect, afterAll } from "vitest";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import os from "os";

const require = createRequire(import.meta.url);

const VAULT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "settings-validate-"));
process.env.VAULT_ROOT = VAULT_ROOT;

const VAULT_ID = "v";
const OTHER_ID = "w";
fs.mkdirSync(path.join(VAULT_ROOT, VAULT_ID), { recursive: true });
fs.mkdirSync(path.join(VAULT_ROOT, OTHER_ID), { recursive: true });

const { validate } = require("./settings.js");
const settings = require("../settings.js");
const config = require("../config.js");
config.refreshVaults();

afterAll(() => {
  fs.rmSync(VAULT_ROOT, { recursive: true, force: true });
});

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

  it("accepts valid ignore rule sets, trimming and keeping pattern order", () => {
    expect(
      validate({
        ignoreRules: [
          { name: "System", patterns: [" @eaDir ", "#recycle", "!a/b.md"] },
        ],
      }),
    ).toEqual({
      ignoreRules: [
        { name: "System", patterns: ["@eaDir", "#recycle", "!a/b.md"] },
      ],
    });
  });

  it("defaults a missing rule name to an empty string", () => {
    expect(validate({ ignoreRules: [{ patterns: [".git"] }] })).toEqual({
      ignoreRules: [{ name: "", patterns: [".git"] }],
    });
  });

  it("rejects ignoreRules that is not an array", () => {
    expect(() => validate({ ignoreRules: ".git" })).toThrow();
  });

  it("rejects a rule set missing its patterns array", () => {
    expect(() => validate({ ignoreRules: [{ name: "x" }] })).toThrow();
  });

  it("rejects a rule set with no patterns", () => {
    expect(() => validate({ ignoreRules: [{ patterns: [] }] })).toThrow();
  });

  it("rejects a rule set with an empty or non-string pattern", () => {
    expect(() =>
      validate({ ignoreRules: [{ patterns: [".git", ""] }] }),
    ).toThrow();
    expect(() =>
      validate({ ignoreRules: [{ patterns: [".git", 5] }] }),
    ).toThrow();
  });

  it("rejects a non-array allowlist or an empty entry", () => {
    expect(() => validate({ proxyAllowlist: "x" })).toThrow();
    expect(() => validate({ proxyAllowlist: ["ok", "  "] })).toThrow();
  });

  it("rejects a trusted vault list that is not an array", () => {
    expect(() => validate({ trustedVaults: VAULT_ID })).toThrow();
  });

  it("rejects a trusted vault list with an empty entry", () => {
    expect(() => validate({ trustedVaults: [VAULT_ID, "  "] })).toThrow();
  });

  it("rejects a trusted vault id that resolves to no vault", () => {
    expect(() => validate({ trustedVaults: [VAULT_ID, "ghost"] })).toThrow(
      "trustedVaults contains an unknown vault: ghost",
    );
  });

  it("de-duplicates a trusted vault list of existing vaults", () => {
    expect(
      validate({ trustedVaults: [` ${VAULT_ID} `, OTHER_ID, VAULT_ID] }),
    ).toEqual({ trustedVaults: [VAULT_ID, OTHER_ID] });
  });

  it("ignores wsOrigins, which is env-only", () => {
    expect(validate({ wsOrigins: ["https://evil.example.com"] })).toEqual({});
  });

  it("ignores unknown keys", () => {
    expect(validate({ bogusKey: 1 })).toEqual({});
  });
});

describe("ignore rule limits", () => {
  const ruleSet = (patterns) => ({ ignoreRules: [{ name: "x", patterns }] });

  it("rejects a pattern that repeats ** more than three times", () => {
    expect(() => validate(ruleSet(["a/**/b/**/c/**/d/**/e"]))).toThrow(
      /\*\* more than/,
    );
    expect(validate(ruleSet(["a/**/b/**/c/**/d"])).ignoreRules).toHaveLength(1);
  });

  it("rejects a pattern longer than 256 characters", () => {
    expect(() => validate(ruleSet(["a".repeat(257)]))).toThrow(/longer than/);
  });

  it("rejects more than 200 patterns in one rule set", () => {
    const patterns = Array.from({ length: 201 }, (_, i) => `p${i}`);

    expect(() => validate(ruleSet(patterns))).toThrow(/more than 200/);
  });

  it("rejects more than 64 rule sets", () => {
    const ignoreRules = Array.from({ length: 65 }, (_, i) => ({
      name: `r${i}`,
      patterns: ["x"],
    }));

    expect(() => validate({ ignoreRules })).toThrow(/more than 64/);
  });
});

describe("trust toggle invalidation", () => {
  const { trustChanges } = require("./settings.js");

  it("names the vaults whose trust changed, in either direction", () => {
    expect(trustChanges(["a", "b"], ["b", "c"])).toEqual(["a", "c"]);
  });

  it("names nothing when the list is unchanged", () => {
    expect(trustChanges(["a"], ["a"])).toEqual([]);
  });

  it("treats a missing list as empty", () => {
    expect(trustChanges(undefined, ["a"])).toEqual(["a"]);
    expect(trustChanges(["a"], undefined)).toEqual(["a"]);
  });
});
