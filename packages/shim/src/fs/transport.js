const API_BASE = "/api/fs";

function normPath(p) {
  return (p || "").replace(/^\/+/, "");
}

function uint8ToBase64(bytes) {
  let binary = "";
  const chunk = 8192;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }

  return btoa(binary);
}

function vaultId() {
  return window.__currentVaultId || "";
}

const KEEPALIVE_MAX_BYTES = 64 * 1024;

const RESPONSE_TIMEOUT_MS = 30 * 1000;
const UPLOAD_MS_PER_64KB = 1000;

const JSON_TYPE = "application/json";

// keepalive lets a request finish after the page starts unloading.
// Its body is capped at 64KB across a shared pool, so opt in only under that limit.
function withinKeepaliveCap(bodyBytes) {
  return bodyBytes <= KEEPALIVE_MAX_BYTES;
}

function responseTimeout(bodyBytes) {
  const uploadChunks = Math.ceil(bodyBytes / (64 * 1024));

  return RESPONSE_TIMEOUT_MS + uploadChunks * UPLOAD_MS_PER_64KB;
}

function readType(encoding) {
  return encoding === "utf8" || encoding === "utf-8"
    ? "text/plain"
    : "application/octet-stream";
}

function requestError(message, code) {
  const e = new Error(message);

  e.code = code;

  return e;
}

function isPermanentStatus(status) {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function statusError(status, message, code) {
  const e = requestError(message, code);

  e.status = status;
  e.permanent = isPermanentStatus(status);

  return e;
}

function requireType(contentType, expected) {
  const mediaType = (contentType || "").split(";")[0].trim().toLowerCase();

  if (mediaType !== expected) {
    throw requestError(
      "Unexpected response type: " + (contentType || "none"),
      "ECONTENTTYPE",
    );
  }
}

async function request(method, endpoint, params = {}, { accept, headers }) {
  const url = new URL(API_BASE + endpoint, window.location.origin);

  const controller = new AbortController();
  const options = { method, signal: controller.signal };

  if (method === "GET" || method === "DELETE") {
    if (vaultId()) {
      url.searchParams.set("vault", vaultId());
    }

    for (const [key, val] of Object.entries(params)) {
      url.searchParams.set(key, val);
    }
  } else {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify({ vault: vaultId(), ...params });
  }

  if (headers) {
    options.headers = { ...options.headers, ...headers };
  }

  const bodyBytes = options.body
    ? new TextEncoder().encode(options.body).length
    : 0;

  // A write (POST/DELETE) opts into keepalive so a page dismissal does not drop it.
  if (method !== "GET" && withinKeepaliveCap(bodyBytes)) {
    options.keepalive = true;
  }

  const timer = setTimeout(
    () => controller.abort(),
    responseTimeout(bodyBytes),
  );
  let res;

  try {
    res = await fetch(url.toString(), options);
  } catch (e) {
    if (controller.signal.aborted) {
      throw requestError("Request timed out", "ETIMEDOUT");
    }

    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (res.redirected) {
    throw requestError("Request was redirected", "EREDIRECT");
  }

  if (res.status === 304) {
    return res;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));

    throw statusError(
      res.status,
      err.error || res.statusText,
      err.code || "UNKNOWN",
    );
  }

  requireType(res.headers.get("Content-Type"), accept);

  return res;
}

async function requestJson(method, endpoint, params = {}) {
  const res = await request(method, endpoint, params, { accept: JSON_TYPE });
  return res.json();
}

function requestSync(method, endpoint, params = {}, { accept }) {
  const url = new URL(API_BASE + endpoint, window.location.origin);

  if (method === "GET" || method === "DELETE") {
    if (vaultId()) {
      url.searchParams.set("vault", vaultId());
    }

    for (const [key, val] of Object.entries(params)) {
      url.searchParams.set(key, val);
    }
  }

  const xhr = new XMLHttpRequest();
  xhr.open(method, url.toString(), false); // synchronous

  if (method !== "GET" && method !== "DELETE") {
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(JSON.stringify({ vault: vaultId(), ...params }));
  } else {
    xhr.send();
  }

  if (xhr.responseURL !== url.toString()) {
    throw requestError("Request was redirected", "EREDIRECT");
  }

  if (xhr.status >= 400) {
    let err;

    try {
      const body = JSON.parse(xhr.responseText);
      err = statusError(
        xhr.status,
        body.error || "Request failed",
        body.code || "UNKNOWN",
      );
    } catch {
      err = statusError(xhr.status, "Request failed: " + xhr.status, "UNKNOWN");
    }

    throw err;
  }

  requireType(xhr.getResponseHeader("Content-Type"), accept);

  return xhr;
}

export const transport = {
  async fetchTree(etag) {
    const headers = etag ? { "If-None-Match": etag } : undefined;
    const res = await request(
      "GET",
      "/tree",
      {},
      { accept: JSON_TYPE, headers },
    );

    if (res.status === 304) {
      return { notModified: true, etag: res.headers.get("ETag") };
    }

    return { tree: await res.json(), etag: res.headers.get("ETag") };
  },

  async stat(path) {
    return requestJson("GET", "/stat", { path: normPath(path) });
  },

  async readFile(path, encoding) {
    const res = await request(
      "GET",
      "/readFile",
      { path: normPath(path), encoding: encoding || "" },
      { accept: readType(encoding) },
    );

    if (encoding === "utf8" || encoding === "utf-8") {
      return res.text();
    }

    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  },

  async writeFile(path, content, encoding) {
    const isText = typeof content === "string";
    return requestJson("POST", "/writeFile", {
      path: normPath(path),
      content: isText ? content : uint8ToBase64(content),
      encoding: encoding || (isText ? "utf-8" : "binary"),
      base64: !isText,
    });
  },

  async appendFile(path, content) {
    const isText = typeof content === "string";
    return requestJson("POST", "/appendFile", {
      path: normPath(path),
      content: isText ? content : uint8ToBase64(content),
      base64: !isText,
    });
  },

  async mkdir(path, recursive) {
    return requestJson("POST", "/mkdir", { path: normPath(path), recursive });
  },

  async rename(oldPath, newPath) {
    return requestJson("POST", "/rename", {
      oldPath: normPath(oldPath),
      newPath: normPath(newPath),
    });
  },

  async copyFile(src, dest) {
    return requestJson("POST", "/copyFile", {
      src: normPath(src),
      dest: normPath(dest),
    });
  },

  async unlink(path) {
    return requestJson("DELETE", "/unlink", { path: normPath(path) });
  },

  async rmdir(path) {
    return requestJson("DELETE", "/rmdir", { path: normPath(path) });
  },

  async rm(path, recursive) {
    return requestJson("DELETE", "/rm", {
      path: normPath(path),
      recursive: recursive ? "true" : "false",
    });
  },

  async access(path) {
    return requestJson("GET", "/access", { path: normPath(path) });
  },

  async utimes(path, atime, mtime) {
    return requestJson("POST", "/utimes", {
      path: normPath(path),
      atime,
      mtime,
    });
  },

  readFileSync(path, encoding) {
    const xhr = requestSync(
      "GET",
      "/readFile",
      { path: normPath(path), encoding: encoding || "" },
      { accept: readType(encoding) },
    );

    if (encoding === "utf8" || encoding === "utf-8") {
      return xhr.responseText;
    }

    const binary = xhr.responseText;
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  },
};
