import { Notice } from "obsidian";

// Paired with the shim's insecure-api reporter, which dispatches this event.
const INSECURE_API_EVENT = "ignis:insecure-api";

const MESSAGES = {
  crypto:
    "Cryptography is disabled on insecure connections. Serve Ignis over HTTPS to enable it.",
  clipboard:
    "Clipboard access is limited on insecure connections. Keyboard shortcuts still work. Serve Ignis over HTTPS for full clipboard support.",
  other:
    "This feature is disabled on insecure connections. Serve Ignis over HTTPS to enable it.",
};

function categorize(api) {
  if (typeof api !== "string") {
    return "other";
  }

  if (api.startsWith("crypto.subtle")) {
    return "crypto";
  }

  if (api.includes("clipboard")) {
    return "clipboard";
  }

  return "other";
}

// One Notice per category so a plugin's retry loop does not stack toasts.
export function initInsecureApiNotice() {
  if (window.isSecureContext) {
    return () => {};
  }

  const notified = new Set();

  const handler = (event) => {
    const category = categorize(event.detail && event.detail.api);

    if (notified.has(category)) {
      return;
    }

    notified.add(category);
    new Notice(MESSAGES[category], 8000);
  };

  window.addEventListener(INSECURE_API_EVENT, handler);

  return () => window.removeEventListener(INSECURE_API_EVENT, handler);
}
