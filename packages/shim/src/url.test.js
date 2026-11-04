import { describe, it, expect } from "vitest";
import { urlShim } from "./url.js";

describe("url.parse", () => {
  it("parses an absolute URL into Node's legacy fields", () => {
    expect(urlShim.parse("https://user:pw@a.b:8080/c/d?x=1&x=2#frag")).toEqual({
      protocol: "https:",
      slashes: true,
      auth: "user:pw",
      host: "a.b:8080",
      port: "8080",
      hostname: "a.b",
      hash: "#frag",
      search: "?x=1&x=2",
      query: "x=1&x=2",
      pathname: "/c/d",
      path: "/c/d?x=1&x=2",
      href: "https://user:pw@a.b:8080/c/d?x=1&x=2#frag",
    });
  });

  it("reports absent parts as null", () => {
    expect(urlShim.parse("https://a.b")).toEqual({
      protocol: "https:",
      slashes: true,
      auth: null,
      host: "a.b",
      port: null,
      hostname: "a.b",
      hash: null,
      search: null,
      query: null,
      pathname: "/",
      path: "/",
      href: "https://a.b/",
    });
    expect(urlShim.parse("mailto:x@y.z").slashes).toBe(null);
  });

  it("keeps a bare ? or # as Node does", () => {
    expect(urlShim.parse("https://a.b/c?")).toMatchObject({
      search: "?",
      query: "",
      path: "/c?",
    });
    expect(urlShim.parse("https://a.b/c#")).toMatchObject({
      hash: "#",
      search: null,
    });
  });

  it("keeps the path, query and fragment split of a relative input", () => {
    expect(urlShim.parse("/foo/bar?x=1#h")).toEqual({
      protocol: null,
      slashes: null,
      auth: null,
      host: null,
      port: null,
      hostname: null,
      hash: "#h",
      search: "?x=1",
      query: "x=1",
      pathname: "/foo/bar",
      path: "/foo/bar?x=1",
      href: "/foo/bar?x=1#h",
    });
    expect(urlShim.parse("foo/../bar").pathname).toBe("foo/../bar");
    expect(urlShim.parse("?x=1")).toMatchObject({
      pathname: null,
      search: "?x=1",
      path: "?x=1",
      href: "?x=1",
    });
    expect(urlShim.parse("#h")).toMatchObject({
      pathname: null,
      path: null,
      hash: "#h",
      href: "#h",
    });
  });

  it("parses the query into an object when asked, with arrays for repeated keys", () => {
    const parsed = urlShim.parse("https://a.b/c?d=1&d=2&e=3", true);

    expect(parsed.query).toEqual({ d: ["1", "2"], e: "3" });
    expect(urlShim.parse("/p?a=1&a=2&b", true).query).toEqual({
      a: ["1", "2"],
      b: "",
    });
    expect(urlShim.parse("/p", true).query).toEqual({});
  });

  it("parses the query into a null-prototype object", () => {
    const { query } = urlShim.parse("/p?constructor=x", true);

    expect(Object.getPrototypeOf(query)).toBe(null);
    expect(query.constructor).toBe("x");
  });
});
