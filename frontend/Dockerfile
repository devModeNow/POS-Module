# Stage 1: Build Angular
# node:20 is more stable than 22-slim for `npm ci` (SIGSEGV / exit 139 on small VPS).
FROM node:20-bookworm-slim AS builder
LABEL org.opencontainers.image.title="alingbeth-frontend-builder"

WORKDIR /app

ENV NODE_OPTIONS=--max-old-space-size=2048 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    npm_config_jobs=2 \
    NG_BUILD_MAX_WORKERS=1 \
    UV_THREADPOOL_SIZE=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN node -v && npm -v \
  && (npm ci --no-audit --no-fund \
      || (echo "npm ci failed; retrying once" && rm -rf node_modules && npm ci --no-audit --no-fund) \
      || (echo "npm ci segfaulted; falling back to npm install" && rm -rf node_modules && npm install --no-audit --no-fund))

COPY . .

# Baked into env.generated.ts at build time (browser calls the public API host)
ARG API_URL=https://api-alingbeth-staging.webkodex.com
ARG PUBLIC_SITE_URL=https://alingbeth-staging.webkodex.com
ARG BUILD_ID=
ENV API_URL=$API_URL \
    NG_APP_API_BASE_URL=$API_URL \
    PUBLIC_SITE_URL=$PUBLIC_SITE_URL \
    BUILD_ID=$BUILD_ID

# Avoid package.json's 4GB heap, which OOMs typical VPS builds.
RUN npm run env \
  && node --max-old-space-size=2048 ./node_modules/@angular/cli/bin/ng.js build --configuration=production

# Stage 2: Nginx on port 80 (Cloudflare tunnel → frontend:80)
FROM nginx:alpine

COPY --from=builder /app/dist/ng-tailadmin/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
