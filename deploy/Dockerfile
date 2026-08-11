# syntax=docker/dockerfile:1
# ══════════════════════════════════════════════════════════════════════════════
# Gainwell CHAMP · Spot Recognition Tool — production image
#
# Build from the REPO ROOT (the Dockerfile lives in deploy/, the context is ..):
#
#     docker build -f deploy/Dockerfile -t champ-spot-tool .
#
# or simply:  docker compose -f deploy/docker-compose.yml up --build
#
# Multi-stage: a fat builder (npm workspaces install + server tsc + web vite)
# and a lean runtime (production node_modules + compiled output only).
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

# better-sqlite3 is a NATIVE addon: `npm ci` compiles it with node-gyp, which
# needs python3 + a C/C++ toolchain. These live only in this stage — the
# compiled .node binary is copied to the (same-base, ABI-identical) runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install first with only the manifests so Docker layer-caches node_modules
# across source-only changes. Root + both workspace package.json files are
# needed for `npm ci` to resolve the workspace tree.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

# Server sources → tsc → server/dist (migrations in src/db/migrations/ are
# TypeScript, so they compile into server/dist/db/migrations/*.js — knex loads
# them from there at boot; no separate copy step is needed).
COPY server/tsconfig.json server/
COPY server/src server/src

# Web sources → vite build → web/dist (served statically by the server).
COPY web/tsconfig.json web/vite.config.ts web/index.html web/
COPY web/src web/src

RUN npm run build

# Drop devDependencies (typescript, tsx, vite, @types/*…) but keep the
# already-compiled better-sqlite3 binary — prune never rebuilds native code.
RUN npm prune --omit=dev

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080

# The directory layout must mirror the repo (server/dist two levels below the
# project root) because server/src/config.ts resolves PROJECT_ROOT as
# path.resolve(__dirname, '..', '..') — i.e. /app — and the SQLite file and
# web/dist paths hang off it.
WORKDIR /app

# Run as the unprivileged 'node' user that ships with the official image.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/server/package.json ./server/package.json
COPY --from=builder --chown=node:node /app/server/dist ./server/dist
COPY --from=builder --chown=node:node /app/web/dist ./web/dist

# SQLite data directory (default DB: /app/data/champ.sqlite3). Mount a volume
# here to persist recognitions across container restarts — see
# deploy/docker-compose.yml. Irrelevant (but harmless) when DATABASE_CLIENT=pg.
RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 8080

# NOTE: NODE_ENV=production makes the app REFUSE to boot with the default
# SESSION_SECRET — pass a real one (docker-compose.yml enforces this; on AWS
# it comes from Secrets Manager, see deploy/aws/main.tf).

# node:*-slim has no curl/wget; Node 22's global fetch probes /api/health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server/dist/index.js"]
