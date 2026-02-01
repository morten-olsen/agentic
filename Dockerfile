# GLaDOS Server Dockerfile
# Multi-stage build for minimal image size

# =============================================================================
# Build stage - compile TypeScript and install dependencies
# =============================================================================
FROM node:22-alpine AS builder

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.6.0 --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including dev for build)
RUN pnpm install --frozen-lockfile

# Copy source files
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN pnpm build

# =============================================================================
# Production stage - minimal runtime image
# =============================================================================
FROM node:22-alpine AS production

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache libstdc++

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.6.0 --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files and source (needed for --experimental-strip-types)
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/src/ ./src/

# Create data directory for SQLite database
RUN mkdir -p /data && chown -R node:node /data

# Use non-root user
USER node

# Environment variables
ENV NODE_ENV=production
ENV GLADOS_DB_PATH=/data/glados.db

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "console.log('healthy')" || exit 1

# Expose data volume
VOLUME ["/data"]

# Run the server
CMD ["node", "--experimental-strip-types", "src/server/server.ts"]
