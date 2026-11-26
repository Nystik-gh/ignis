// Sends requests through the server proxy, or directly for same-origin and direct-fetch hosts.

import { isSameOrigin, isDirectFetchHost } from "./url.js";
import { proxyFetch, openProxyStream } from "./proxy.js";
import { desktopHeaders } from "./desktop-identity.js";
import { hasHeader } from "./headers.js";

function isDirectRoute(url) {
  return isSameOrigin(url) || isDirectFetchHost(url);
}

function fetchDirect({ url, method, headers, body, signal }) {
  const nativeFetch = window.__originalFetch || fetch;

  return nativeFetch(url, { method, headers, body, signal });
}

export async function sendRequest({ url, method, headers, body, contentType }) {
  const requestHeaders = { ...headers };

  if (contentType && !hasHeader(requestHeaders, "content-type")) {
    requestHeaders["Content-Type"] = contentType;
  }

  const isDirect = isDirectRoute(url);

  if (!isDirect && !hasHeader(requestHeaders, "user-agent")) {
    requestHeaders["user-agent"] = desktopHeaders()["user-agent"];
  }

  const request = {
    url,
    method: method || "GET",
    headers: requestHeaders,
    body,
  };

  if (!isDirect) {
    return proxyFetch(request);
  }

  const res = await fetchDirect(request);

  return {
    status: res.status,
    headers: Object.fromEntries(res.headers),
    body: await res.arrayBuffer(),
  };
}

export async function sendStreamingRequest({
  url,
  method,
  headers,
  body,
  signal,
}) {
  const request = {
    url,
    method: method || "GET",
    headers: headers || {},
    body,
    signal,
  };

  if (!isDirectRoute(url)) {
    return openProxyStream(request);
  }

  const res = await fetchDirect(request);
  const responseHeaders = Object.fromEntries(res.headers);

  // strip encoding headers to avoid decoding twice.
  if (responseHeaders["content-encoding"]) {
    delete responseHeaders["content-encoding"];
    delete responseHeaders["content-length"];
  }

  return { status: res.status, headers: responseHeaders, body: res.body };
}
