FROM node:24-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN npm ci

FROM dependencies AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY . .
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
    && npm run build --workspace=@ad-wiki/shared-types \
    && npm run build --workspace=api

FROM node:24-bookworm-slim AS node-runtime

FROM postgres:18-bookworm AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=node-runtime /usr/local/ /usr/local/
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY docker/backup-entrypoint.sh /usr/local/bin/ad-wiki-backup-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/ad-wiki-backup-entrypoint \
    && chmod +x /usr/local/bin/ad-wiki-backup-entrypoint

ENTRYPOINT ["tini", "--", "ad-wiki-backup-entrypoint"]
CMD ["worker"]
