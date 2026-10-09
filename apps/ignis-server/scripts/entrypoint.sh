#!/bin/bash
set -e

# true when $1 is the same version as $2 or newer.
version_at_least() {
  [ "$(printf "%s\n%s\n" "$1" "$2" | sort -V | tail -n 1)" = "$1" ]
}

check_package_version() {
  if [ -z "$1" ]; then
    return
  fi

  if ! version_at_least "$1" "$OBSIDIAN_PIN"; then
    echo "[ignis] ERROR: package is Obsidian $1, older than this build's Obsidian $OBSIDIAN_PIN. Use a package of $OBSIDIAN_PIN or newer, or an older Ignis image."
    exit 1
  fi

  if [ "$1" != "$OBSIDIAN_PIN" ]; then
    echo "[ignis] WARNING: package is Obsidian $1, but this build is pinned to $OBSIDIAN_PIN. The shim may misbehave."
  fi
}

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
OBSIDIAN_PIN="${IGNIS_OBSIDIAN_PIN:?IGNIS_OBSIDIAN_PIN is not set}"
OBSIDIAN_STAMP="$OBSIDIAN_DIR/.obsidian-version"

# OBSIDIAN_VERSION may raise the pin, never lower it.
if [ -z "$OBSIDIAN_VERSION" ] || [ "$OBSIDIAN_VERSION" = "$OBSIDIAN_PIN" ]; then
  OBSIDIAN_VERSION="$OBSIDIAN_PIN"
elif version_at_least "$OBSIDIAN_VERSION" "$OBSIDIAN_PIN"; then
  echo "[ignis] WARNING: OBSIDIAN_VERSION=$OBSIDIAN_VERSION is newer than this build's Obsidian $OBSIDIAN_PIN. The shim may misbehave."
else
  echo "[ignis] OBSIDIAN_VERSION=$OBSIDIAN_VERSION is older than this build's Obsidian $OBSIDIAN_PIN; using $OBSIDIAN_PIN. Use an older Ignis image to run an older Obsidian."
  OBSIDIAN_VERSION="$OBSIDIAN_PIN"
fi


installed_version=""
if [ -f "$OBSIDIAN_STAMP" ]; then
  installed_version="$(cat "$OBSIDIAN_STAMP")"
fi

if [ ! -f "$OBSIDIAN_DIR/index.html" ] || [ "$installed_version" != "$OBSIDIAN_VERSION" ]; then
  # The directory holds a different Obsidian version than the pin, so clear it before reinstalling.
  if [ -f "$OBSIDIAN_DIR/index.html" ]; then
    echo "[ignis] Obsidian ${installed_version:-unknown} is installed, but this build is pinned to v${OBSIDIAN_VERSION}. Reinstalling..."
    find "$OBSIDIAN_DIR" -mindepth 1 -delete
  fi

  if [ -n "$OBSIDIAN_PACKAGE" ]; then
    # Offline / restricted networks: unpack an operator-supplied package instead of downloading.
    if [ ! -f "$OBSIDIAN_PACKAGE" ]; then
      echo "[ignis] ERROR: OBSIDIAN_PACKAGE='$OBSIDIAN_PACKAGE' but that file does not exist."
      exit 1
    fi

    case "$OBSIDIAN_PACKAGE" in
      *.deb)
        package_version="$(dpkg-deb -f "$OBSIDIAN_PACKAGE" Version 2>/dev/null)"
        ;;
      *.asar.gz | *.asar)
        package_version="$(basename "$OBSIDIAN_PACKAGE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
        ;;
      *)
        echo "[ignis] ERROR: unsupported OBSIDIAN_PACKAGE format. Supported: .deb, .asar.gz, .asar"
        exit 1
        ;;
    esac

    check_package_version "$package_version"

    echo "[ignis] Unpacking local Obsidian package: $OBSIDIAN_PACKAGE"

    case "$OBSIDIAN_PACKAGE" in
      *.deb)
        rm -rf /tmp/ob-deb
        dpkg-deb -x "$OBSIDIAN_PACKAGE" /tmp/ob-deb
        npx --yes @electron/asar extract \
          /tmp/ob-deb/opt/Obsidian/resources/obsidian.asar "$OBSIDIAN_DIR"
        rm -rf /tmp/ob-deb
        ;;
      *.asar.gz)
        cp "$OBSIDIAN_PACKAGE" /tmp/obsidian.asar.gz
        gunzip -f /tmp/obsidian.asar.gz
        npx --yes @electron/asar extract /tmp/obsidian.asar "$OBSIDIAN_DIR"
        rm -f /tmp/obsidian.asar
        ;;
      *.asar)
        npx --yes @electron/asar extract "$OBSIDIAN_PACKAGE" "$OBSIDIAN_DIR"
        ;;
    esac
  else
    echo "[ignis] Downloading Obsidian v${OBSIDIAN_VERSION}..."

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

  echo "$OBSIDIAN_VERSION" > "$OBSIDIAN_STAMP"
  echo "[ignis] Obsidian ready (v${OBSIDIAN_VERSION})."
else
  echo "[ignis] Obsidian already set up (v${OBSIDIAN_VERSION})."
fi


# Run as the determined user
exec gosu "$RUN_USER" node /app/apps/ignis-server/server/index.js
