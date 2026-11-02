import { electronShim } from "./electron/index.js";
import { remoteShim } from "./electron/remote/index.js";
import { fsShim } from "./fs/index.js";
import { pathShim } from "./path.js";
import { urlShim } from "./url.js";
import { cryptoShim } from "./crypto/index.js";
import { processShim } from "./process.js";
import * as childProcessShim from "./node/child_process.js";
import { EventEmitter } from "./node/events.js";
import * as osShim from "./node/os.js";
import * as netShim from "./node/net.js";
import * as ttyShim from "./node/tty.js";
import * as httpShim from "./node/http.js";
import * as zlibShim from "./node/zlib.js";
import * as utilShim from "./node/util.js";
import { constantsShim } from "./node/constants.js";
import { assertShim } from "./node/assert.js";
import * as streamShim from "./node/stream.js";
import * as moduleShim from "./node/module.js";
import * as workerThreadsShim from "./node/worker_threads.js";
import { wrapWithProxy, installDebugHelpers } from "./debug.js";

const rawRegistry = {
  electron: electronShim,
  "@electron/remote": remoteShim,
  "original-fs": fsShim,
  fs: fsShim,
  "fs/promises": fsShim.promises,
  path: pathShim,
  url: urlShim,
  crypto: cryptoShim,
  process: processShim,
  child_process: childProcessShim,
  events: EventEmitter,
  os: osShim,
  net: netShim,
  tty: ttyShim,
  http: httpShim,
  https: httpShim,
  zlib: zlibShim,
  util: utilShim,
  constants: constantsShim,
  assert: assertShim,
  stream: streamShim,
  module: moduleShim,
  worker_threads: workerThreadsShim,
};

moduleShim.builtinModules.push(...Object.keys(rawRegistry));

const shimRegistry = {};
const throwOnRequire = new Set(["btime", "get-fonts", "vibrancy-win"]);

export function installRequire() {
  for (const [name, shim] of Object.entries(rawRegistry)) {
    shimRegistry[name] = wrapWithProxy(shim, name);
  }

  if (typeof window.Buffer !== "undefined") {
    shimRegistry.buffer = { Buffer: window.Buffer };
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

// For modules captured at runtime, e.g. the obsidian module via the virtual-plugin loader.
export function registerShim(name, mod) {
  shimRegistry[name] = mod;
}
