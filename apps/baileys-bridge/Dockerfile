# syntax=docker/dockerfile:1
#
# Bridge image. Multi-stage so the final layer is just the compiled JS +
# pruned node_modules. Built with the repo as context (see compose file).

FROM node:20-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/baileys-bridge/package.json apps/baileys-bridge/package.json
RUN pnpm install --filter @openclaw-crm/baileys-bridge... --frozen-lockfile

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
