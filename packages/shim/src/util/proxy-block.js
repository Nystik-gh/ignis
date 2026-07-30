// Paired with the bridge's proxy-block listener, which turns dispatched reports into a Notice.
const PROXY_BLOCK_EVENT = "ignis:proxy-blocked";

const BLOCK_CODES = new Set([
  "private-host",
  "private-resolve",
  "dns",
  "allowlist",
  "disabled",
]);

// Rate limit repeated reports to avoid spam.
const REPORT_INTERVAL_MS = 60 * 1000;

const lastReported = new Map();

export function isProxyBlock(body) {
  return !!(body && BLOCK_CODES.has(body.code));
}

export function reportProxyBlock(body) {
  const now = Date.now();

  // drop expired entries
  for (const [k, at] of lastReported) {
    if (now - at >= REPORT_INTERVAL_MS) {
      lastReported.delete(k);
    }
  }

  const key = `${body.code}:${body.host || ""}`;

  if (lastReported.has(key)) {
    return;
  }

  lastReported.set(key, now);
  console.warn(`[ignis] ${body.error}`);

  try {
    window.dispatchEvent(
      new CustomEvent(PROXY_BLOCK_EVENT, {
        detail: {
          code: body.code,
          host: body.host,
          address: body.address,
          message: body.error,
        },
      }),
    );
  } catch {}
}
