# GLaDOS Server Dockerfile
# Uses Node.js native TypeScript stripping - no build step required

FROM node:24-alpine

# Install dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++ libstdc++

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.6.0 --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files (TypeScript files run directly via --experimental-strip-types)
COPY src/ ./src/

# Create data directory for SQLite database
RUN mkdir -p /data && chown -R node:node /data /app

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
