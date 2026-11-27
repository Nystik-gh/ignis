import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { proxiedBody, readAheadLimits } from "./proxy-body.js";

const defaults = { ...readAheadLimits };

function bytes(text) {
  return new TextEncoder().encode(text);
}

function readerOf(chunks, { staysOpen, failWith } = {}) {
  let i = 0;

  return {
    read: vi.fn(async () => {
      if (i < chunks.length) {
        return { done: false, value: chunks[i++] };
      }

      if (failWith) {
        throw failWith;
      }

      if (staysOpen) {
        return new Promise(() => {});
      }

      return { done: true };
    }),
    cancel: vi.fn(async () => {}),
    closed: new Promise(() => {}),
  };
}

function flush() {
  return vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  Object.assign(readAheadLimits, defaults);
});

describe("a proxied body nobody has read yet", () => {
  it("is read to its end at once when it is small", async () => {
    const onConnectionFree = vi.fn();
    const reader = readerOf([bytes("small")]);

    const body = proxiedBody(reader, new Uint8Array(0), onConnectionFree);
    await flush();

    expect(onConnectionFree).toHaveBeenCalledOnce();
    expect(await new Response(body).text()).toBe("small");
  });

  it("is read no further than the eager limit at first", async () => {
    readAheadLimits.eagerBytes = 4;
    const reader = readerOf([bytes("aaaa"), bytes("bbbb"), bytes("cccc")]);

    proxiedBody(reader, new Uint8Array(0), vi.fn());
    await flush();

    expect(reader.read).toHaveBeenCalledTimes(1);
  });

  it("is read on into memory once it has gone unread for a while", async () => {
    readAheadLimits.eagerBytes = 4;
    const onConnectionFree = vi.fn();
    const reader = readerOf([bytes("aaaa"), bytes("bbbb"), bytes("cccc")]);

    const body = proxiedBody(reader, new Uint8Array(0), onConnectionFree);
    await vi.advanceTimersByTimeAsync(readAheadLimits.unreadAfterMs - 1);

    expect(onConnectionFree).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(onConnectionFree).toHaveBeenCalledOnce();
    expect(await new Response(body).text()).toBe("aaaabbbbcccc");
  });

  it("is dropped when it stays unread and open, however little arrives", async () => {
    const onConnectionFree = vi.fn();
    const reader = readerOf([bytes("heartbeat")], { staysOpen: true });

    const body = proxiedBody(reader, new Uint8Array(0), onConnectionFree);
    await vi.advanceTimersByTimeAsync(
      readAheadLimits.unreadAfterMs + readAheadLimits.abandonedAfterMs,
    );

    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(onConnectionFree).toHaveBeenCalledOnce();
    await expect(body.getReader().read()).rejects.toThrow(TypeError);
  });

  it("stays readable after it has ended, however long it goes unread", async () => {
    const reader = readerOf([bytes("kept")]);

    const body = proxiedBody(reader, new Uint8Array(0), vi.fn());
    await vi.advanceTimersByTimeAsync(
      readAheadLimits.unreadAfterMs + readAheadLimits.abandonedAfterMs,
    );

    expect(await new Response(body).text()).toBe("kept");
    expect(reader.cancel).not.toHaveBeenCalled();
  });

  it("stops being read at the unread limit, and is dropped when it stays unread", async () => {
    readAheadLimits.eagerBytes = 4;
    readAheadLimits.unreadBytes = 8;
    const onConnectionFree = vi.fn();
    const reader = readerOf([bytes("aaaa"), bytes("bbbb"), bytes("cccc")], {
      staysOpen: true,
    });

    const body = proxiedBody(reader, new Uint8Array(0), onConnectionFree);
    await vi.advanceTimersByTimeAsync(readAheadLimits.unreadAfterMs);

    expect(reader.read).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(readAheadLimits.abandonedAfterMs - 1);

    expect(reader.cancel).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(onConnectionFree).toHaveBeenCalledOnce();
    await expect(body.getReader().read()).rejects.toThrow(TypeError);
  });
});

describe("a proxied body that is being read", () => {
  it("counts the time unread from the last read", async () => {
    readAheadLimits.eagerBytes = 4;
    const reader = readerOf([bytes("aaaa"), bytes("bbbb"), bytes("cccc")], {
      staysOpen: true,
    });

    const body = proxiedBody(reader, new Uint8Array(0), vi.fn());
    await vi.advanceTimersByTimeAsync(readAheadLimits.unreadAfterMs - 1);
    await body.getReader().read();
    await vi.advanceTimersByTimeAsync(readAheadLimits.unreadAfterMs - 1);

    expect(reader.read).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);

    expect(reader.read).toHaveBeenCalledTimes(4);
  });

  it("goes back to the eager limit when it is read again", async () => {
    readAheadLimits.eagerBytes = 4;
    readAheadLimits.unreadBytes = 12;
    const chunks = Array.from({ length: 6 }, () => bytes("aaaa"));
    const reader = readerOf(chunks, { staysOpen: true });

    const body = proxiedBody(reader, new Uint8Array(0), vi.fn());
    await vi.advanceTimersByTimeAsync(readAheadLimits.unreadAfterMs);
    await body.getReader().read();
    await flush();

    expect(reader.read).toHaveBeenCalledTimes(3);
  });

  it("is not dropped while a read waits on a quiet upstream", async () => {
    const onConnectionFree = vi.fn();
    const reader = readerOf([bytes("event")], { staysOpen: true });

    const bodyReader = proxiedBody(
      reader,
      new Uint8Array(0),
      onConnectionFree,
    ).getReader();
    await bodyReader.read();
    const waiting = bodyReader.read();
    await vi.advanceTimersByTimeAsync(
      readAheadLimits.unreadAfterMs + readAheadLimits.abandonedAfterMs,
    );

    expect(reader.cancel).not.toHaveBeenCalled();
    expect(onConnectionFree).not.toHaveBeenCalled();

    waiting.catch(() => {});
  });

  it("frees the connection and cancels the proxy response when it is cancelled", async () => {
    readAheadLimits.eagerBytes = 1;
    const onConnectionFree = vi.fn();
    const reader = readerOf([bytes("a")], { staysOpen: true });

    const body = proxiedBody(reader, new Uint8Array(0), onConnectionFree);
    await body.cancel("done reading");
    await vi.advanceTimersByTimeAsync(
      readAheadLimits.unreadAfterMs + readAheadLimits.abandonedAfterMs,
    );

    expect(reader.cancel).toHaveBeenCalledExactlyOnceWith("done reading");
    expect(reader.read).toHaveBeenCalledTimes(1);
    expect(onConnectionFree).toHaveBeenCalled();
  });

  it("frees the connection and errors when the proxy response fails with no read under way", async () => {
    readAheadLimits.eagerBytes = 1;
    const onConnectionFree = vi.fn();
    const failWith = new DOMException("aborted", "AbortError");
    const reader = readerOf([bytes("a")], { staysOpen: true });
    let failClosed;
    reader.closed = new Promise((_, reject) => {
      failClosed = reject;
    });

    const body = proxiedBody(reader, new Uint8Array(0), onConnectionFree);
    await flush();
    failClosed(failWith);
    await flush();

    expect(onConnectionFree).toHaveBeenCalledOnce();
    await expect(body.getReader().read()).rejects.toBe(failWith);
  });

  it("frees the connection and errors when the proxy response breaks off", async () => {
    const onConnectionFree = vi.fn();
    const failWith = new TypeError("network error");
    const reader = readerOf([bytes("a")], { failWith });

    const body = proxiedBody(reader, new Uint8Array(0), onConnectionFree);
    const text = new Response(body).text();
    text.catch(() => {});
    await flush();

    await expect(text).rejects.toBe(failWith);
    expect(onConnectionFree).toHaveBeenCalledOnce();
  });
});
