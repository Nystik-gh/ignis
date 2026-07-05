const express = require("express");
const dns = require("dns");
const net = require("net");
const http = require("http");
const https = require("https");
const zlib = require("zlib");
const settings = require("../settings");
const { sanitizeError } = require("@ignis/server-core");

const router = express.Router();

const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function isPrivateIp(ip) {
  const type = net.isIP(ip);

  if (type === 4) {
    const o = ip.split(".").map(Number);

    return (
      o[0] === 0 ||
      o[0] === 10 ||
      o[0] === 127 ||
      (o[0] === 169 && o[1] === 254) ||
      (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
      (o[0] === 192 && o[1] === 168) ||
      (o[0] === 100 && o[1] >= 64 && o[1] <= 127)
    );
  }

  if (type === 6) {
    const a = ip.toLowerCase();

    if (a === "::1" || a === "::") {
      return true;
    }

    if (/^fe[89ab]/.test(a) || a.startsWith("fc") || a.startsWith("fd")) {
      return true;
    }

    const mapped = a.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);

    if (mapped) {
      return isPrivateIp(mapped[1]);
    }

    return false;
  }

  return false;
}

function ipv4ToInt(ip) {
  return ip
    .split(".")
    .reduce((acc, oct) => ((acc << 8) + Number(oct)) >>> 0, 0);
}

// Parse PROXY_ALLOW_PRIVATE_HOSTS into matchers.
// Exact IPs (v4 and v6) and IPv4 CIDRs are supported; IPv6 CIDR and malformed entries are ignored.
function buildAllowList(entries) {
  const exact = new Set();
  const cidrV4 = [];

  for (const entry of entries) {
    const slash = entry.indexOf("/");

    if (slash === -1) {
      if (net.isIP(entry)) {
        exact.add(entry);
      } else {
        console.warn(
          "[proxy] ignoring invalid PROXY_ALLOW_PRIVATE_HOSTS entry:",
          entry,
        );
      }

      continue;
    }

    const base = entry.slice(0, slash);
    const prefix = Number(entry.slice(slash + 1));

    if (
      net.isIP(base) === 4 &&
      Number.isInteger(prefix) &&
      prefix >= 0 &&
      prefix <= 32
    ) {
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      cidrV4.push({ network: (ipv4ToInt(base) & mask) >>> 0, mask });
    } else {
      console.warn(
        "[proxy] ignoring unsupported PROXY_ALLOW_PRIVATE_HOSTS entry:",
        entry,
      );
    }
  }

  return { exact, cidrV4 };
}

function allowsAddress(allow, ip) {
  if (allow.exact.has(ip)) {
    return true;
  }

  if (net.isIP(ip) === 4) {
    const value = ipv4ToInt(ip);

    for (const { network, mask } of allow.cidrV4) {
      if ((value & mask) >>> 0 === network) {
        return true;
      }
    }
  }

  return false;
}

const privateAllowList = buildAllowList(settings.get("proxyAllowPrivate"));

// A public address always passes; a private one passes only when listed it in PROXY_ALLOW_PRIVATE_HOSTS.
function addressAllowed(ip) {
  return !isPrivateIp(ip) || allowsAddress(privateAllowList, ip);
}

function httpError(status, message) {
  const e = new Error(message);
  e.statusCode = status;
  return e;
}

function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err);
      return;
    }

    if (!addresses.length) {
      callback(httpError(502, "DNS resolution failed"));
      return;
    }

    for (const a of addresses) {
      if (!addressAllowed(a.address)) {
        callback(httpError(403, "Host resolves to a private address"));
        return;
      }
    }

    if (options && options.all) {
      callback(null, addresses);
      return;
    }

    callback(null, addresses[0].address, addresses[0].family);
  });
}

// Reject non-http(s) schemes and hosts that resolve to a disallowed address.
async function assertPublicUrl(urlStr) {
  let parsed;

  try {
    parsed = new URL(urlStr);
  } catch {
    throw httpError(400, "Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw httpError(400, "Only http and https URLs are allowed");
  }

  const host = parsed.hostname;

  if (net.isIP(host)) {
    if (!addressAllowed(host)) {
      throw httpError(403, "Host not allowed");
    }

    return;
  }

  let addrs;

  try {
    addrs = await dns.promises.lookup(host, { all: true });
  } catch {
    throw httpError(502, "DNS resolution failed");
  }

  for (const a of addrs) {
    if (!addressAllowed(a.address)) {
      throw httpError(403, "Host resolves to a private address");
    }
  }
}

function sameOrigin(a, b) {
  return a.protocol === b.protocol && a.host === b.host;
}

// Let the proxy handle the Content-Length and Transfer-Encoding headers itself.
function stripRequestFramingHeaders(headers) {
  const out = {};

  for (const [key, val] of Object.entries(headers)) {
    const lower = key.toLowerCase();

    if (lower === "content-length" || lower === "transfer-encoding") {
      continue;
    }

    out[key] = val;
  }

  return out;
}

function requestOnce(targetUrl, method, headers, body) {
  return new Promise((resolve, reject) => {
    const mod = targetUrl.protocol === "https:" ? https : http;
    const outHeaders = stripRequestFramingHeaders(headers);
    const hasBody = body != null && method !== "GET" && method !== "HEAD";

    if (hasBody) {
      // Set Content-Length from the exact bytes written.
      // Avoids rejection from upstreams that do not accept chunked uploads.
      outHeaders["Content-Length"] = Buffer.byteLength(body);
    }

    const req = mod.request(
      targetUrl,
      { method, headers: outHeaders, lookup: safeLookup },
      resolve,
    );

    req.on("error", reject);

    if (hasBody) {
      req.write(body);
    }

    req.end();
  });
}

// Follow redirects manually so every hop runs through safeLookup and is re-checked.
async function proxyRequest({ url, method, headers, body }) {
  let current = new URL(url);
  let currentMethod = method;
  let currentHeaders = headers;
  let currentBody = body;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw httpError(400, "Only http and https URLs are allowed");
    }

    // An IP-literal host skips DNS, so safeLookup never runs for it; check it here.
    if (net.isIP(current.hostname) && !addressAllowed(current.hostname)) {
      throw httpError(403, "Host not allowed");
    }

    const res = await requestOnce(
      current,
      currentMethod,
      currentHeaders,
      currentBody,
    );

    if (!REDIRECT_CODES.has(res.statusCode) || !res.headers.location) {
      return res;
    }

    res.resume();
    const next = new URL(res.headers.location, current);

    // The caller did not choose the redirect target, so credentials do not cross origins.
    if (!sameOrigin(current, next)) {
      currentHeaders = { ...currentHeaders };

      for (const key of Object.keys(currentHeaders)) {
        const lower = key.toLowerCase();

        if (lower === "authorization" || lower === "cookie") {
          delete currentHeaders[key];
        }
      }
    }

    // 301/302/303 turn a non-GET follow-up into a GET; 307/308 preserve method and body.
    if (res.statusCode !== 307 && res.statusCode !== 308) {
      if (currentMethod !== "GET" && currentMethod !== "HEAD") {
        currentMethod = "GET";
        currentBody = null;
      }
    }

    current = next;
  }

  throw httpError(508, "Too many redirects");
}

function readBody(res, maxBytes) {
  return new Promise((resolve, reject) => {
    const encoding = (res.headers["content-encoding"] || "").toLowerCase();
    let stream = res;
    let decompressor = null;

    if (encoding === "gzip" || encoding === "x-gzip") {
      decompressor = zlib.createGunzip();
    } else if (encoding === "deflate") {
      decompressor = zlib.createInflate();
    } else if (encoding === "br") {
      decompressor = zlib.createBrotliDecompress();
    }

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
        fail(httpError(413, "Upstream response too large"));
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

    stream.on("error", (e) => fail(httpError(502, e.message)));
    res.on("error", (e) => fail(httpError(502, e.message)));
  });
}

// POST /api/proxy - forward a request to an external URL to bypass CORS.
router.post("/", async (req, res) => {
  const { url, method, headers, body, binary } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Missing url" });
  }

  const proxyMode = settings.get("proxyMode");

  if (proxyMode === "disabled") {
    return res.status(403).json({ error: "Proxy is disabled" });
  }

  try {
    await assertPublicUrl(url);
  } catch (e) {
    // assertPublicUrl throws deliberate, safe guard messages (blocked host, bad scheme); don't use sanitizeError.
    // leak-allow
    return res.status(e.statusCode || 400).json({ error: e.message });
  }

  if (proxyMode === "allowlist") {
    const allowlist = settings.get("proxyAllowlist");
    const host = new URL(url).hostname;

    if (!allowlist.includes(host)) {
      return res
        .status(403)
        .json({ error: `Host not in proxy allowlist: ${host}` });
    }
  }

  try {
    const reqBody =
      binary && typeof body === "string" ? Buffer.from(body, "base64") : body;

    const upstream = await proxyRequest({
      url,
      method: method || "GET",
      headers: headers || {},
      body: reqBody,
    });

    const declaredLength = Number(upstream.headers["content-length"]);

    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_RESPONSE_BYTES
    ) {
      upstream.destroy();
      return res.status(413).json({ error: "Upstream response too large" });
    }

    const respBody = await readBody(upstream, MAX_RESPONSE_BYTES);

    // Strip hop-by-hop and encoding headers; the body is already decompressed.
    const skipHeaders = new Set([
      "content-encoding",
      "transfer-encoding",
      "content-length",
      "connection",
    ]);
    const respHeaders = {};

    for (const [key, val] of Object.entries(upstream.headers)) {
      if (!skipHeaders.has(key.toLowerCase())) {
        respHeaders[key] = val;
      }
    }

    res.json({
      status: upstream.statusCode,
      headers: respHeaders,
      body: respBody.toString("base64"),
    });
  } catch (e) {
    res.status(e.statusCode || 502).json(sanitizeError(e));
  }
});

module.exports = router;
module.exports.isPrivateIp = isPrivateIp;
module.exports.proxyRequest = proxyRequest;
module.exports.requestOnce = requestOnce;
module.exports.stripRequestFramingHeaders = stripRequestFramingHeaders;
module.exports.buildAllowList = buildAllowList;
module.exports.allowsAddress = allowsAddress;
