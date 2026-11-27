import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGIN = "http://ignis.test";
let takeProxySlot;

function pageLoadedOver(entries) {
  vi.stubGlobal("location", { origin: ORIGIN });
  vi.stubGlobal("performance", {
    getEntriesByType: (type) => entries[type] || [],
  });
}

function takeSlots(count) {
  return Promise.all(Array.from({ length: count }, () => takeProxySlot()));
}

function isWaiting(promise) {
  const waiting = Symbol("waiting");

  return Promise.race([promise, Promise.resolve(waiting)]).then(
    (first) => first === waiting,
  );
}

beforeEach(async () => {
  vi.resetModules();
  ({ takeProxySlot } = await import("./proxy-slots.js"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a page loaded over HTTP/1.1", () => {
  beforeEach(() => {
    pageLoadedOver({
      navigation: [{ name: `${ORIGIN}/`, nextHopProtocol: "http/1.1" }],
    });
  });

  it("makes the fifth request wait until a slot is released", async () => {
    const [release] = await takeSlots(4);
    const fifth = takeProxySlot();

    expect(await isWaiting(fifth)).toBe(true);

    release();

    expect(await isWaiting(fifth)).toBe(false);
  });

  it("frees one slot when a slot is released twice", async () => {
    const [release] = await takeSlots(4);
    const fifth = takeProxySlot();
    const sixth = takeProxySlot();

    release();
    release();

    expect(await isWaiting(fifth)).toBe(false);
    expect(await isWaiting(sixth)).toBe(true);
  });

  it("rejects a waiting request that is aborted, and gives it no slot", async () => {
    const [release] = await takeSlots(4);
    const abort = new AbortController();
    const aborted = takeProxySlot(abort.signal);
    const next = takeProxySlot();

    abort.abort();

    await expect(aborted).rejects.toBe(abort.signal.reason);

    release();

    expect(await isWaiting(next)).toBe(false);
  });

  it("stops listening to the signal of a request that got its slot", async () => {
    const [release] = await takeSlots(4);
    const abort = new AbortController();
    const removed = vi.spyOn(abort.signal, "removeEventListener");
    const fifth = takeProxySlot(abort.signal);

    release();
    await fifth;

    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("rejects a request whose signal is already aborted", async () => {
    const signal = AbortSignal.abort();

    await expect(takeProxySlot(signal)).rejects.toBe(signal.reason);
  });
});

describe("a page loaded over HTTP/2 or HTTP/3", () => {
  it.each(["h2", "h3"])(
    "lets any number of requests through on %s",
    async (protocol) => {
      pageLoadedOver({
        navigation: [{ name: `${ORIGIN}/`, nextHopProtocol: protocol }],
      });

      await takeSlots(4);

      expect(await isWaiting(takeProxySlot())).toBe(false);
    },
  );

  it("is recognised from a resource of the page's origin", async () => {
    pageLoadedOver({
      navigation: [{ name: `${ORIGIN}/`, nextHopProtocol: "" }],
      resource: [{ name: `${ORIGIN}/shim-loader.js`, nextHopProtocol: "h2" }],
    });

    await takeSlots(4);

    expect(await isWaiting(takeProxySlot())).toBe(false);
  });

  it("is not assumed from a resource of another origin", async () => {
    pageLoadedOver({
      navigation: [{ name: `${ORIGIN}/`, nextHopProtocol: "http/1.1" }],
      resource: [{ name: `${ORIGIN}:8443/x.js`, nextHopProtocol: "h2" }],
    });

    await takeSlots(4);

    expect(await isWaiting(takeProxySlot())).toBe(true);
  });
});
