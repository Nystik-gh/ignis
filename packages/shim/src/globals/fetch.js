import { isSameOrigin, isDirectFetchHost } from "../util/url.js";
import { proxyFetch } from "../util/proxy.js";
import { desktopHeaders } from "../util/desktop-identity.js";

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function redactUrl(url) {
  try {
    const parsed = new URL(url);

    return parsed.origin + parsed.pathname;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

function hasHeader(headers, name) {
  return Object.keys(headers).some(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
}

function isTextBody(body) {
  return typeof body === "string" || body instanceof URLSearchParams;
}

async function readRequestBody(request, initBody) {
  if (isTextBody(initBody)) {
    return request.text();
  }

  if (request.method === "GET" || request.method === "HEAD") {
    return null;
  }

  const bytes = await request.arrayBuffer();

  return bytes.byteLength === 0 && initBody == null ? null : bytes;
}

function toResponse({ status, headers, body }, method) {
  if (status < 200 || status > 599) {
    throw new TypeError(`Upstream answered with status ${status}`);
  }

  const hasNullBody = method === "HEAD" || NULL_BODY_STATUSES.has(status);

  return new Response(hasNullBody ? null : body, { status, headers });
}

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

    for (const [name, value] of Object.entries(desktopHeaders())) {
      if (!hasHeader(headers, name)) {
        headers[name] = value;
      }
    }

    const request = new Request(input, init);
    const { signal } = request;

    if (signal.aborted) {
      throw signal.reason;
    }

    const derivedContentType = request.headers.get("content-type");

    if (derivedContentType && !hasHeader(headers, "content-type")) {
      headers["content-type"] = derivedContentType;
    }

    let result;

    try {
      const body = await readRequestBody(request, init?.body);

      console.log(
        "[shim:fetch] Proxying cross-origin:",
        method,
        redactUrl(url),
      );
      result = await proxyFetch({ url, method, headers, body, signal });
    } catch (e) {
      if (signal.aborted) {
        throw signal.reason;
      }

      throw new TypeError(e.message || "Failed to fetch");
    }

    return toResponse(result, request.method);
  };
}
