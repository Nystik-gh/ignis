---
title: Deploy with Docker
description: Set up an Ignis server with Docker Compose.
---

Ignis runs as a Docker container. These steps set up a persistent instance with Docker Compose, on a machine that already has Docker (see [Requirements](/docs/requirements/)).

## Create the compose file

In an empty directory, save this as `docker-compose.yml`:

```yaml
services:
  ignis:
    image: nobbe/ignis:latest
    ports:
      - "8080:8080"
    environment:
      # match these to your host user (run: id)
      - PUID=1000
      - PGID=1000
    volumes:
      - ./vaults:/vaults
      - ./data:/app/data
      - obsidian-app:/app/obsidian-app
    restart: unless-stopped

volumes:
  obsidian-app:
```

This maps three paths onto the host so your data persists across restarts and updates:

- `./vaults` holds your vaults, one sub-folder per vault.
- `./data` holds Ignis state, such as server plugin settings and sync configuration.
- `obsidian-app` caches the downloaded Obsidian so it is not fetched again when the container is recreated.

To use a different host port, change the left number, for example `9000:8080`.

## Start the container

From the same directory, run:

```bash
docker compose up -d
```

The first start downloads Obsidian and the `obsidian-headless` CLI, which takes a minute or two. Later starts are faster. To watch the download or check for errors, follow the logs with:

```bash
docker compose logs -f
```

## Open Ignis

Visit `http://localhost:8080`, or the host and port you mapped. You should see Ignis load in your browser.

## Create your first vault

If a vault is already in the `vaults` folder, Ignis will load it automatically. Otherwise it opens the vault manager, where you create your first vault.

---

## Network access

Local access over `http://localhost` works as is, but reaching Ignis over your LAN or the internet requires a secure context. You can achieve this in two ways:

- [Set up TLS](/docs/security/remote-access/#serving-over-https), with a reverse proxy or `tailscale serve`.
- [Treat your host as a secure origin](/docs/security/remote-access/#running-without-tls) without TLS, per browser.

If you make Ignis available to external networks it is highly recommended that you put [Authentication](/docs/security/authentication/) in front.

## Configuration

The compose file above is a basic setup. For the full set of environment variables, see [Environment variables](/docs/server/environment/).

To tune caching, the proxy, and security from inside the app, see [Settings](/docs/using/settings/).

## Notes

### File ownership

Ignis writes files as the user and group given by `PUID` and `PGID`, both `1000` by default. If your host account uses different IDs (run the `id` command to check), set those two values in the compose to match, so the files stay owned by you.

On a read-only or NFS `root_squash` mount, Ignis cannot set ownership itself, so the mounted folders must already be writable by the `PUID`/`PGID` user. Set it up one of two ways:

- Make the `PUID`/`PGID` user the owner of the folders on the host.
- Export the NFS share with `no_root_squash`.

### Offline install

If the container cannot reach the internet on first run, you can download the Obsidian `.deb` from [obsidian.md](https://obsidian.md/download) manually, mount it, and point `OBSIDIAN_PACKAGE` at it:

```yaml
    volumes:
      - ./obsidian.deb:/packages/obsidian.deb:ro
    environment:
      - OBSIDIAN_PACKAGE=/packages/obsidian.deb
```

Ignis will unpack the local copy instead of downloading. It's recommended to match the Obsidian version the Ignis release pins.

### Backups

Your vaults are ordinary files under `vaults`. Back them up with whatever you use for other server data. Ignis has no built-in backup.

### Running a public demo

To run a public, throwaway demo instance instead of a private server, see [`examples/demo/`](https://github.com/Nystik-gh/ignis/tree/main/apps/ignis-server/examples/demo) in the repository.
