// The request headers that present the Obsidian desktop client's identity.

const DESKTOP_RUNTIMES = {
  "1.14.4": { chrome: "150.0.7871.250", electron: "43.7.5" },
  "1.15.0": { chrome: "150.0.7871.250", electron: "43.8.4" },
};

const FALLBACK_OS_SEGMENT = "Windows NT 10.0; Win64; x64";

function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] || 0) - (right[i] || 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function newestRuntimeVersion() {
  return Object.keys(DESKTOP_RUNTIMES).sort(compareVersions).pop();
}

function pinnedObsidianVersion() {
  const version = window.__obsidianVersion;

  // 0.0.0 means unknown version
  if (!version || version === "0.0.0") {
    return newestRuntimeVersion();
  }

  return version;
}

function osSegment() {
  const agent = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  const match = /\(([^)]*)\)/.exec(agent);

  return match ? match[1] : FALLBACK_OS_SEGMENT;
}

function platformLabel() {
  const segment = osSegment();

  if (/Windows/.test(segment)) {
    return "Windows";
  }

  if (/Macintosh|Mac OS X/.test(segment)) {
    return "macOS";
  }

  return "Linux";
}

function desktopUserAgent() {
  const version = pinnedObsidianVersion();
  const runtime =
    DESKTOP_RUNTIMES[version] || DESKTOP_RUNTIMES[newestRuntimeVersion()];

  return (
    `Mozilla/5.0 (${osSegment()}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `obsidian/${version} Chrome/${runtime.chrome} ` +
    `Electron/${runtime.electron} Safari/537.36`
  );
}

function desktopHeaders() {
  return {
    "user-agent": desktopUserAgent(),
    origin: "app://obsidian.md",
    "sec-ch-ua-platform": `"${platformLabel()}"`,
    "sec-ch-ua-mobile": "?0",
    priority: "u=1, i",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site",
  };
}

export { desktopHeaders };
