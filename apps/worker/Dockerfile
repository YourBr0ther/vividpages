# syntax=docker/dockerfile:1
#
# Production image for apps/worker (BullMQ worker, runs TS directly via tsx —
# there is no build step).
#
# Build from the repo root:
#   docker build -f apps/worker/Dockerfile -t vividpages-worker .
#
# Stages:
#   base   - pinned Node + corepack/pnpm
#   deps   - installs the full workspace from the lockfile (cached on manifests)
#   prune  - `pnpm deploy` -> self-contained worker (tsx + core/db/ai + src)
#   runner - minimal runtime, non-root, worker as PID 1
#
# Targeting linux/amd64 for the k3s cluster (see T33); see notes at bottom.

# ---- base -------------------------------------------------------------------
# Node 22 (AWS SDK in @vividpages/core wants 22+ from 2027). bookworm-slim
# provides the glibc that sharp's prebuilt linux binaries link against.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---- deps -------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY packages/ai/package.json packages/ai/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
# The worker has no compile step (it runs TS via tsx). We just add the source
# on top of the resolved workspace. pnpm's `deploy` is unreliable for packages
# consumed as raw-TS workspace symlinks, so we ship the resolved workspace as
# installed and let tsx resolve @vividpages/* through the pnpm symlinks.
FROM deps AS build
COPY . .

# ---- runner -----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

# Non-root.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nodejs

# Copy the whole resolved workspace (node_modules with the pnpm store +
# symlinks, plus all source for the worker and the @vividpages/* packages it
# imports as raw TS). Web/.next is excluded by .dockerignore so it isn't here.
COPY --from=build --chown=nodejs:nodejs /app ./

WORKDIR /app/apps/worker
USER nodejs

# Run the worker as PID 1 via node + tsx's ESM loader. Using `node` directly
# (not `pnpm`/`tsx` wrapper scripts) and the exec form means SIGTERM is
# delivered straight to this process, so the worker's SIGTERM handler runs and
# performs a graceful shutdown (workers.close() -> closeQueues/Storage/Db).
# Node as PID 1 reaps the worker's own children fine here; no tini needed.
CMD ["node", "--import", "tsx", "src/index.ts"]
