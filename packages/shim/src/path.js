// Path shim. delegates to path-browserify (bundled via esbuild alias)
// Configured for posix mode since vault paths are normalized to forward slashes.

import pathBrowserify from "path";

const _origBasename = pathBrowserify.basename;

export const pathShim = {
  ...pathBrowserify,
  basename(p, ext) {
    // Vault root "/" should return the vault name for display purposes
    if (p === "/" && window.__currentVaultId) {
      return window.__currentVaultId;
    }

    return _origBasename(p, ext);
  },
};
