const http = require("http");
const https = require("https");
const zlib = require("zlib");
const {
  addressAllowed,
  ipLiteral,
  httpError,
  privateHostError,
  safeLookup,
} = require("./ssrf-guard");

const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
const UPSTREAM_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_REDIRECTS = 5;
const MAX_REDIRECT_BODY_BYTES = 64 * 1024;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const FRAMING_HEADERS = new Set(["content-length", "transfer-encoding"]);
const CREDENTIAL_HEADERS = new Set(["authorization", "cookie"]);
const HOST_HEADER = new Set(["host"]);
const REQUEST_BODY_HEADERS = new Set([
  "content-type",
  "content-encoding",
  "content-language",
  "content-location",
]);
const NORMALIZED_METHODS = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
]);

function sameOrigin(a, b) {
  return a.protocol === b.protocol && a.host === b.host;
}

function withoutHeaders(headers, names) {
  const out = {};

  for (const [key, val] of Object.entries(headers)) {
    if (!names.has(key.toLowerCase())) {
      out[key] = val;
    }
  }

  return out;
}

// Let the proxy handle the Content-Length and Transfer-Encoding headers itself.
function stripRequestFramingHeaders(headers) {
  return withoutHeaders(headers, FRAMING_HEADERS);
}

function normalizeMethod(method) {
  const isAsciiWord = typeof method === "string" && /^[a-z]+$/i.test(method);
  const upper = isAsciiWord ? method.toUpperCase() : null;

  return NORMALIZED_METHODS.has(upper) ? upper : method;
}

function redirectBecomesGet(status, method) {
  if (status === 303) {
    return method !== "GET" && method !== "HEAD";
  }

  return (status === 301 || status === 302) && method === "POST";
}

function upstreamTooLarge() {
  return httpError(413, "Upstream response too large", {
    code: "upstream-too-large",
    expose: true,
  });
}

function connectionError(e) {
  if (e.block || e.expose || !e.code) {
    return e;
  }

  return httpError(502, `Upstream connection failed (${e.code})`, {
    code: e.code,
    expose: true,
  });
}

function requestOnce(
  targetUrl,
  method,
  headers,
  body,
  { signal, idleTimeoutMs = UPSTREAM_IDLE_TIMEOUT_MS } = {},
) {
  return new Promise((resolve, reject) => {
    const mod = targetUrl.protocol === "https:" ? https : http;
    const outHeaders = stripRequestFramingHeaders(headers);
    const hasBody = body != null && method !== "GET" && method !== "HEAD";

    if (hasBody) {
      // Set Content-Length from the exact bytes written.
      // Avoids rejection from upstreams that do not accept chunked uploads.
      outHeaders["Content-Length"] = Buffer.byteLength(body);
    }

    let response = null;

    const req = mod.request(
      targetUrl,
      {
        method,
        headers: outHeaders,
        lookup: safeLookup,
        signal,
        timeout: idleTimeoutMs,
      },
      (res) => {
        response = res;
        resolve(res);
      },
    );

    req.on("timeout", () => {
      const timedOut = httpError(504, "Upstream timed out", {
        code: "upstream-timeout",
        expose: true,
      });

      if (response) {
        response.destroy(timedOut);
      }

      req.destroy(timedOut);
    });

    req.on("error", (e) => reject(connectionError(e)));

    if (hasBody) {
      req.write(body);
    }

    req.end();
  });
}

function discardRedirectBody(res) {
  let received = 0;

  res.on("data", (chunk) => {
    received += chunk.length;

    if (received > MAX_REDIRECT_BODY_BYTES) {
      res.destroy();
    }
  });
}

// Follow redirects manually so every hop runs through safeLookup and is re-checked.
async function proxyRequest({
  url,
  method,
  headers,
  body,
  signal,
  idleTimeoutMs,
}) {
  let current = new URL(url);
  let currentMethod = normalizeMethod(method);
  let currentHeaders = headers;
  let currentBody = body;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw httpError(400, "Only http and https URLs are allowed");
    }

    // An IP-literal host skips DNS, so safeLookup never runs for it; check it here.
    const literal = ipLiteral(current.hostname);

    if (literal && !addressAllowed(literal)) {
      throw privateHostError(literal);
    }

    const res = await requestOnce(
      current,
      currentMethod,
      currentHeaders,
      currentBody,
      { signal, idleTimeoutMs },
    );

    if (!REDIRECT_CODES.has(res.statusCode) || !res.headers.location) {
      return res;
    }

    discardRedirectBody(res);
    const next = new URL(res.headers.location, current);

    currentHeaders = withoutHeaders(currentHeaders, HOST_HEADER);

    // The caller did not choose the redirect target, so credentials do not cross origins.
    if (!sameOrigin(current, next)) {
      currentHeaders = withoutHeaders(currentHeaders, CREDENTIAL_HEADERS);
    }

    if (redirectBecomesGet(res.statusCode, currentMethod)) {
      currentMethod = "GET";
      currentBody = null;
      currentHeaders = withoutHeaders(currentHeaders, REQUEST_BODY_HEADERS);
    }

    current = next;
  }

  throw httpError(508, "Too many redirects", {
    code: "too-many-redirects",
    expose: true,
  });
}

function createBodyDecompressor(res) {
  const isBodiless =
    res.req.method === "HEAD" ||
    res.statusCode === 204 ||
    res.statusCode === 304;

  if (isBodiless) {
    return null;
  }

  const encoding = (res.headers["content-encoding"] || "").toLowerCase();

  if (encoding === "gzip" || encoding === "x-gzip") {
    return zlib.createGunzip();
  }

  if (encoding === "deflate") {
    return zlib.createInflate();
  }

  if (encoding === "br") {
    return zlib.createBrotliDecompress();
  }

  return null;
}

function relayedHeaders(res) {
  // Strip hop-by-hop and encoding headers; the body is already decompressed.
  const skipHeaders = new Set([
    "content-encoding",
    "transfer-encoding",
    "content-length",
    "connection",
  ]);
  const headers = {};

  for (const [key, val] of Object.entries(res.headers)) {
    if (!skipHeaders.has(key.toLowerCase())) {
      headers[key] = val;
    }
  }

  return headers;
}

function readBody(res, maxBytes) {
  return new Promise((resolve, reject) => {
    let stream = res;
    const decompressor = createBodyDecompressor(res);

    if (decompressor) {
      stream = res.pipe(decompressor);
    }

    const chunks = [];
    let total = 0;
    let settled = false;

    function fail(err) {
      if (settled) {
        return;
      }

      settled = true;
      res.destroy();

      if (decompressor) {
        decompressor.destroy();
      }

      reject(err);
    }

    stream.on("data", (chunk) => {
      total += chunk.length;

      if (total > maxBytes) {
        fail(upstreamTooLarge());
        return;
      }

      chunks.push(chunk);
    });

    stream.on("end", () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(Buffer.concat(chunks));
    });

    if (decompressor) {
      decompressor.on("error", () =>
        fail(
          httpError(502, "Could not decode the upstream response", {
            code: "decode-failed",
            expose: true,
          }),
        ),
      );
    }

    res.on("error", (e) => fail(connectionError(e)));
  });
}

async function relayOnce({
  url,
  method,
  headers,
  body,
  signal,
  idleTimeoutMs,
}) {
  const upstream = await proxyRequest({
    url,
    method,
    headers,
    body,
    signal,
    idleTimeoutMs,
  });
  const declaredLength = Number(upstream.headers["content-length"]);

  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    upstream.destroy();
    throw upstreamTooLarge();
  }

  const respBody = await readBody(upstream, MAX_RESPONSE_BYTES);

  return {
    status: upstream.statusCode,
    headers: relayedHeaders(upstream),
    body: respBody.toString("base64"),
  };
}

async function openRelayStream(args) {
  const upstream = await proxyRequest(args);
  const decompressor = createBodyDecompressor(upstream);

  return {
    status: upstream.statusCode,
    headers: relayedHeaders(upstream),
    bodyStreams: decompressor ? [upstream, decompressor] : [upstream],
  };
}

module.exports = {
  relayOnce,
  openRelayStream,
  proxyRequest,
  requestOnce,
  stripRequestFramingHeaders,
};
