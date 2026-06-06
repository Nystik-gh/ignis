// Version comparison helpers for the update check.

// SemVer build metadata (`+xyz`) is informational and ignored for precedence.
function stripBuildMetadata(version) {
  return (version || "").split("+")[0];
}

// Parse X.Y.Z to [major, minor, patch], or null when it isn't three integers.
function parseSemver(version) {
  const parts = (version || "").split(".");

  if (parts.length < 3) {
    return null;
  }

  const nums = parts.slice(0, 3).map((p) => parseInt(p, 10));

  return nums.some((n) => !Number.isInteger(n)) ? null : nums;
}

// True only when latest is strictly newer than current.
function isNewer(latest, current) {
  const a = parseSemver(latest);
  const b = parseSemver(current);

  if (!a || !b) {
    return false;
  }

  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] > b[i];
    }
  }

  return false;
}

export { stripBuildMetadata, parseSemver, isNewer };
