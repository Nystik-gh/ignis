# Build stage.
# Runs from the repo root as build context so workspace symlinks resolve.
# Copies workspace package.jsons first for cache-friendly npm ci.
FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/services/package.json ./packages/services/
COPY packages/shim/package.json ./packages/shim/
COPY packages/ui/package.json ./packages/ui/
COPY packages/bridge/package.json ./packages/bridge/
COPY packages/server-core/package.json ./packages/server-core/
COPY apps/ignis-server/package.json ./apps/ignis-server/

RUN npm ci --ignore-scripts

COPY build.js ./
COPY packages/ ./packages/
COPY apps/ignis-server/ ./apps/ignis-server/

RUN npm run build

# Production image. No Obsidian code included.
# On first run, the entrypoint downloads Obsidian.
FROM node:22-slim

LABEL com.thiefling.ignis.obsidian-version="1.12.7"

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates curl gosu \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Workspace package.jsons + lockfile so npm ci sets up the @ignis/* symlinks.
COPY package.json package-lock.json ./
COPY packages/services/package.json ./packages/services/
COPY packages/shim/package.json ./packages/shim/
COPY packages/ui/package.json ./packages/ui/
COPY packages/bridge/package.json ./packages/bridge/
COPY packages/server-core/package.json ./packages/server-core/
COPY apps/ignis-server/package.json ./apps/ignis-server/

RUN npm ci --omit=dev --ignore-scripts

# Runtime sources: the server, entrypoint script, repo-rooted images, and the server-core JS that gets required from the server at runtime.
COPY apps/ignis-server/server/ ./apps/ignis-server/server/
COPY apps/ignis-server/scripts/ ./apps/ignis-server/scripts/
COPY images/ ./images/
COPY packages/server-core/src/ ./packages/server-core/src/

# Built artifacts from the build stage.
COPY --from=build /app/packages/shim/dist/shim-loader.js ./packages/shim/dist/shim-loader.js
COPY --from=build /app/packages/ui/dist/ignis-ui.js ./packages/ui/dist/ignis-ui.js
COPY --from=build /app/apps/ignis-server/server/build-info.json ./apps/ignis-server/server/build-info.json
COPY --from=build /app/apps/ignis-server/server/plugins/headless-sync/obsidian/dist/ ./apps/ignis-server/server/plugins/headless-sync/obsidian/dist/

RUN chmod +x /app/apps/ignis-server/scripts/entrypoint.sh

ENV PORT=8080
ENV VAULT_ROOT=/vaults
ENV OBSIDIAN_VERSION=1.12.7
ENV OBSIDIAN_ASSETS_PATH=/app/obsidian-app
ENV PUID=1000
ENV PGID=1000
# Authentication (optional):
# ENV IGNIS_AUTH_USER=admin
# ENV IGNIS_AUTH_PASS=your-password
# ENV IGNIS_API_KEY=sk-xxxxxxxx
# ENV IGNIS_AUTH_TIMEOUT_MS=86400000

EXPOSE 8080

VOLUME /vaults
VOLUME /app/obsidian-app

ENTRYPOINT ["/app/apps/ignis-server/scripts/entrypoint.sh"]
