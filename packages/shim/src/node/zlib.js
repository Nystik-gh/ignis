// Zlib shim using pako for browser-side deflate/inflate/gzip/gunzip.
// Implements Node's zlib convenience functions (async callback + sync variants).
// Streaming classes (createDeflate, createGzip, etc.) are NOT implemented yet.

import pako from "pako";

// --- Constants ---

export const constants = {
  Z_NO_FLUSH: 0,
  Z_PARTIAL_FLUSH: 1,
  Z_SYNC_FLUSH: 2,
  Z_FULL_FLUSH: 3,
  Z_FINISH: 4,
  Z_BLOCK: 5,
  Z_TREES: 6,
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_ERRNO: -1,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  Z_VERSION_ERROR: -6,
  Z_NO_COMPRESSION: 0,
  Z_BEST_SPEED: 1,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: -1,
  Z_FILTERED: 1,
  Z_HUFFMAN_ONLY: 2,
  Z_RLE: 3,
  Z_FIXED: 4,
  Z_DEFAULT_STRATEGY: 0,
  Z_DEFAULT_WINDOWBITS: 15,
  Z_DEFAULT_MEMLEVEL: 8,
};

// --- Helpers ---

function toUint8Array(buf) {
  if (buf instanceof Uint8Array) {
    return buf;
  }

  if (typeof buf === "string") {
    return new TextEncoder().encode(buf);
  }

  if (buf instanceof ArrayBuffer) {
    return new Uint8Array(buf);
  }

  if (ArrayBuffer.isView(buf)) {
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  return new Uint8Array(buf);
}

function wrapAsync(syncFn) {
  return function (buf, optionsOrCb, cb) {
    if (typeof optionsOrCb === "function") {
      cb = optionsOrCb;
      optionsOrCb = {};
    }

    try {
      const result = syncFn(buf, optionsOrCb || {});

      if (cb) {
        queueMicrotask(() => cb(null, result));
      }
    } catch (e) {
      if (cb) {
        queueMicrotask(() => cb(e));
      }
    }
  };
}

// --- Sync functions ---

export function deflateSync(buf, options) {
  return pako.deflate(toUint8Array(buf), options);
}

export function inflateSync(buf, options) {
  return pako.inflate(toUint8Array(buf), options);
}

export function deflateRawSync(buf, options) {
  return pako.deflateRaw(toUint8Array(buf), options);
}

export function inflateRawSync(buf, options) {
  return pako.inflateRaw(toUint8Array(buf), options);
}

export function gzipSync(buf, options) {
  return pako.gzip(toUint8Array(buf), options);
}

export function gunzipSync(buf, options) {
  return pako.ungzip(toUint8Array(buf), options);
}

export function unzipSync(buf, options) {
  return pako.ungzip(toUint8Array(buf), options);
}

// --- Async functions (callback style) ---

export const deflate = wrapAsync(deflateSync);
export const inflate = wrapAsync(inflateSync);
export const deflateRaw = wrapAsync(deflateRawSync);
export const inflateRaw = wrapAsync(inflateRawSync);
export const gzip = wrapAsync(gzipSync);
export const gunzip = wrapAsync(gunzipSync);
export const unzip = wrapAsync(unzipSync);

// --- Streaming stubs (not yet implemented) ---

function notImplemented(name) {
  return function () {
    throw new Error(
      `zlib.${name}() streaming is not yet implemented. Use the sync/callback variants instead.`,
    );
  };
}

export const createDeflate = notImplemented("createDeflate");
export const createInflate = notImplemented("createInflate");
export const createDeflateRaw = notImplemented("createDeflateRaw");
export const createInflateRaw = notImplemented("createInflateRaw");
export const createGzip = notImplemented("createGzip");
export const createGunzip = notImplemented("createGunzip");
export const createUnzip = notImplemented("createUnzip");
