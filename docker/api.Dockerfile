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

FROM builder AS bootstrap

RUN sed -i 's/\r$//' docker/api-entrypoint.sh && chmod +x docker/api-entrypoint.sh
WORKDIR /app/apps/api
ENTRYPOINT ["/app/docker/api-entrypoint.sh"]
CMD ["sh", "-c", "npx prisma migrate deploy && npm run db:bootstrap"]

FROM node:24-bookworm-slim AS production-dependencies

WORKDIR /prod
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN npm ci --omit=dev --omit=peer \
    --workspace=api \
    --workspace=@ad-wiki/shared-types \
    --include-workspace-root=false
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=production-dependencies --chown=node:node /prod/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=node:node /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY docker/api-entrypoint.sh /usr/local/bin/ad-wiki-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/ad-wiki-entrypoint \
    && chmod +x /usr/local/bin/ad-wiki-entrypoint \
    && mkdir -p /app/uploads \
    && chown node:node /app/uploads

USER node
EXPOSE 4000
ENTRYPOINT ["tini", "--", "ad-wiki-entrypoint"]
CMD ["node", "apps/api/dist/main.js"]
