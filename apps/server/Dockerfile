# Build context for this Dockerfile is apps/ (see docker-compose.yml). We build
# from that workspace root so the server can resolve @socia/* packages without
# bringing web/ or infra/ into the Docker context.
#
# ── Build stage ────────────────────────────────────────────────────────────
FROM node:22-bookworm AS build

WORKDIR /repo

# Native deps for better-sqlite3 etc. (build only)
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# pnpm via corepack (matches the version pinned in package.json)
RUN corepack enable

# Workspace manifests first — better Docker layer caching: pnpm only re-runs
# when a package.json changes.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY server/package.json server/
COPY packages/socia-eval/package.json packages/socia-eval/
COPY packages/socia-branding/package.json packages/socia-branding/
# socia-runtime is browser-only (chrome.* APIs) and not consumed by the
# server — but it is part of the workspace, so its manifest is needed for
# pnpm install to succeed.
COPY packages/socia-runtime/package.json packages/socia-runtime/
# extensions is also in the workspace; only its manifest is needed,
# without the postinstall (`wxt prepare`) which requires extension sources.
COPY extensions/package.json extensions/

RUN pnpm install --filter @socia/server... --frozen-lockfile=false --ignore-scripts

# Now bring in the actual sources we need to build the server.
COPY server/ server/
COPY packages/socia-eval/ packages/socia-eval/
COPY packages/socia-branding/ packages/socia-branding/

# tsup bundles src/index.ts → dist/index.js (single file, native deps stay external)
# vite build emits panel/dist
RUN pnpm --filter @socia/server build

# Trim dev deps for the runtime stage
RUN pnpm --filter @socia/server prune --prod

# ── Runtime stage ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS run

WORKDIR /app

ENV NODE_ENV=production

# The server's bundled dist + its production node_modules + its package.json
# are everything we need at runtime. `apps/server/node_modules` from a pnpm
# workspace contains symlinks into the global store; using a plain copy with
# -L (--dereference) flattens those symlinks into real files.
COPY --from=build --chown=node:node /repo/server/dist ./dist
COPY --from=build --chown=node:node /repo/server/panel/dist ./panel/dist
COPY --from=build --chown=node:node /repo/server/package.json ./package.json
COPY --from=build --chown=node:node /repo/server/node_modules ./node_modules

# Persistent volume for SQLite + workflows + PDFs
VOLUME ["/data"]
ENV DATA_DIR=/data
ENV PORT=4317

EXPOSE 4317

USER node
CMD ["node", "dist/index.js"]
