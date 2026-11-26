const express = require("express");
const { pipeline } = require("stream/promises");
const settings = require("../../settings");
const { sanitizeError } = require("@ignis/server-core");
const {
  signinCredentials,
  resolveSignin,
} = require("../../obsidian-account/signin");
const { assertPublicUrl } = require("./ssrf-guard");
const { relayOnce, openRelayStream } = require("./relay");
const { PROXY_BODY_TOO_LARGE } = require("../../body-limits");

const router = express.Router();

const STREAM_HEADERS = {
  "Content-Type": "application/octet-stream",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store, no-transform",
  "X-Accel-Buffering": "no",
};

async function accessRefusal(url) {
  const proxyMode = settings.get("proxyMode");

  if (proxyMode === "disabled") {
    return {
      status: 403,
      body: {
        error:
          "Ignis blocked the connection: proxy access is disabled (Settings > Ignis > General > Security).",
        code: "disabled",
      },
    };
  }

  try {
    await assertPublicUrl(url);
  } catch (e) {
    // assertPublicUrl throws deliberate, safe guard messages (blocked host, bad scheme); don't use sanitizeError.
    // leak-allow
    const body = { error: e.message, ...e.block };
    return { status: e.statusCode || 400, body };
  }

  if (proxyMode === "allowlist") {
    const allowlist = settings.get("proxyAllowlist");
    const host = new URL(url).hostname;

    if (!allowlist.includes(host)) {
      return {
        status: 403,
        body: {
          error: `Ignis blocked a connection to ${host}: the host is not in the proxy host allowlist (Settings > Ignis > General > Security).`,
          code: "allowlist",
          host,
        },
      };
    }
  }

  return null;
}

function startStream(res, { status, headers }) {
  const preamble = Buffer.from(JSON.stringify({ status, headers }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(preamble.length);

  res.status(200).set(STREAM_HEADERS);
  res.write(Buffer.concat([length, preamble]));
}

// POST /api/proxy - forward a request to an external URL to bypass CORS.
router.post("/", async (req, res) => {
  const { url, method, headers, body, binary, stream } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Missing url" });
  }

  const upstreamAbort = new AbortController();

  res.on("close", () => {
    if (!res.writableFinished) {
      upstreamAbort.abort();
    }
  });

  const refusal = await accessRefusal(url);

  if (refusal) {
    return res.status(refusal.status).json(refusal.body);
  }

  try {
    const reqBody =
      binary && typeof body === "string" ? Buffer.from(body, "base64") : body;
    const bodyBytes =
      typeof reqBody === "string" || Buffer.isBuffer(reqBody)
        ? Buffer.byteLength(reqBody)
        : 0;

    if (bodyBytes > settings.get("maxBodyBytes")) {
      return res.status(413).json(PROXY_BODY_TOO_LARGE);
    }

    const relayArgs = {
      url,
      method: method || "GET",
      headers: headers || {},
      body: reqBody,
      signal: upstreamAbort.signal,
    };

    const credentials = signinCredentials(req.body);

    if (stream && !credentials) {
      const opened = await openRelayStream(relayArgs);
      startStream(res, opened);
      await pipeline(...opened.bodyStreams, res);
      return;
    }

    let relayed = await relayOnce(relayArgs);

    if (credentials) {
      relayed = await resolveSignin(credentials, relayed, () =>
        relayOnce(relayArgs),
      );
    }

    if (stream) {
      startStream(res, relayed);
      res.end(Buffer.from(relayed.body, "base64"));
      return;
    }

    res.json(relayed);
  } catch (e) {
    if (upstreamAbort.signal.aborted || res.headersSent) {
      return;
    }

    if (e.block) {
      // leak-allow
      const body = { error: e.message, ...e.block };
      return res.status(e.statusCode || 403).json(body);
    }

    if (e.expose) {
      // leak-allow
      const body = { error: e.message, code: e.code };
      return res.status(e.statusCode).json(body);
    }

    res.status(e.statusCode || 502).json(sanitizeError(e));
  }
});

module.exports = router;
