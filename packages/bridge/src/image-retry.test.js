import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initImageRetry } from "./image-retry.js";

let handlers;

function fakeImg(src, connected = true) {
  return { tagName: "IMG", src, isConnected: connected };
}

function fireError(img) {
  handlers.get("error")({ target: img });
}

function fireLoad(img) {
  handlers.get("load")({ target: img });
}

beforeEach(() => {
  handlers = new Map();
  globalThis.document = {
    addEventListener: (type, fn) => handlers.set(type, fn),
    removeEventListener: (type) => handlers.delete(type),
  };
  globalThis.window = {
    location: {
      href: "http://localhost:8080/",
      origin: "http://localhost:8080",
    },
  };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.document;
  delete globalThis.window;
});

describe("image-retry", () => {
  it("retries a failed vault image with a cache-buster, keeping existing params", () => {
    initImageRetry();
    const img = fakeImg("http://localhost:8080/vault-files/v/a.png?vault=v");

    fireError(img);
    vi.advanceTimersByTime(500);

    const url = new URL(img.src);
    expect(url.searchParams.get("ignis-retry")).toBe("1");
    expect(url.searchParams.get("vault")).toBe("v");
    expect(url.pathname).toBe("/vault-files/v/a.png");
  });

  it("ignores images outside /vault-files/", () => {
    initImageRetry();
    const img = fakeImg("https://example.com/vault-files/a.png");
    const before = img.src;

    fireError(img);
    vi.advanceTimersByTime(60000);

    expect(img.src).toBe(before);
  });

  it("stops after the attempt limit", () => {
    initImageRetry();
    const img = fakeImg("http://localhost:8080/vault-files/v/a.png");

    for (const delay of [500, 2000, 8000]) {
      fireError(img);
      vi.advanceTimersByTime(delay);
    }

    expect(new URL(img.src).searchParams.get("ignis-retry")).toBe("3");

    fireError(img);
    vi.advanceTimersByTime(60000);

    expect(new URL(img.src).searchParams.get("ignis-retry")).toBe("3");
  });

  it("does not retry an img that left the document", () => {
    initImageRetry();
    const img = fakeImg("http://localhost:8080/vault-files/v/a.png");
    const before = img.src;

    fireError(img);
    img.isConnected = false;
    vi.advanceTimersByTime(500);

    expect(img.src).toBe(before);
  });

  it("a successful load resets the attempt count", () => {
    initImageRetry();
    const img = fakeImg("http://localhost:8080/vault-files/v/a.png");

    for (const delay of [500, 2000, 8000]) {
      fireError(img);
      vi.advanceTimersByTime(delay);
    }

    fireLoad(img);
    fireError(img);
    vi.advanceTimersByTime(500);

    expect(new URL(img.src).searchParams.get("ignis-retry")).toBe("1");
  });

  it("uninstall clears pending retries and listeners", () => {
    const uninstall = initImageRetry();
    const img = fakeImg("http://localhost:8080/vault-files/v/a.png");
    const before = img.src;

    fireError(img);
    uninstall();
    vi.advanceTimersByTime(60000);

    expect(img.src).toBe(before);
    expect(handlers.size).toBe(0);
  });
});
