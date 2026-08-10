const express = require("express");
const { writeCoalescer } = require("@ignis/server-core");
const settings = require("../settings");
const bootstrapRoutes = require("./bootstrap");

const router = express.Router();

const NUMBER_KEYS = [
  "contentCacheBytes",
  "inputCacheBytes",
  "inputCacheTtlMs",
  "writeCoalesceMs",
  "maxBodyBytes",
];
const LIST_KEYS = ["proxyAllowlist", "directFetchHosts"];

function validate(body) {
  const clean = {};

  if (body.proxyMode !== undefined) {
    if (!settings.PROXY_MODES.includes(body.proxyMode)) {
      throw new Error(
        `proxyMode must be one of: ${settings.PROXY_MODES.join(", ")}`,
      );
    }

    clean.proxyMode = body.proxyMode;
  }

  for (const key of NUMBER_KEYS) {
    if (body[key] === undefined) {
      continue;
    }

    const n = body[key];

    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`${key} must be a non-negative integer`);
    }

    if (key === "maxBodyBytes" && (n < 1 || n > settings.MAX_BODY_BACKSTOP)) {
      throw new Error(
        `maxBodyBytes must be between 1 and ${settings.MAX_BODY_BACKSTOP}`,
      );
    }

    if (key === "writeCoalesceMs" && n > settings.MAX_WRITE_COALESCE_MS) {
      throw new Error(
        `writeCoalesceMs must be between 0 and ${settings.MAX_WRITE_COALESCE_MS}`,
      );
    }

    clean[key] = n;
  }

  for (const key of LIST_KEYS) {
    if (body[key] === undefined) {
      continue;
    }

    const list = body[key];

    if (
      !Array.isArray(list) ||
      list.some((v) => typeof v !== "string" || !v.trim())
    ) {
      throw new Error(`${key} must be an array of non-empty strings`);
    }

    clean[key] = list.map((v) => v.trim());
  }

  return clean;
}

function applySettings(effective) {
  writeCoalescer.configure({ writeCoalesceMs: effective.writeCoalesceMs });
}

router.get("/", (req, res) => {
  res.json(settings.getAll());
});

router.post("/", (req, res) => {
  let clean;

  try {
    clean = validate(req.body || {});
  } catch (e) {
    // validate() throws deliberate, safe messages naming the invalid setting; don't use sanitizeError.
    // leak-allow
    return res.status(400).json({ error: e.message });
  }

  const effective = settings.update(clean);
  applySettings(effective);

  // Cache sizes ride in the bootstrap response; clear it so the next page load picks up new values.
  bootstrapRoutes.invalidateAll();

  res.json(effective);
});

module.exports = router;
module.exports.validate = validate;
