# syntax=docker/dockerfile:1.7
# Multi-stage build for surveillance-health-monitor.
# Produces a single image that runs in either SHIM_MODE=api or SHIM_MODE=worker.

# --- build stage ---------------------------------------------------------
FROM node:20-bookworm-slim AS build

WORKDIR /app

# Install deps with caching.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

# Copy source.
COPY tsconfig.json ./
COPY src ./src
COPY openapi.yaml ./

# Compile.
RUN npm run build

# --- runtime stage -------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

# Run as non-root.
RUN groupadd --system app && useradd --system --gid app --create-home --home-dir /home/app app
WORKDIR /app

# Copy the manifest + build output only.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/migrations ./src/db/migrations
COPY --from=build /app/openapi.yaml ./openapi.yaml

USER app

ENV NODE_ENV=production \
    SHIM_MODE=api \
    HTTP_PORT=8080

EXPOSE 8080

# Healthcheck assumes /healthz is reachable on the configured HTTP_PORT.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.HTTP_PORT+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
