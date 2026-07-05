// Browser detection.

// Edge, Opera, and Vivaldi user-agents also contain "Chrome", so they are matched before the Chrome default.
export function detectBrowser(
  ua = (typeof navigator !== "undefined" && navigator.userAgent) || "",
) {
  if (/\bEdg\//.test(ua)) {
    return "edge";
  }

  if (/\bOPR\//.test(ua)) {
    return "opera";
  }

  if (/\bVivaldi\//.test(ua)) {
    return "vivaldi";
  }

  if (/\bFirefox\//.test(ua)) {
    return "firefox";
  }

  // A genuine Safari carries "Safari" without "Chrome" or "Chromium"; Chrome's own user-agent includes "Safari".
  if (/\bSafari\//.test(ua) && !/\bChrom(e|ium)\//.test(ua)) {
    return "safari";
  }

  return "chrome";
}
