# syntax=docker/dockerfile:1

# ---- Stage 1: build the whole workspace ----
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

# Copy manifests first for better layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY server/package.json ./server/
COPY admin/package.json ./admin/
RUN pnpm install --frozen-lockfile

# Copy sources and build both packages.
COPY server ./server
COPY admin ./admin
RUN pnpm --filter admin build
RUN pnpm --filter server build

# Prune to production-only deps for the server (smaller runtime copy).
RUN pnpm --filter server --prod deploy /pruned

# ---- Stage 2: slim runtime ----
FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

# The runtime preserves the workspace's `server/` directory level on purpose.
# The compiled admin server resolves the built SPA from its own module path
# (`server/src/admin` → ../../../admin/dist, i.e. compiled `server/dist/admin/server.js`
# → ../../../admin/dist), NOT from the process CWD. Keeping server output at
# /app/server/dist and the SPA at /app/admin/dist makes that three-level `..`
# resolve to /app/admin/dist exactly. Running the process from /app (the WORKDIR)
# also makes the CWD-relative FILES_DIR default (./data/files) resolve to
# /app/data/files — the host-mounted data volume in docker-compose.yml.

# Production server: deployed (prod) node_modules + compiled dist + migrations + drizzle config.
COPY --from=build /pruned/node_modules ./server/node_modules
COPY --from=build /repo/server/dist ./server/dist
COPY --from=build /repo/server/drizzle ./server/drizzle
COPY --from=build /repo/server/drizzle.config.ts ./server/drizzle.config.ts
COPY --from=build /repo/server/package.json ./server/package.json

# Built admin SPA served statically by Fastify (@fastify/static) in production.
COPY --from=build /repo/admin/dist ./admin/dist

# Apply migrations (idempotent) then start. drizzle-kit is a devDependency stripped by
# `pnpm --prod deploy`, so it is not in this runtime image — fetch it at container start
# via pnpm dlx. The version is pinned to 0.28.1 to match CI and the locked
# "drizzle-kit": "^0.28.1" devDependency (Task 1), so the exact migration engine tested
# in CI is the one that runs against the prod database.
#
# migrate runs with CWD /app/server (where drizzle.config.ts's `out: './drizzle'` and the
# config's `import.meta.url`-relative `../.env` resolve); the app then starts from /app so
# `./data/files` maps onto the mounted /app/data volume and the SPA path resolves correctly.
CMD ["sh", "-c", "cd /app/server && pnpm dlx drizzle-kit@0.28.1 migrate && cd /app && node server/dist/index.js"]
