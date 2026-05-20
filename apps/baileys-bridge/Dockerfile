# syntax=docker/dockerfile:1
#
# Bridge image. Multi-stage so the final layer is just the compiled JS +
# pruned node_modules. Built with the repo as context (see compose file).

FROM node:20-slim AS deps
WORKDIR /app
# `git` is needed for pnpm to fetch git-URL deps (baileys 6.x bundles
# libsignal-node as a GitHub tarball). `ca-certificates` is needed for HTTPS
# during the clone. The slim base image ships neither.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/baileys-bridge/package.json apps/baileys-bridge/package.json
RUN pnpm install --filter @openclaw-crm/baileys-bridge... --frozen-lockfile

# Patch baileys 7.0.0-rc11 migrateSession bug — see WhiskeySockets/Baileys#2548.
# The `device-list` lookup in libsignal.js reads from a different key format than
# what auth-state actually writes, so outbound messages silently fail to deliver
# (no `messages.upsert`, infinite retry loop, recipient never sees the message).
# Forcing `userDevices = null` makes the function bail out early and restores
# the pre-rc.10 send behaviour. Drop this when upstream ships a fix.
RUN find /app/node_modules -path '*baileys/lib/Signal/libsignal.js' -not -path '*/types*' \
    -exec sed -i "s|const { \[user\]: userDevices } = await parsedKeys.get('device-list', \[user\]);|const { [user]: userDevices } = { [user]: null }; /* patched: #2548 */|g" {} +

FROM node:20-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app /app
COPY apps/baileys-bridge ./apps/baileys-bridge
RUN pnpm --filter @openclaw-crm/baileys-bridge build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/baileys-bridge/node_modules /app/apps/baileys-bridge/node_modules
COPY --from=build /app/apps/baileys-bridge/dist /app/apps/baileys-bridge/dist
COPY --from=build /app/apps/baileys-bridge/package.json /app/apps/baileys-bridge/package.json
WORKDIR /app/apps/baileys-bridge
EXPOSE 8787
CMD ["node", "dist/index.js"]
