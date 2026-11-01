// Canonical key form for fs paths: backslashes to forward slashes, no leading or trailing slash.
// Used by caches and registries that key on path.
function normalize(p) {
  return (p || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function isPathInSubtree(path, root) {
  return path === root || path.startsWith(root + "/");
}

export { isPathInSubtree, normalize };
