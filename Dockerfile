# ====================
# Stage 1: Base
# ====================
FROM node:22-slim AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# ====================
# Stage 2: Dependencies (Backend)
# ====================
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ====================
# Stage 3: Dependencies (UI)
# ====================
FROM base AS ui-deps
WORKDIR /app/ui
COPY ui/package.json ui/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ====================
# Stage 4: Build Backend (tsc only)
# ====================
FROM base AS build-backend
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN ./node_modules/.bin/tsc --project tsconfig.json

# ====================
# Stage 5: Build UI (vite build)
# ====================
FROM base AS build-ui
WORKDIR /app/ui
COPY --from=ui-deps /app/ui/node_modules ./node_modules
COPY ui/ ./
RUN pnpm build

# ====================
# Stage 6: Production dependencies (pruned)
# ====================
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod && \
    # Remove unnecessary files from node_modules to reduce image size
    find node_modules -name "*.d.ts" -delete 2>/dev/null || true && \
    find node_modules -name "*.map" -delete 2>/dev/null || true && \
    find node_modules -name "README*" -delete 2>/dev/null || true && \
    find node_modules -name "CHANGELOG*" -delete 2>/dev/null || true && \
    find node_modules -name "LICENSE*" -delete 2>/dev/null || true && \
    find node_modules -name ".npmignore" -delete 2>/dev/null || true && \
    find node_modules -type d -name "test" -prune -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d -name "tests" -prune -exec rm -rf {} + 2>/dev/null || true && \
    find node_modules -type d -name "__tests__" -prune -exec rm -rf {} + 2>/dev/null || true

# ====================
# Stage 7: Production (pro mode - full features)
# ====================
FROM node:22-slim AS production

# Install runtime dependencies: Chromium for Playwright, git for agent sandbox
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Enable pnpm via corepack (for agent sandbox: clone, build, lint)
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set Playwright to use system Chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Create non-root user for security
RUN groupadd -g 1001 profclaw && \
    useradd -u 1001 -g profclaw -s /bin/bash -m profclaw

WORKDIR /app

# Copy pruned production deps (smaller than full node_modules)
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build-backend /app/dist ./dist
COPY --from=build-backend /app/package.json ./

# Copy runtime config (settings.yml for storage tier, queue, etc.)
COPY --from=build-backend /app/config ./config

# Copy skills
COPY --from=build-backend /app/skills ./skills

# Copy UI build artifacts
COPY --from=build-ui /app/ui/dist ./ui/dist

# Create data directory for SQLite and link CLI binary
RUN mkdir -p /app/data && \
    ln -sf /app/dist/cli/index.js /usr/local/bin/profclaw && \
    chmod +x /app/dist/cli/index.js 2>/dev/null || true && \
    chown -R profclaw:profclaw /app

# Production environment defaults (override via env_file or environment)
ENV NODE_ENV=production
ENV PORT=3000
ENV PROFCLAW_MODE=pro

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Switch to non-root user
USER profclaw

EXPOSE 3000

CMD ["node", "dist/server.js"]
