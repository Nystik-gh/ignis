const path = require("path");
const fs = require("fs");

/**
 * Encode a filename for use in Content-Disposition header.
 * Handles non-ASCII characters and special characters to prevent header injection.
 * Uses RFC 5987 encoding for filename* parameter when needed.
 */
function encodeContentDispositionFilename(filename) {
  // The \x00-\x7F range bounds the ASCII set; matching its control-character low end is intentional.
  // eslint-disable-next-line no-control-regex
  const hasNonASCII = /[^\x00-\x7F]/.test(filename);

  // Escape quotes and backslashes in ASCII filename
  const escapedFilename = filename.replace(/["\\]/g, function (match) {
    if (match === '"') return '\\"';
    if (match === "\\") return "\\\\";
    return match;
  });

  // Remove any control characters that could cause header injection
  // eslint-disable-next-line no-control-regex
  const sanitizedFilename = escapedFilename.replace(/[\x00-\x1F\x7F]/g, "");

  if (!hasNonASCII) {
    // Simple ASCII filename - use standard format
    return `attachment; filename="${sanitizedFilename}"`;
  }

  // Non-ASCII filename - use RFC 5987 encoding
  // Encode using percent-encoding for UTF-8
  const encodedFilename = encodeURIComponent(filename)
    .replace(/['()]/g, function (c) {
      return "%" + c.charCodeAt(0).toString(16).toUpperCase();
    })
    .replace(/\*/g, "%2A");

  // Provide both filename (ASCII fallback) and filename* (UTF-8 encoded)
  // For fallback, replace non-ASCII with underscores
  const asciiFallback = filename
    // Control-character code points are intentional here; this regex bounds the ASCII set.
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\x7F]/g, "_")
    .replace(/["\\]/g, function (match) {
      if (match === '"') return '\\"';
      if (match === "\\") return "\\\\";
      return match;
    });

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}

// Real path of a target that may not exist yet: resolves symlinks (including dangling ones) and keeps a not-yet-existing tail so creates resolve.
// Returns null on error, so the caller fails closed.
function canonicalize(target, depth = 0) {
  if (depth > 40) {
    return null;
  }

  let current = target;
  const tail = [];

  // Walk up to the deepest existing entry.
  while (true) {
    try {
      fs.lstatSync(current);
      break;
    } catch (e) {
      if (e.code !== "ENOENT") {
        return null;
      }

      const parent = path.dirname(current);

      if (parent === current) {
        return null;
      }

      tail.push(path.basename(current));
      current = parent;
    }
  }

  let real;

  try {
    real = fs.realpathSync(current);
  } catch (e) {
    if (e.code !== "ENOENT") {
      return null;
    }

    // realpath failed on an existing entry: a dangling symlink. Follow its target so confinement sees where a write lands.
    let linkTarget;

    try {
      linkTarget = fs.readlinkSync(current);
    } catch {
      return null;
    }

    real = canonicalize(
      path.resolve(path.dirname(current), linkTarget),
      depth + 1,
    );

    if (real === null) {
      return null;
    }
  }

  return tail.length ? path.join(real, ...tail.reverse()) : real;
}

// A filesystem root already ends in the separator, so reuse a base that already ends in one.
function isWithin(child, base) {
  if (child === base) {
    return true;
  }

  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  return child.startsWith(prefix);
}

// Resolve a client-provided path to an absolute path within a vault.
// Strips leading slashes so paths from the client are always treated as relative to the vault root.
// Rejects nullish input so missing-field bugs in callers don't silently target the vault root.
function resolveVaultPath(vaultRoot, relativePath) {
  if (relativePath === null || relativePath === undefined) {
    return null;
  }

  const cleaned = relativePath.replace(/^\/+/, "");
  const resolvedRoot = path.resolve(vaultRoot);
  const resolved = path.resolve(resolvedRoot, cleaned);

  // Lexical guard: reject an obvious ../ escape before touching the filesystem.
  if (!isWithin(resolved, resolvedRoot)) {
    return null;
  }

  // Symlink guard: an in-vault symlink passes the lexical check but the OS follows it.
  // Confine the target's realpath within the vault's realpath base (per-vault, since the base may itself be a symlink).
  const realBase = canonicalize(resolvedRoot);
  const realTarget = canonicalize(resolved);

  if (realBase === null || realTarget === null) {
    return null;
  }

  if (!isWithin(realTarget, realBase)) {
    return null;
  }

  return resolved;
}

module.exports = { encodeContentDispositionFilename, resolveVaultPath };
