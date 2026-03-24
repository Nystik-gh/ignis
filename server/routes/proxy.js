const express = require("express");

const router = express.Router();

// POST /api/proxy - forward a request to an external URL to bypass CORS
// Used by the requestUrl shim for plugin installation, etc.
router.post("/", async (req, res) => {
  const { url, method, headers, body, binary } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Missing url" });
  }

  try {
    const fetchOpts = {
      method: method || "GET",
      headers: headers || {},
    };

    if (body && method !== "GET" && method !== "HEAD") {
      if (binary && typeof body === "string") {
        fetchOpts.body = Buffer.from(body, "base64");
      } else {
        fetchOpts.body = body;
      }
    }

    const upstream = await fetch(url, fetchOpts);
    const respBody = Buffer.from(await upstream.arrayBuffer());

    // Forward response headers, stripping hop-by-hop / encoding headers
    // since the body is already decompressed by Node's fetch
    const skipHeaders = new Set([
      "content-encoding",
      "transfer-encoding",
      "content-length",
      "connection",
    ]);
    const respHeaders = {};
    upstream.headers.forEach((val, key) => {
      if (!skipHeaders.has(key)) {
        respHeaders[key] = val;
      }
    });

    res.json({
      status: upstream.status,
      headers: respHeaders,
      body: respBody.toString("base64"),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
