// Paired with the bridge's insecure-api listener, which turns dispatched reports into a Notice.
const INSECURE_API_EVENT = "ignis:insecure-api";

const warned = new Set();

// Records a call to an API the browser disables on insecure origins.
export function reportInsecureApi(api, { passive = false } = {}) {
  if (!warned.has(api)) {
    warned.add(api);
    console.warn(
      `[ignis] ${api} is disabled on insecure origins; serve over HTTPS to enable it`,
    );
  }

  if (passive) {
    return;
  }

  try {
    window.dispatchEvent(
      new CustomEvent(INSECURE_API_EVENT, { detail: { api } }),
    );
  } catch {}
}
