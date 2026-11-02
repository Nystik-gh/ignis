import { describe, it, expect, beforeAll, afterAll } from "vitest";

describe("window.require", () => {
  const stubs = {
    window: globalThis,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { body: { classList: { contains: () => false } } },
    location: { origin: "http://localhost", href: "http://localhost/" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };

  beforeAll(async () => {
    Object.assign(globalThis, stubs);
    const { installRequire } = await import("./require.js");
    installRequire();
  });

  afterAll(() => {
    delete globalThis.require;

    for (const key of Object.keys(stubs)) {
      delete globalThis[key];
    }
  });

  it("resolves process and node:process to the process shim", () => {
    const process = window.require("process");

    expect(window.require("node:process")).toBe(process);
    expect(process.cwd()).toBe("/");
    expect(process.platform).toBe("linux");
  });

  it("resolves fs/promises and node:fs/promises to fs.promises", () => {
    const promises = window.require("fs").promises;

    for (const name of ["fs/promises", "node:fs/promises"]) {
      const required = window.require(name);

      expect(required.readFile).toBe(promises.readFile);
      expect(required.writeFile).toBe(promises.writeFile);
    }
  });

  it("resolves events and node:events to the EventEmitter constructor", () => {
    const EventEmitter = window.require("events");

    expect(typeof EventEmitter).toBe("function");
    expect(window.require("node:events")).toBe(EventEmitter);
    expect(EventEmitter.EventEmitter).toBe(EventEmitter);
    expect(new EventEmitter().emit("ping")).toBe(false);
  });

  it("resolves buffer to a module object exposing the Buffer global", () => {
    expect(window.require("buffer").Buffer).toBe(window.Buffer);
  });

  it("resolves tty to a shim that reports no terminal", () => {
    expect(window.require("tty").isatty(1)).toBe(false);
  });

  it("returns window.require from module.createRequire", () => {
    const { createRequire } = window.require("node:module");

    expect(createRequire("/vault/plugin/main.js")).toBe(window.require);
  });

  it("lists the registry's modules in module.builtinModules", () => {
    const { builtinModules } = window.require("module");

    expect(builtinModules).toContain("fs");
    expect(builtinModules).toContain("module");
    expect(builtinModules).toContain("worker_threads");
  });

  it("resolves worker_threads to a shim that reports the main thread", () => {
    expect(window.require("node:worker_threads").isMainThread).toBe(true);
  });
});
