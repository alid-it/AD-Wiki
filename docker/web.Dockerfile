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

WORKDIR /app
COPY . .
# Next.js ermittelt den Paketmanager beim optionalen SWC-Download aus dem
# App-Verzeichnis. Im npm-Workspace verweist dieses Lockfile auf die zentrale
# Root-Lockdatei und verhindert den falschen Fallback auf Corepack/Yarn.
RUN ln -s ../../package-lock.json apps/web/package-lock.json
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=@ad-wiki/shared-types \
    && npm run build --workspace=web

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app

COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
# Die Standalone-Dateiverfolgung übernimmt bei der zentral überschriebenen
# SWC-Version nicht alle ESM-Helfer, obwohl der Next-Server sie zur Laufzeit lädt.
COPY --from=builder --chown=node:node /app/node_modules/@swc/helpers ./node_modules/@swc/helpers

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
