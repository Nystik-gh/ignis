import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { versionedSrc, cacheControlFor } = require("./cache-headers.js");

describe("versionedSrc", () => {
  it("appends ?v when the src has no query", () => {
    expect(versionedSrc("app.js", "1.13.7")).toBe("app.js?v=1.13.7");
  });

  it("appends &v when the src already has a query", () => {
    expect(versionedSrc("a.js?x=1", "1.13.7")).toBe("a.js?x=1&v=1.13.7");
  });

  it("leaves the src unchanged when the version is missing", () => {
    expect(versionedSrc("app.js", null)).toBe("app.js");
  });
});

describe("cacheControlFor", () => {
  it("is immutable for a versioned asset", () => {
    expect(cacheControlFor("/app.js", true)).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("is a short cache for an unversioned asset", () => {
    expect(cacheControlFor("/app.js", false)).toBe("public, max-age=300");
  });

  it("covers css, fonts, wasm, and sourcemaps", () => {
    for (const p of ["/app.css", "/x.woff2", "/x.ttf", "/x.wasm", "/x.js.map"]) {
      expect(cacheControlFor(p, true)).toContain("immutable");
    }
  });

  it("leaves unmanaged paths to express.static", () => {
    expect(cacheControlFor("/api/bootstrap", false)).toBeNull();
    expect(cacheControlFor("/image.png", true)).toBeNull();
    expect(cacheControlFor("/", false)).toBeNull();
  });
});
