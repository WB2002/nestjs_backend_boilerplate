# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24-alpine

# ------------------------------------------------------------------------------
# Stage 1: Dependencies & Build
# ------------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder

# Enable corepack and use the exact pnpm version pinned in package.json
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV HUSKY=0
ENV CI=true

RUN corepack enable

WORKDIR /app

# Copy dependency manifests first for optimal layer caching
COPY package.json pnpm-lock.yaml ./

# Fast, cached dependency installation using BuildKit store cache
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Copy application source code
COPY . .

# Compile TypeScript to JavaScript in /app/dist
RUN pnpm run build

# Prune devDependencies in-place without triggering dev lifecycle scripts like husky
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm prune --prod --ignore-scripts \
 && find /app/node_modules -type f -iname "*.md" -delete

# ------------------------------------------------------------------------------
# Stage 2: Minimal Production Runtime
# ------------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS production

# Install dumb-init for proper PID 1 signal forwarding and zombie process reaping
RUN apk add --no-cache dumb-init curl && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# Enable production V8 optimizations and framework caching
ENV NODE_ENV=production
ENV PORT=3000
ENV MALLOC_ARENA_MAX=2

# Copy only the pruned node_modules and compiled dist from builder
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json

# Invariant check: enforce zero markdown files in the final runtime container
RUN find /app -name "*.md" | (! grep .)

# Run as unprivileged built-in 'node' user (UID 1000)
USER node

EXPOSE 3000

# Container liveness check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/health/live || exit 1

# dumb-init forwards SIGTERM for graceful connection draining
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "-r", "./dist/instrumentation.js", "dist/main"]
