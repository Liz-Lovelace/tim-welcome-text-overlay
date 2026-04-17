# syntax=docker/dockerfile:1.6
#
# Overlay service — renders a transparent 1920x1080 PNG of two lines of text.
#
# Multi-stage build:
#   deps    → install all npm deps (needed for bundling)
#   build   → run Remotion prebundle so runtime skips webpack
#   runtime → slim image with Chromium shared libs, bundle + node_modules,
#             Chromium headless shell pre-downloaded. Listens on :3000.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund


FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json remotion.config.ts ./
COPY src ./src
COPY public ./public
RUN node --experimental-strip-types src/prebundle.ts


FROM node:22-bookworm-slim AS runtime

# Chromium headless-shell runtime deps on bookworm-slim.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libatspi2.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libgbm1 \
      libnss3 \
      libpango-1.0-0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/bundle ./bundle
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src ./src

# Pre-download Chromium headless-shell so first request doesn't pay the
# ~50MB download cost (baked into the image instead).
RUN node -e "import('@remotion/renderer').then(r => r.ensureBrowser())"

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    REMOTION_BUNDLE=/app/bundle

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--experimental-strip-types", "src/server.ts"]
