// Sends a requestUrl-style request. Either through server proxy, or directly for same-origin and direct-fetch hosts.

import { isSameOrigin, isDirectFetchHost } from "./url.js";
import { proxyFetch } from "./proxy.js";
import { desktopHeaders } from "./desktop-identity.js";
import { hasHeader } from "./headers.js";

async function fetchDirect({ url, method, headers, body }) {
  const nativeFetch = window.__originalFetch || fetch;
  const res = await nativeFetch(url, { method, headers, body });

  return {
    status: res.status,
    headers: Object.fromEntries(res.headers),
    body: await res.arrayBuffer(),
  };
}

export async function sendRequest({ url, method, headers, body, contentType }) {
  const requestHeaders = { ...headers };

  if (contentType && !hasHeader(requestHeaders, "content-type")) {
    requestHeaders["Content-Type"] = contentType;
  }

  const isDirect = isSameOrigin(url) || isDirectFetchHost(url);

  if (!isDirect && !hasHeader(requestHeaders, "user-agent")) {
    requestHeaders["user-agent"] = desktopHeaders()["user-agent"];
  }

  const request = {
    url,
    method: method || "GET",
    headers: requestHeaders,
    body,
  };

  return isDirect ? fetchDirect(request) : proxyFetch(request);
}
