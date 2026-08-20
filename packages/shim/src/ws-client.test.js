import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWsClient } from "./ws-client.js";

let sockets;

beforeEach(() => {
  sockets = [];

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      sockets.push(this);
    }
    send() {}
    close() {}
  }

  FakeWebSocket.OPEN = 1;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.window = { location: { protocol: "http:", host: "localhost" } };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.WebSocket;
  delete globalThis.window;
});

describe("ws-client onOpen", () => {
  it("fires on the first open and again on a re-open", () => {
    const client = createWsClient();
    const onOpen = vi.fn();
    client.onOpen(onOpen);

    client.connect("v1");
    sockets[0].onopen();
    expect(onOpen).toHaveBeenCalledTimes(1);

    sockets[0].onclose();
    vi.advanceTimersByTime(2000);
    sockets[1].onopen();

    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("stops firing after unsubscribe", () => {
    const client = createWsClient();
    const onOpen = vi.fn();
    const off = client.onOpen(onOpen);

    client.connect("v1");
    sockets[0].onopen();
    off();

    sockets[0].onclose();
    vi.advanceTimersByTime(2000);
    sockets[1].onopen();

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
