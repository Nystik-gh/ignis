import { describe, it, expect } from "vitest";
import * as zlib from "./zlib.js";

describe("zlib shim", () => {
  it("throws on the sync brotli functions", () => {
    for (const name of ["brotliCompressSync", "brotliDecompressSync"]) {
      expect(() => zlib[name](new Uint8Array([1]))).toThrow(
        `zlib.${name}() is not available in the web version.`,
      );
    }
  });

  it("calls back with an error from the callback brotli functions", async () => {
    for (const name of ["brotliCompress", "brotliDecompress"]) {
      const error = await new Promise((resolve) => {
        zlib[name](new Uint8Array([1]), {}, resolve);
      });

      expect(error.message).toBe(
        `zlib.${name}() is not available in the web version.`,
      );
    }
  });

  it("throws on creating a brotli stream", () => {
    for (const name of ["createBrotliCompress", "createBrotliDecompress"]) {
      expect(() => zlib[name]()).toThrow(
        `zlib.${name}() is not available in the web version.`,
      );
    }
  });
});
