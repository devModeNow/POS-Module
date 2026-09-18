# Stage 1: build NestJS
# node:20 is more stable than 22-slim for `npm ci` (SIGSEGV / exit 139 on small VPS).
FROM node:20-bookworm-slim AS builder
LABEL org.opencontainers.image.title="alingbeth-backend-builder"

WORKDIR /app

ENV NODE_OPTIONS=--max-old-space-size=1536 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    npm_config_jobs=2

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN node -v && npm -v \
  && (npm ci --no-audit --no-fund \
      || (echo "npm ci failed; retrying once" && rm -rf node_modules && npm ci --no-audit --no-fund) \
      || (echo "npm ci segfaulted; falling back to npm install" && rm -rf node_modules && npm install --no-audit --no-fund))

COPY . .
RUN npm run build

# Stage 2: production deps (native modules like sharp)
FROM node:20-bookworm-slim AS deps
LABEL org.opencontainers.image.title="alingbeth-backend-deps"

WORKDIR /app

ENV NODE_OPTIONS=--max-old-space-size=1536 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    npm_config_jobs=2

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN node -v && npm -v \
  && (npm ci --omit=dev --no-audit --no-fund \
      || (echo "npm ci failed; retrying once" && rm -rf node_modules && npm ci --omit=dev --no-audit --no-fund) \
      || (echo "npm ci segfaulted; falling back to npm install" && rm -rf node_modules && npm install --omit=dev --no-audit --no-fund)) \
  && npm cache clean --force

# Stage 3: runtime
FROM node:20-bookworm-slim AS runner
LABEL org.opencontainers.image.title="alingbeth-backend"

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_PATH=/app

# pg_dump for in-app backups + sharp runtime libs
RUN apt-get update \
  && apt-get install -y --no-install-recommends gnupg curl ca-certificates libgomp1 \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-archive-keyring.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/postgresql-archive-keyring.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 \
  && apt-get purge -y gnupg curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/backups

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json package-lock.json ./
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

RUN sed -i 's/\r$//' /app/docker-entrypoint.sh \
  && chmod +x /app/docker-entrypoint.sh \
  && ln -sfn /app/dist /app/src

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
