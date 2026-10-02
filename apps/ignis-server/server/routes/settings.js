const express = require("express");
const { writeCoalescer, watcher } = require("@ignis/server-core");
const config = require("../config");
const settings = require("../settings");
const bootstrapCache = require("../cache");

const router = express.Router();

const NUMBER_KEYS = [
  "contentCacheBytes",
  "inputCacheBytes",
  "inputCacheTtlMs",
  "writeCoalesceMs",
  "maxBodyBytes",
];
const LIST_KEYS = ["proxyAllowlist", "directFetchHosts", "trustedVaults"];

const MAX_RULE_SETS = 64;
const MAX_PATTERNS_PER_SET = 200;
const MAX_PATTERN_LENGTH = 256;
// each "**" multiplies the matcher's backtracking
const MAX_DOUBLE_STARS = 3;

function invalidPatternReason(pattern) {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return `a pattern is longer than ${MAX_PATTERN_LENGTH} characters`;
  }

  if (pattern.split("**").length - 1 > MAX_DOUBLE_STARS) {
    return `a pattern uses ** more than ${MAX_DOUBLE_STARS} times`;
  }

  if (!watcher.canCompileIgnorePattern(pattern)) {
    return "a pattern is not a valid gitignore pattern";
  }

  return null;
}

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

  if (clean.trustedVaults !== undefined) {
    for (const id of clean.trustedVaults) {
      if (!config.getVaultPath(id)) {
        throw new Error(`trustedVaults contains an unknown vault: ${id}`);
      }
    }

    clean.trustedVaults = [...new Set(clean.trustedVaults)];
  }

  if (body.ignoreRules !== undefined) {
    if (!Array.isArray(body.ignoreRules)) {
      throw new Error("ignoreRules must be an array of rule sets");
    }

    if (body.ignoreRules.length > MAX_RULE_SETS) {
      throw new Error(`ignoreRules holds more than ${MAX_RULE_SETS} rule sets`);
    }

    clean.ignoreRules = body.ignoreRules.map((rule) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
        throw new Error("each ignoreRules entry must be an object");
      }

      const patterns = rule.patterns;

      if (
        !Array.isArray(patterns) ||
        patterns.length < 1 ||
        patterns.some((p) => typeof p !== "string" || !p.trim())
      ) {
        throw new Error(
          "each ignoreRules entry needs a patterns array of non-empty strings",
        );
      }

      if (patterns.length > MAX_PATTERNS_PER_SET) {
        throw new Error(
          `a rule set holds more than ${MAX_PATTERNS_PER_SET} patterns`,
        );
      }

      const trimmed = patterns.map((p) => p.trim());

      for (const pattern of trimmed) {
        const reason = invalidPatternReason(pattern);

        if (reason) {
          throw new Error(reason);
        }
      }

      return {
        name: rule.name === undefined ? "" : String(rule.name),
        patterns: trimmed,
      };
    });
  }

  return clean;
}

function sameList(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function ruleLines(rules) {
  return Array.isArray(rules)
    ? rules.flatMap((r) => (Array.isArray(r.patterns) ? r.patterns : []))
    : [];
}

async function applySettings(effective, previous) {
  writeCoalescer.configure({ writeCoalesceMs: effective.writeCoalesceMs });

  if (
    sameList(ruleLines(effective.ignoreRules), ruleLines(previous.ignoreRules))
  ) {
    return;
  }

  watcher.configure({ ignoredPaths: settings.resolveIgnoreLines() });
  await watcher.stopAll();
}

router.get("/", (req, res) => {
  res.json({
    ...settings.getAll(),
    ignoreSuggestions: bootstrapCache.ignoreSuggestions(),
  });
});

router.post("/", async (req, res) => {
  let clean;

  try {
    clean = validate(req.body || {});
  } catch (e) {
    // validate() throws deliberate, safe messages naming the invalid setting; don't use sanitizeError.
    // leak-allow
    return res.status(400).json({ error: e.message });
  }

  const previous = settings.getAll();
  const effective = settings.update(clean);

  await applySettings(effective, previous);

  invalidateBootstrap(clean, previous, effective);

  res.json(effective);
});

function invalidateBootstrap(clean, previous, effective) {
  const keys = Object.keys(clean);

  if (keys.length === 0) {
    return;
  }

  if (keys.length === 1 && keys[0] === "trustedVaults") {
    for (const id of trustChanges(
      previous.trustedVaults,
      effective.trustedVaults,
    )) {
      bootstrapCache.invalidateVault(id);
    }

    return;
  }

  bootstrapCache.invalidateAll();
}

function trustChanges(before, after) {
  const was = new Set(before || []);
  const now = new Set(after || []);

  return [...was, ...now].filter((id) => was.has(id) !== now.has(id));
}

module.exports = router;
module.exports.validate = validate;
module.exports.trustChanges = trustChanges;
