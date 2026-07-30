import { isSameOrigin, isDirectFetchHost } from "../util/url.js";
import { proxyFetch } from "../util/proxy.js";

export function installFetchShim() {
  const originalFetch = window.fetch.bind(window);
  window.__originalFetch = originalFetch;

  window.fetch = async function (input, init) {
    let url;

    if (typeof input === "string") {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else if (input instanceof Request) {
      url = input.url;
    } else {
      url = String(input);
    }

    if (isSameOrigin(url) || isDirectFetchHost(url)) {
      return originalFetch(input, init);
    }

    // Cross-origin. route through server proxy
    const method = (
      init?.method || (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const headers = {};

    if (init?.headers) {
      const h =
        init.headers instanceof Headers
          ? init.headers
          : new Headers(init.headers);
      h.forEach((val, key) => {
        headers[key] = val;
      });
    } else if (input instanceof Request) {
      input.headers.forEach((val, key) => {
        headers[key] = val;
      });
    }

    // Mimic the real Obsidian desktop app headers for cross-origin requests
    if (!headers["user-agent"] && !headers["User-Agent"]) {
      headers["user-agent"] = navigator.userAgent;
    }
    if (!headers["origin"] && !headers["Origin"]) {
      headers["origin"] = "app://obsidian.md";
    }

    let body = null;

    if (init?.body && method !== "GET" && method !== "HEAD") {
      if (typeof init.body === "string") {
        body = init.body;
      } else if (
        init.body instanceof ArrayBuffer ||
        init.body instanceof Uint8Array
      ) {
        body = init.body;
      } else if (typeof init.body === "object") {
        body = JSON.stringify(init.body);
      } else {
        body = String(init.body);
      }
    }

    console.log("[shim:fetch] Proxying cross-origin:", method, url);

    let result;

    try {
      result = await proxyFetch({ url, method, headers, body });
    } catch (e) {
      throw new TypeError(e.message || "Failed to fetch");
    }

    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    });
  };
}
