import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StringDecoder } from "node:string_decoder";
import { http } from "../http.js";
import { EventEmitter } from "../events.js";
import { setDirectFetchHosts } from "../../util/url.js";

const DIRECT = "http://hermes.lan:8642";
const LATE_EVENT_WAIT_MS = 40;

let calls;
let respond;

beforeEach(() => {
  calls = [];
  respond = () => proxyReply(200, {}, "");

  globalThis.window = {
    location: { origin: "https://ignis.test" },
    __originalFetch: async (url, opts) => {
      const call = { url, ...opts };

      if (url === "/api/proxy") {
        Object.assign(call, JSON.parse(opts.body));
      }

      calls.push(call);

      return respond(call);
    },
  };

  setDirectFetchHosts(["hermes.lan"]);
});

afterEach(() => {
  setDirectFetchHosts([]);
  delete globalThis.window;
});

function proxyReply(status, headers, body) {
  return new Response(
    JSON.stringify({
      status,
      headers,
      body: Buffer.from(body).toString("base64"),
    }),
    { status: 200 },
  );
}

function streamedReply(chunks, gapMs = 0, { signal, ...init } = {}) {
  let i = 0;
  const stream = new ReadableStream({
    start(controller) {
      signal?.addEventListener("abort", () =>
        controller.error(new DOMException("aborted", "AbortError")),
      );
    },
    async pull(controller) {
      await new Promise((r) => setTimeout(r, gapMs));

      if (i < chunks.length) {
        const chunk = chunks[i++];
        controller.enqueue(
          typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
        );
      } else {
        controller.close();
      }
    },
  });

  return new Response(stream, init);
}

function resetMidBodyReply(chunk) {
  let sent = false;
  const stream = new ReadableStream({
    pull(controller) {
      if (sent) {
        controller.error(new TypeError("network error"));
      } else {
        sent = true;
        controller.enqueue(new TextEncoder().encode(chunk));
      }
    },
  });

  return new Response(stream);
}

function record(emitter, prefix, log, events) {
  for (const event of events) {
    emitter.on(event, (arg) =>
      log.push(
        arg?.message ? `${prefix}${event}:${arg.message}` : `${prefix}${event}`,
      ),
    );
  }
}

function collect(req) {
  return new Promise((resolve) => {
    const log = [];
    const chunks = [];

    record(req, "req:", log, ["error", "timeout"]);
    req.on("response", (res) => {
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => log.push("res:end"));
      res.on("close", () => log.push("res:close"));
    });
    req.on("close", () => {
      log.push("req:close");
      setTimeout(
        () => resolve({ res: req.res, log, chunks }),
        LATE_EVENT_WAIT_MS,
      );
    });
  });
}

function responseTo(url) {
  return new Promise((resolve) => http.get(url, resolve));
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("a direct-fetch host's response body", () => {
  it("arrives chunk by chunk as the host sends it", async () => {
    respond = () => streamedReply(["data: a\n\n", "data: b\n\n"]);

    const { chunks, log } = await collect(
      http.get(`${DIRECT}/v1/runs/1/events`),
    );

    expect(calls[0].url).toBe(`${DIRECT}/v1/runs/1/events`);
    expect(chunks.map(String)).toEqual(["data: a\n\n", "data: b\n\n"]);
    expect(log).toEqual(["res:end", "req:close", "res:close"]);
  });

  it("comes without the encoding and length headers of a body the browser decoded", async () => {
    respond = () =>
      streamedReply(["hello"], 0, {
        headers: {
          "content-encoding": "gzip",
          "content-length": "25",
          "content-type": "text/plain",
        },
      });

    const res = await responseTo(`${DIRECT}/`);

    expect(res.headers).toEqual({ "content-type": "text/plain" });
  });

  it("keeps the length header of a body that was not encoded", async () => {
    respond = () =>
      streamedReply(["hello"], 0, { headers: { "content-length": "5" } });

    const res = await responseTo(`${DIRECT}/`);

    expect(res.headers["content-length"]).toBe("5");
  });

  it("ends at once when there is none", async () => {
    respond = () => new Response(null, { status: 204 });

    const { res, chunks, log } = await collect(http.get(`${DIRECT}/`));

    expect(res.statusCode).toBe(204);
    expect(chunks).toEqual([]);
    expect(log).toEqual(["res:end", "req:close", "res:close"]);
  });

  it("is held until a data listener is added", async () => {
    respond = () => streamedReply(["a", "b"]);

    const res = await responseTo(`${DIRECT}/`);
    await wait(20);
    const parts = [];

    await new Promise((resolve) => {
      res.on("data", (c) => parts.push(String(c)));
      res.on("end", resolve);
    });

    expect(parts).toEqual(["a", "b"]);
  });

  it("stops while paused and continues on resume", async () => {
    respond = () => streamedReply(["a", "b", "c"], 60);

    const res = await responseTo(`${DIRECT}/`);
    const parts = [];

    res.on("data", (c) => {
      parts.push(String(c));

      if (parts.length === 1) {
        setTimeout(() => res.pause(), 10);
      }
    });
    await wait(200);

    expect(parts).toEqual(["a"]);

    await new Promise((resolve) => {
      res.on("end", resolve);
      res.resume();
    });

    expect(parts).toEqual(["a", "b", "c"]);
  });

  it("stays paused when a data listener is added after pause()", async () => {
    respond = () => streamedReply(["a"]);

    const res = await responseTo(`${DIRECT}/`);
    const parts = [];
    res.pause();
    res.on("data", (c) => parts.push(String(c)));
    await wait(30);

    expect(parts).toEqual([]);
  });

  it("is discarded when the request has no response listener", async () => {
    respond = () => streamedReply(["a"]);

    await new Promise((resolve) => {
      http.get(`${DIRECT}/`).on("close", resolve);
    });
  });

  it("that fails midway aborts the response", async () => {
    respond = () => resetMidBodyReply("a");

    const log = [];
    const req = http.get(`${DIRECT}/`, (res) => {
      record(res, "res:", log, ["aborted", "error", "end", "close"]);
      res.on("data", () => {});
    });
    record(req, "req:", log, ["close"]);
    await new Promise((resolve) => req.on("close", resolve));
    await wait(10);

    expect(log).toEqual([
      "res:aborted",
      "req:close",
      "res:error:aborted",
      "res:close",
    ]);
  });
});

describe("a proxied response body", () => {
  it("emits no data when it is empty", async () => {
    respond = () => proxyReply(200, {}, "");

    const { chunks, log } = await collect(http.get("http://api.example.test/"));

    expect(chunks).toEqual([]);
    expect(log).toEqual(["res:end", "req:close", "res:close"]);
  });
});

describe("a listener that throws", () => {
  async function runWithThrowingListener(attach) {
    const thrown = [];
    const onRejection = (e) => thrown.push(e.message);
    process.on("unhandledRejection", onRejection);

    try {
      respond = (call) =>
        streamedReply(["a", "b"], 20, { signal: call.signal });
      const log = [];
      const req = http.get(`${DIRECT}/`, (res) => {
        record(res, "res:", log, ["end", "close"]);
        attach(res);
      });
      record(req, "req:", log, ["close"]);
      await new Promise((resolve) => req.on("close", resolve));
      await wait(20);

      return { log, thrown };
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  }

  it("on data ends the request and releases the host", async () => {
    const { log, thrown } = await runWithThrowingListener((res) =>
      res.on("data", () => {
        throw new Error("boom");
      }),
    );

    expect(thrown).toEqual(["boom"]);
    expect(log).toEqual(["req:close", "res:close"]);
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("on end still closes the request", async () => {
    const { log, thrown } = await runWithThrowingListener((res) => {
      res.on("data", () => {});
      res.on("end", () => {
        throw new Error("boom");
      });
    });

    expect(thrown).toEqual(["boom"]);
    expect(log).toEqual(["res:end", "req:close", "res:close"]);
  });
});

describe("text from setEncoding", () => {
  const cases = [
    [
      "utf8",
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("aé€z")]),
    ],
    ["base64", Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03])],
    ["utf16le", Buffer.from("héllo€", "utf16le")],
    ["latin1", Buffer.from("café", "latin1")],
  ];

  for (const [encoding, source] of cases) {
    it(`matches Node's chunked decoding for ${encoding}`, async () => {
      const chunks = [];

      for (let i = 0; i < source.length; i += 5) {
        chunks.push(new Uint8Array(source.subarray(i, i + 5)));
      }

      const decoder = new StringDecoder(encoding);
      const expected = [
        ...chunks.map((c) => decoder.write(Buffer.from(c))),
        decoder.end(),
      ].filter((s) => s.length > 0);

      respond = () => streamedReply(chunks);
      const res = await responseTo(`${DIRECT}/`);
      res.setEncoding(encoding);
      const received = await new Promise((resolve) => {
        const out = [];
        res.on("data", (s) => out.push(s));
        res.on("end", () => resolve(out));
      });

      expect(received).toEqual(expected);
    });
  }

  it("defaults to utf8 with no encoding or null", async () => {
    respond = () => streamedReply(["hé"]);

    for (const encoding of [undefined, null]) {
      const res = await responseTo(`${DIRECT}/`);
      res.setEncoding(encoding);
      const text = await new Promise((resolve) => res.on("data", resolve));

      expect(text).toBe("hé");
    }
  });
});

describe("reading a response with for await", () => {
  it("yields each non-empty chunk and completes the response", async () => {
    respond = () => streamedReply(["a", "", "b"]);

    const res = await responseTo(`${DIRECT}/`);
    const parts = [];

    for await (const chunk of res) {
      parts.push(String(chunk));
    }

    expect(parts).toEqual(["a", "b"]);
    expect(res.complete).toBe(true);
  });

  it("closes the request and releases the host on break", async () => {
    respond = () => streamedReply(["a", "b", "c"], 20);

    const log = [];
    const req = http.get(`${DIRECT}/`, { timeout: 200 });
    record(req, "req:", log, ["timeout", "close"]);
    const res = await new Promise((resolve) => req.on("response", resolve));
    record(res, "res:", log, ["close"]);

    for await (const chunk of res) {
      expect(String(chunk)).toBe("a");
      break;
    }

    await wait(250);

    expect(log).toEqual(["req:close", "res:close"]);
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("throws Node's aborted error when the body fails", async () => {
    respond = () => resetMidBodyReply("a");

    const res = await responseTo(`${DIRECT}/`);
    let error;

    try {
      for await (const chunk of res) {
        expect(String(chunk)).toBe("a");
      }
    } catch (e) {
      error = e;
    }

    expect(error.message).toBe("aborted");
    expect(error.code).toBe("ECONNRESET");
  });
});

describe("destroying a response", () => {
  async function destroyOnFirstChunk(error) {
    respond = (call) => streamedReply(["a", "b"], 30, { signal: call.signal });

    const log = [];
    const req = http.get(`${DIRECT}/`, (res) => {
      record(res, "res:", log, ["aborted", "error", "close"]);
      res.on("data", () => {
        res.destroy(error);
        log.push(`destroyed:${res.destroyed}`);
      });
    });
    record(req, "req:", log, ["error", "close"]);
    await new Promise((resolve) => req.on("close", resolve));
    await wait(10);

    return log;
  }

  it("with no error aborts it in Node's order and releases the host", async () => {
    expect(await destroyOnFirstChunk()).toEqual([
      "destroyed:true",
      "res:aborted",
      "res:close",
      "req:close",
    ]);
    expect(calls[0].signal.aborted).toBe(true);
  });

  it("with an error emits it on the request and the response", async () => {
    expect(await destroyOnFirstChunk(new Error("mine"))).toEqual([
      "destroyed:true",
      "res:aborted",
      "req:error:mine",
      "res:error:mine",
      "res:close",
      "req:close",
    ]);
  });
});

describe("piping a response", () => {
  it("writes each chunk to the destination and ends it", async () => {
    respond = () => streamedReply(["a", "b"]);

    const res = await responseTo(`${DIRECT}/`);
    const written = [];

    await new Promise((resolve) => {
      res.pipe({
        write: (chunk) => written.push(String(chunk)),
        end: resolve,
      });
    });

    expect(written).toEqual(["a", "b"]);
  });

  it("waits for drain when the destination is full", async () => {
    respond = () => streamedReply(["a", "b"]);

    const res = await responseTo(`${DIRECT}/`);
    const destination = new EventEmitter();
    const written = [];
    destination.write = (chunk) => written.push(String(chunk)) > 1;
    destination.end = () => destination.emit("ended");
    res.pipe(destination);
    await wait(30);

    expect(written).toEqual(["a"]);

    await new Promise((resolve) => {
      destination.on("ended", resolve);
      destination.emit("drain");
    });

    expect(written).toEqual(["a", "b"]);
  });

  it("leaves the destination open with end: false", async () => {
    respond = () => streamedReply(["a"]);

    const res = await responseTo(`${DIRECT}/`);
    let ended = false;
    res.pipe({ write: () => true, end: () => (ended = true) }, { end: false });
    await new Promise((resolve) => res.on("end", resolve));

    expect(ended).toBe(false);
  });
});
