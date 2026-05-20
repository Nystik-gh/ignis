import { electronShim } from "./electron/index.js";
import { remoteShim } from "./electron/remote/index.js";
import { fsShim } from "./fs/index.js";
import { pathShim } from "./path.js";
import { urlShim } from "./url.js";
import { cryptoShim } from "./crypto/index.js";
import * as childProcessShim from "./node/child_process.js";
import * as eventsShim from "./node/events.js";
import * as osShim from "./node/os.js";
import * as netShim from "./node/net.js";
import * as httpShim from "./node/http.js";
import * as zlibShim from "./node/zlib.js";
import * as utilShim from "./node/util.js";
import { wrapWithProxy, installDebugHelpers } from "./debug.js";

const rawRegistry = {
  electron: electronShim,
  "@electron/remote": remoteShim,
  "original-fs": fsShim,
  fs: fsShim,
  path: pathShim,
  url: urlShim,
  crypto: cryptoShim,
  child_process: childProcessShim,
  events: eventsShim,
  os: osShim,
  net: netShim,
  http: httpShim,
  https: httpShim,
  zlib: zlibShim,
  util: utilShim,
};

const shimRegistry = {};
const throwOnRequire = new Set(["btime", "get-fonts", "vibrancy-win"]);

export function installRequire() {
  for (const [name, shim] of Object.entries(rawRegistry)) {
    shimRegistry[name] = wrapWithProxy(shim, name);
  }

  // Add buffer shim (protobufjs inquire() checks for this)
  if (typeof window.Buffer !== "undefined") {
    shimRegistry.buffer = window.Buffer;
  }

  // Add empty long shim (optional protobufjs dependency, gracefully handled)
  shimRegistry.long = undefined;

  window.require = function (moduleName) {
    // Strip node: prefix if present
    const normalizedName = moduleName.startsWith("node:")
      ? moduleName.slice(5)
      : moduleName;

    if (throwOnRequire.has(normalizedName)) {
      throw new Error(`Cannot find module '${moduleName}'`);
    }

    if (shimRegistry[normalizedName]) {
      return shimRegistry[normalizedName];
    }

    console.warn("[ignis] Unshimmed require:", moduleName);
    return wrapWithProxy({}, `UNKNOWN(${moduleName})`);
  };

  installDebugHelpers(rawRegistry);
}
