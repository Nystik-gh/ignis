import { describe, it, expect } from "vitest";
import { createHash } from "./create-hash.js";

// "abc" / empty SHA digests: NIST FIPS 180-4 worked examples (SHA_All.pdf).
// MD5: RFC 1321 §A.5 test suite.
const VECTORS = {
  SHA1: {
    empty: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
    abc: "a9993e364706816aba3e25717850c26c9cd0d89d",
  },
  SHA256: {
    empty: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    abc: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  },
  SHA512: {
    empty:
      "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
    abc: "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
  },
  MD5: {
    empty: "d41d8cd98f00b204e9800998ecf8427e",
    abc: "900150983cd24fb0d6963f7d28e17f72",
  },
};

describe("createHash", () => {
  for (const [alg, vec] of Object.entries(VECTORS)) {
    it(`${alg} digests "abc" correctly (hex)`, () => {
      expect(createHash(alg).update("abc").digest("hex")).toBe(vec.abc);
    });
  }

  it("handles empty input (no update calls)", () => {
    expect(createHash("sha256").digest("hex")).toBe(VECTORS.SHA256.empty);
  });

  it("normalizes algorithm names (sha-256 -> SHA256)", () => {
    expect(createHash("sha-256").update("abc").digest("hex")).toBe(
      VECTORS.SHA256.abc,
    );
  });

  it("digest() with no encoding returns raw bytes", () => {
    const result = createHash("sha256").update("abc").digest();
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(32);
  });

  it("digest('base64') returns the base64 of the raw bytes", () => {
    const result = createHash("sha256").update("abc").digest("base64");
    expect(result).toBe("ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
  });

  it("supports multiple update() calls", () => {
    const result = createHash("sha256")
      .update("a")
      .update("b")
      .update("c")
      .digest("hex");
    expect(result).toBe(VECTORS.SHA256.abc);
  });

  it("throws on unsupported algorithm", () => {
    expect(() => createHash("whirlpool")).toThrow(/Unsupported hash algorithm/);
  });

  it("throws on unsupported encoding", () => {
    expect(() => createHash("sha256").update("abc").digest("utf8")).toThrow(
      /Unsupported digest encoding/,
    );
  });
});

describe("digestAsync", () => {
  it("SHA-256 async matches the sync result", async () => {
    const h = createHash("sha256");
    h.update("abc");
    expect(await h.digestAsync("hex")).toBe(VECTORS.SHA256.abc);
  });

  it("MD5 async falls back to the sync hasher (SubtleCrypto doesn't support it)", async () => {
    const h = createHash("md5");
    h.update("abc");
    expect(await h.digestAsync("hex")).toBe(VECTORS.MD5.abc);
  });
});
