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

async function request(method, endpoint, params = {}) {
  const url = new URL(API_BASE + endpoint, window.location.origin);

  const options = { method };

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

  const res = await fetch(url.toString(), options);
  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ error: res.statusText, code: "UNKNOWN" }));
    const e = new Error(err.error || res.statusText);
    e.code = err.code || "UNKNOWN";
    throw e;
  }

  return res;
}

async function requestJson(method, endpoint, params = {}) {
  const res = await request(method, endpoint, params);
  return res.json();
}

function requestSync(method, endpoint, params = {}) {
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

  if (xhr.status >= 400) {
    let err;

    try {
      const body = JSON.parse(xhr.responseText);
      err = new Error(body.error || "Request failed");
      err.code = body.code || "UNKNOWN";
    } catch {
      err = new Error("Request failed: " + xhr.status);
      err.code = "UNKNOWN";
    }

    throw err;
  }

  return xhr;
}

export const transport = {
  async fetchTree(basePath) {
    return requestJson("GET", "/tree", basePath ? { path: basePath } : {});
  },

  async stat(path) {
    return requestJson("GET", "/stat", { path: normPath(path) });
  },

  async readdir(path) {
    return requestJson("GET", "/readdir", { path: normPath(path) });
  },

  async readFile(path, encoding) {
    const res = await request("GET", "/readFile", {
      path: normPath(path),
      encoding: encoding || "",
    });

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
    return requestJson("POST", "/appendFile", {
      path: normPath(path),
      content,
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

  async realpath(path) {
    const result = await requestJson("GET", "/realpath", {
      path: normPath(path),
    });
    return result.path;
  },

  async utimes(path, atime, mtime) {
    return requestJson("POST", "/utimes", {
      path: normPath(path),
      atime,
      mtime,
    });
  },

  readFileSync(path, encoding) {
    const xhr = requestSync("GET", "/readFile", {
      path: normPath(path),
      encoding: encoding || "",
    });

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

  writeFileSync(path, content, encoding) {
    const isText = typeof content === "string";
    requestSync("POST", "/writeFile", {
      path: normPath(path),
      content: isText ? content : uint8ToBase64(content),
      encoding: encoding || (isText ? "utf-8" : "binary"),
      base64: !isText,
    });
  },
};
