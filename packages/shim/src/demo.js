// Client-side demo mode hooks.
//
// Detects demo mode via the body data attribute the server stamps in buildIndexHtml.
// Pre-trusts vaults so Obsidian skips its first-run "Trust author" dialog, and bridges no-vault landing to /api/demo/provision.

export function isDemoMode() {
  return (
    typeof document !== "undefined" &&
    document.body &&
    document.body.dataset.demoMode === "true"
  );
}

// Demo vaults are provisioned from our own template, never from an unknown source.
export function autoTrustDemoVaults(vaultList) {
  if (!isDemoMode() || !Array.isArray(vaultList)) {
    return;
  }

  for (const v of vaultList) {
    if (v && v.id) {
      localStorage.setItem("enable-plugin-" + v.id, "true");
    }
  }
}

// In demo mode with no vault selected, ask the server to provision one and reload at ?vault=<name>.
// Sync XHR so we block before Obsidian boots. Returns true if navigation is in progress (caller should halt init).
export function maybeProvisionDemoVault() {
  if (!isDemoMode()) {
    return false;
  }

  const urlParams = new URLSearchParams(window.location.search);

  if (urlParams.get("vault")) {
    return false;
  }

  try {
    const xhr = new XMLHttpRequest();

    xhr.open("GET", "/api/demo/provision", false);
    xhr.send();

    if (xhr.status === 200) {
      const { vault } = JSON.parse(xhr.responseText);

      if (vault) {
        // Pre-trust before redirect.
        localStorage.setItem("enable-plugin-" + vault, "true");
        window.location.replace("/?vault=" + encodeURIComponent(vault));
        return true;
      }
    }
  } catch (e) {
    console.warn("[ignis] Demo provision failed:", e);
  }

  return false;
}
