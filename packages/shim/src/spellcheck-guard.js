// Disable spellchecker dropdown since browser spellchecker cannot be set programmatically.
// Direct users to system settings instead.

import { detectBrowser } from "./browser-detect.js";
import { copyText } from "./util/clipboard.js";

// Each browser's language / spellcheck settings page. Safari has none: its spellcheck is OS-level.
const SETTINGS_URLS = {
  chrome: "chrome://settings/languages",
  edge: "edge://settings/languages",
  opera: "opera://settings/languages",
  vivaldi: "vivaldi://settings/languages",
  firefox: "about:preferences",
  safari: null,
};

function flash(el, original, message) {
  el.textContent = message;

  setTimeout(() => {
    el.textContent = original;
  }, 1200);
}

function copyLink(url) {
  const a = document.createElement("a");
  a.textContent = url;
  a.href = "#";
  a.setAttribute("aria-label", "Copy " + url);
  a.style.color = "inherit";
  a.style.textDecoration = "underline";
  a.style.cursor = "pointer";

  a.addEventListener("click", (e) => {
    e.preventDefault();

    copyText(url).then(
      () => flash(a, url, "Copied"),
      () => flash(a, url, "Copy failed"),
    );
  });

  return a;
}

function renderNotice(desc) {
  const url = SETTINGS_URLS[detectBrowser()];

  desc.textContent = "";
  desc.style.color = "var(--text-error)";
  desc.appendChild(
    document.createTextNode("Ignis can't set browser spellchecker languages. "),
  );

  if (url) {
    desc.appendChild(document.createTextNode("Please use "));
    desc.appendChild(copyLink(url));
    desc.appendChild(document.createTextNode(" (click to copy)."));
  } else {
    desc.appendChild(
      document.createTextNode(
        "Please enable spellcheck in your system settings.",
      ),
    );
  }
}

function apply() {
  document.querySelectorAll(".setting-item-name").forEach((nameEl) => {
    if (!/spellcheck languages/i.test(nameEl.textContent)) {
      return;
    }

    const item = nameEl.closest(".setting-item");

    if (!item || item.__ignisSpellcheckGuarded) {
      return;
    }

    const select = item.querySelector("select");

    if (select) {
      select.disabled = true;
    }

    const desc = item.querySelector(".setting-item-description");

    if (desc) {
      renderNotice(desc);
    }

    item.__ignisSpellcheckGuarded = true;
  });
}

export function initSpellcheckGuard() {
  const observer = new MutationObserver(apply);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  apply();
}
