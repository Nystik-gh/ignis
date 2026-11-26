// Sends cross-origin requests through the server proxy and returns the upstream response.
// Throws an Error with the server's message and code.

import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64.js";
import { isProxyBlock, reportProxyBlock } from "./proxy-block.js";

const PREAMBLE_LENGTH_BYTES = 4;
const MAX_PREAMBLE_BYTES = 1024 * 1024;

function encodeBody(body) {
  if (body instanceof ArrayBuffer) {
    return { body: arrayBufferToBase64(body), binary: true };
  }

  if (body instanceof Uint8Array) {
    // A Uint8Array can be a view into a larger buffer (nonzero byteOffset, or shorter byteLength), so encode only the view's region.
    const region = body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength,
    );

    return { body: arrayBufferToBase64(region), binary: true };
  }

  return { body: body ?? null, binary: false };
}

async function postToProxy({ url, method, headers, body, signal }, mode) {
  const payload = {
    url,
    method: method || "GET",
    headers: headers || {},
    ...encodeBody(body),
    ...mode,
  };

  // Use native fetch to avoid an unnecessary call through the shim. proxy is already same origin.
  const nativeFetch = window.__originalFetch || fetch;

  const res = await nativeFetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));

    if (isProxyBlock(err)) {
      reportProxyBlock(err);
    }

    const error = new Error(err.error || "Proxy request failed");

    if (err.code) {
      error.code = err.code;
    }

    throw error;
  }

  return res;
}

export async function proxyFetch(request) {
  const res = await postToProxy(request, {});
  const result = await res.json();

  return {
    status: result.status,
    headers: result.headers,
    body: base64ToArrayBuffer(result.body),
  };
}

function concatBytes(first, second) {
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);

  return joined;
}

async function readUntil(reader, received, length) {
  while (received.length < length) {
    const { done, value } = await reader.read();

    if (done) {
      throw new Error("Proxy request failed");
    }

    received = concatBytes(received, value);
  }

  return received;
}

async function readPreamble(reader) {
  let received = new Uint8Array(0);
  received = await readUntil(reader, received, PREAMBLE_LENGTH_BYTES);
  const preambleLength = new DataView(received.buffer).getUint32(0);

  if (preambleLength > MAX_PREAMBLE_BYTES) {
    throw new Error("Proxy request failed");
  }

  const end = PREAMBLE_LENGTH_BYTES + preambleLength;
  received = await readUntil(reader, received, end);
  const { status, headers } = JSON.parse(
    new TextDecoder().decode(received.subarray(PREAMBLE_LENGTH_BYTES, end)),
  );

  return { status, headers, firstBodyBytes: received.slice(end) };
}

async function readNonEmptyChunk(reader) {
  let chunk = await reader.read();

  while (!chunk.done && chunk.value.length === 0) {
    chunk = await reader.read();
  }

  return chunk;
}

export async function openProxyStream(request) {
  const res = await postToProxy(request, { stream: true });
  const reader = res.body.getReader();
  let preamble;

  try {
    preamble = await readPreamble(reader);
  } catch (e) {
    reader.cancel().catch(() => {});
    throw e;
  }

  const { status, headers, firstBodyBytes } = preamble;

  const body = new ReadableStream({
    type: "bytes",

    start(controller) {
      if (firstBodyBytes.length > 0) {
        controller.enqueue(firstBodyBytes);
      }
    },

    async pull(controller) {
      const { done, value } = await readNonEmptyChunk(reader);

      if (done) {
        controller.close();
        controller.byobRequest?.respond(0); // end caller's buffer read.
        return;
      }

      controller.enqueue(value);
    },

    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return { status, headers, body };
}
