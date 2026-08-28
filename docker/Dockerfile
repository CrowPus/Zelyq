# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Build stage — install every workspace dependency once, then compile.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

RUN corepack enable
WORKDIR /app

# Manifests first, so a source-only change does not reinstall the world.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/agent/package.json apps/agent/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/runtime-host/package.json apps/runtime-host/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/runtime/package.json packages/runtime/
COPY packages/tools/package.json packages/tools/

# The browser itself is installed once, in the runtime stage below — this
# stage never runs it, so there is nothing to download here.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build && pnpm --filter @zelyq/web build

# Ship runtime dependencies only.
RUN pnpm prune --prod

# ---------------------------------------------------------------------------
# Runtime stage
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# git is used by generated projects; tini reaps the dev servers the runtime
# spawns, which would otherwise pile up as zombies.
RUN apt-get update \
    && apt-get install --no-install-recommends -y git tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    ZELYQ_SERVER_HOST=0.0.0.0 \
    ZELYQ_AGENT_HOST=0.0.0.0 \
    ZELYQ_WORKSPACE_DIR=/data/workspace \
    DATABASE_URL=file:/data/zelyq.db \
    PLAYWRIGHT_BROWSERS_PATH=/app/.playwright

WORKDIR /app
COPY --from=build /app /app

# The agent's `view_preview` tool needs a real headless Chromium —
# installed here, as root, so `--with-deps` can also install the system
# libraries it needs. `PLAYWRIGHT_BROWSERS_PATH` above keeps the download
# inside /app rather than root's own home directory, so the chown just below
# still covers it and the `node` user can actually launch it later.
RUN node_modules/.bin/playwright install --with-deps chromium

RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 8787 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/server/dist/index.js"]
