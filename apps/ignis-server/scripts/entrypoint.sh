#!/bin/bash
set -e

# Create user with specified UID/GID
PUID=${PUID:-1000}
PGID=${PGID:-1000}

# Create group if GID doesn't exist, otherwise use existing
if ! getent group "$PGID" >/dev/null 2>&1; then
  groupadd -g "$PGID" ignis
else
  EXISTING_GROUP=$(getent group "$PGID" | cut -d: -f1)
  echo "[ignis] Using existing group $EXISTING_GROUP (GID $PGID)"
fi

# Create user if UID doesn't exist, otherwise use existing
if ! id -u "$PUID" >/dev/null 2>&1; then
  GROUP_NAME=$(getent group "$PGID" | cut -d: -f1)
  useradd -u "$PUID" -g "$PGID" -m -s /bin/bash ignis 2>/dev/null || useradd -u "$PUID" -g "$GROUP_NAME" -M -N ignis
  RUN_USER="ignis"
else
  RUN_USER=$(id -un "$PUID")
  echo "[ignis] Using existing user $RUN_USER (UID $PUID)"
fi


mkdir -p /app/data
# Best-effort: a read-only or root_squash mount forbids chown, but PUID/PGID may already have access.
for dir in /app/obsidian-app /app/data /vaults; do
  chown -R "$PUID:$PGID" "$dir" 2>/dev/null || echo "[ignis] WARNING: could not chown $dir (read-only mount or NFS root_squash); continuing. Ensure PUID/PGID can read+write it."
done

OBSIDIAN_DIR="/app/obsidian-app"
OBSIDIAN_VERSION="${OBSIDIAN_VERSION:-1.12.7}"

warn_obsidian_version() {
  if [ -n "$1" ] && [ "$1" != "$OBSIDIAN_VERSION" ]; then
    echo "[ignis] WARNING: package is Obsidian $1, but this build is pinned to ${OBSIDIAN_VERSION}. The shim may misbehave."
  fi
}

if [ ! -f "$OBSIDIAN_DIR/index.html" ]; then
  if [ -n "$OBSIDIAN_PACKAGE" ]; then
    # Offline / restricted networks: unpack an operator-supplied package instead of downloading.
    if [ ! -f "$OBSIDIAN_PACKAGE" ]; then
      echo "[ignis] ERROR: OBSIDIAN_PACKAGE='$OBSIDIAN_PACKAGE' but that file does not exist."
      exit 1
    fi

    echo "[ignis] First run. Unpacking local Obsidian package: $OBSIDIAN_PACKAGE"

    case "$OBSIDIAN_PACKAGE" in
      *.deb)
        warn_obsidian_version "$(dpkg-deb -f "$OBSIDIAN_PACKAGE" Version 2>/dev/null)"
        rm -rf /tmp/ob-deb
        dpkg-deb -x "$OBSIDIAN_PACKAGE" /tmp/ob-deb
        npx --yes @electron/asar extract \
          /tmp/ob-deb/opt/Obsidian/resources/obsidian.asar "$OBSIDIAN_DIR"
        rm -rf /tmp/ob-deb
        ;;
      *.asar.gz)
        warn_obsidian_version "$(basename "$OBSIDIAN_PACKAGE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
        cp "$OBSIDIAN_PACKAGE" /tmp/obsidian.asar.gz
        gunzip -f /tmp/obsidian.asar.gz
        npx --yes @electron/asar extract /tmp/obsidian.asar "$OBSIDIAN_DIR"
        rm -f /tmp/obsidian.asar
        ;;
      *.asar)
        warn_obsidian_version "$(basename "$OBSIDIAN_PACKAGE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
        npx --yes @electron/asar extract "$OBSIDIAN_PACKAGE" "$OBSIDIAN_DIR"
        ;;
      *)
        echo "[ignis] ERROR: unsupported OBSIDIAN_PACKAGE format. Supported: .deb, .asar.gz, .asar"
        exit 1
        ;;
    esac
  else
    echo "[ignis] First run. Downloading Obsidian v${OBSIDIAN_VERSION}..."

    curl -fSL "https://github.com/obsidianmd/obsidian-releases/releases/download/v${OBSIDIAN_VERSION}/obsidian-${OBSIDIAN_VERSION}.asar.gz" \
      -o /tmp/obsidian.asar.gz

    echo "[ignis] Unpacking asar..."
    gunzip /tmp/obsidian.asar.gz
    npx --yes @electron/asar extract /tmp/obsidian.asar "$OBSIDIAN_DIR"

    rm -f /tmp/obsidian.asar
  fi

  if [ ! -f "$OBSIDIAN_DIR/index.html" ]; then
    echo "[ignis] ERROR: setup did not produce $OBSIDIAN_DIR/index.html; the Obsidian package may be invalid."
    exit 1
  fi

  echo "[ignis] Obsidian ready (v${OBSIDIAN_VERSION})."
else
  echo "[ignis] Obsidian already set up."
fi


# Install obsidian-headless (ob CLI) if not already present.
# Not included in the image for legal reasons - installed at runtime.
if ! command -v ob &>/dev/null; then
  echo "[ignis] Installing obsidian-headless..."

  if npm install -g --prefix /usr/local obsidian-headless --silent 2>/dev/null; then
    OB_VERSION=$(ob --version 2>/dev/null)

    if [ -n "$OB_VERSION" ]; then
      echo "[ignis] obsidian-headless $OB_VERSION installed."
    else
      echo "[ignis] WARNING: obsidian-headless installed but 'ob' command not working."
    fi
  else
    echo "[ignis] WARNING: Failed to install obsidian-headless. Headless sync will not be available."
  fi
else
  echo "[ignis] obsidian-headless $(ob --version 2>/dev/null) available."
fi

# Run as the determined user
exec gosu "$RUN_USER" node /app/apps/ignis-server/server/index.js