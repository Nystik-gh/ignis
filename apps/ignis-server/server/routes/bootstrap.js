// Bootstrap endpoint for cold start.
//
// Serves vault info, vault list, metadata tree, and plugin list as a single pre-compressed response.

const express = require("express");
const config = require("../config");
const { sanitizeError } = require("@ignis/server-core");
const { getOrBuild, getOrCompress } = require("../cache");

const router = express.Router();

router.get("/", async (req, res) => {
  const vaultId = req.query.vault || config.defaultVaultId;

  if (!vaultId || !config.getVaultPathOrRescan(vaultId)) {
    return res.status(404).json({ error: "Vault not found", id: vaultId });
  }

  try {
    const entry = await getOrBuild(vaultId);

    if (!entry) {
      return res.status(404).json({ error: "Vault not found" });
    }

    // don't cache the bootstrap response, since it contains the metadata tree which can change frequently.
    res.setHeader("Cache-Control", "no-store");

    // In demo mode, route through res.json so the demo middleware can translate vault names per-session.
    // The pre-compressed buffer path bakes the storage prefix in and would bypass the response wrapper.
    // Deep-clone so the demo translator's in-place mutation doesn't pollute the cached response object.
    if (req._demoSessionId) {
      return res.json(JSON.parse(JSON.stringify(entry.response)));
    }

    const ae = req.headers["accept-encoding"] || "";
    const compressed = await getOrCompress(entry);
    let buf, encoding;

    if (ae.includes("br") && compressed.br) {
      buf = compressed.br;
      encoding = "br";
    } else if (
      (ae.includes("gzip") || ae.includes("deflate")) &&
      compressed.gz
    ) {
      buf = compressed.gz;
      encoding = "gzip";
    }

    if (buf) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Encoding", encoding);
      res.setHeader("Content-Length", buf.length);

      return res.status(200).end(buf);
    }

    res.json(entry.response);
  } catch (e) {
    console.error("[bootstrap] error:", e);
    res.status(500).json(sanitizeError(e));
  }
});

module.exports = router;
