// Single round-trip through the server's /api/proxy endpoint for cross-origin requests.
// Encodes a binary request body to base64, returns the upstream response with its body as an ArrayBuffer.
// Throws an Error carrying the server's message on failure.

import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64.js";

export async function proxyFetch({ url, method, headers, body, contentType }) {
  let encodedBody = null;
  let binary = false;

  if (body instanceof ArrayBuffer) {
    encodedBody = arrayBufferToBase64(body);
    binary = true;
  } else if (body instanceof Uint8Array) {
    // A Uint8Array can be a view into a larger buffer (nonzero byteOffset, or shorter byteLength), so encode only the view's region.
    encodedBody = arrayBufferToBase64(
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    );
    binary = true;
  } else if (body != null) {
    encodedBody = body;
  }

  const payload = {
    url,
    method: method || "GET",
    headers: headers || {},
    body: encodedBody,
    binary,
  };

  if (contentType !== undefined) {
    payload.contentType = contentType;
  }

  // Use native fetch to avoid an unnecessary call through the shim. proxy is already same origin.
  const nativeFetch = window.__originalFetch || fetch;

  const res = await nativeFetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Proxy request failed");
  }

  const result = await res.json();

  return {
    status: result.status,
    headers: result.headers,
    body: base64ToArrayBuffer(result.body),
  };
}
