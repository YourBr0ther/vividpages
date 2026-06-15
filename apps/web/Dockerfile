# syntax=docker/dockerfile:1
#
# Production image for apps/web (Next.js 16, output: 'standalone').
#
# Build from the repo root:
#   docker build -f apps/web/Dockerfile -t vividpages-web .
#
# Stages:
#   base    - pinned Node + corepack/pnpm, shared by every stage
#   deps    - installs the full workspace from the lockfile (cached on manifests)
#   build   - `pnpm -F web build` -> Next standalone + serwist public/sw.js
#   migrate - prunes the workspace to just what `db:migrate` needs (drizzle-kit)
#   runner  - minimal runtime: standalone server + static + public + migrate deps
#
# Targeting linux/amd64 for the k3s cluster (see T33); see notes at bottom.

# ---- base -------------------------------------------------------------------
# AWS SDK (in @vividpages/core) warns it will require Node 22+ in 2027, so we
# track Node 22 now. bookworm-slim ships the glibc that sharp's prebuilt
# linux binaries link against.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---- deps -------------------------------------------------------------------
# Copy only the manifests first so `pnpm install` is cached until a manifest or
# the lockfile changes. Every workspace package.json must be present for the
# workspace graph to resolve.
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
FROM deps AS build
COPY . .
# The build is env-independent: getDb()/getEnv() are lazy (call-time only) and
# auth.ts uses a lazy adapter, so no DATABASE_URL/AUTH_SECRET/etc. is needed at
# build time (verified: this builds with no DB reachable and no env set).
ENV NEXT_TELEMETRY_DISABLED=1
# Produces apps/web/.next/standalone (Next traces workspace deps in), plus
# apps/web/.next/static and the serwist public/sw.js.
RUN pnpm -F web build

# ---- migrate ----------------------------------------------------------------
# The standalone output tree-shakes out drizzle-kit (a devDependency), so the
# runner can't run `pnpm -F @vividpages/db db:migrate` against the standalone
# node_modules. We instead assemble a small, self-contained migrate bundle: the
# db package's schema/config + the drizzle/ migrations, plus a fresh install of
# just the tools drizzle-kit needs to apply them. T33 wires this as an init job.
# Run it with:  drizzle-kit migrate  (cwd /app/migrate, DATABASE_URL set).
FROM base AS migrate
WORKDIR /migrate
COPY packages/db/drizzle.config.ts ./drizzle.config.ts
COPY packages/db/src ./src
COPY packages/db/drizzle ./drizzle
# Versions match packages/db/package.json (drizzle-kit/orm) + pg. Use npm here
# for an isolated, lockfile-free bundle (drizzle-kit applies SQL migrations and
# needs no native build steps). --omit=optional skips esbuild's optional native
# extras that drizzle-kit does not require to run migrations.
RUN npm init -y >/dev/null \
    && npm install --no-audit --no-fund --omit=optional \
       drizzle-kit@^0.31.1 drizzle-orm@^0.44.2 pg@^8.16.0

# ---- runner -----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

# Non-root.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# --- Next.js standalone runtime ---
# The standalone tree is rooted at apps/web/.next/standalone and already
# contains a hoisted node_modules plus apps/web/server.js. static and public
# are NOT included by the tracer and must be copied alongside.
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# --- db:migrate runtime ---
# Self-contained migrate bundle (drizzle-kit + drizzle-orm + pg + schema +
# migrations), so this image can also apply migrations (see T33 init job):
#   docker run ... --workdir /app/migrate vividpages-web \
#     node_modules/.bin/drizzle-kit migrate
COPY --from=migrate --chown=nextjs:nodejs /migrate ./migrate

USER nextjs
EXPOSE 3000

# Standalone server runs as PID 1; Next handles SIGTERM for graceful shutdown.
CMD ["node", "apps/web/server.js"]
