// Retries vault images that fail to load.

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [500, 2000, 8000];

function isVaultImage(el) {
  if (!el || el.tagName !== "IMG" || !el.src) {
    return false;
  }

  try {
    const url = new URL(el.src, window.location.href);

    return (
      url.origin === window.location.origin &&
      url.pathname.startsWith("/vault-files/")
    );
  } catch {
    return false;
  }
}

function initImageRetry() {
  const attempts = new WeakMap();
  const timers = new Set();

  function onError(e) {
    const img = e.target;

    if (!isVaultImage(img)) {
      return;
    }

    const attempt = attempts.get(img) || 0;

    if (attempt >= MAX_ATTEMPTS) {
      return;
    }

    attempts.set(img, attempt + 1);

    const timer = setTimeout(() => {
      timers.delete(timer);

      // A detached img still fetches when src is set.
      if (!img.isConnected) {
        return;
      }

      const url = new URL(img.src, window.location.href);
      // cache-bust each retry.
      url.searchParams.set("ignis-retry", String(attempt + 1));
      img.src = url.toString();
    }, RETRY_DELAYS_MS[attempt]);

    timers.add(timer);
  }

  function onLoad(e) {
    if (isVaultImage(e.target)) {
      attempts.delete(e.target);
    }
  }

  // error and load on images do not bubble, they must be captured.
  document.addEventListener("error", onError, true);
  document.addEventListener("load", onLoad, true);

  return () => {
    document.removeEventListener("error", onError, true);
    document.removeEventListener("load", onLoad, true);

    for (const timer of timers) {
      clearTimeout(timer);
    }

    timers.clear();
  };
}

export { initImageRetry };
