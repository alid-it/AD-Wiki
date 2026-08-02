# AD-Wiki

[![English](https://img.shields.io/badge/Language-English-2563eb)](README.md)
[![Deutsch](https://img.shields.io/badge/Sprache-Deutsch-6b7280)](README.de.md)

[![CI](https://github.com/alid-it/AD-WIKI/actions/workflows/ci.yml/badge.svg)](https://github.com/alid-it/AD-WIKI/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/alid-it/AD-WIKI?display_name=tag)](https://github.com/alid-it/AD-WIKI/releases/latest)
![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)

> A modern, self-hostable knowledge platform for wiki content, notes,
> standards, and AI-powered access to knowledge.

AD-Wiki combines structured knowledge management with fine-grained
permissions, versioning, secure backups, and an MCP endpoint for clients such
as Codex or Claude Code. The project is a strictly typed TypeScript monorepo
distributed as a Docker Compose stack.

Current release: **[latest stable version](https://github.com/alid-it/AD-Wiki/releases/latest)**

## Features

### Create and organize knowledge

- Hierarchies of areas, categories, folders, and pages
- Tiptap-based WYSIWYG editor with Markdown support
- Drafts, publishing, trash, and comparable page versions
- Tags, bookmarks, media management, and protected file streams
- Global search, related content, and visual page relationships
- Personal and shared notes
- Policies and standards with rules, versions, and exceptions
- Export to Markdown, PDF, and ZIP

### Identities and permissions

- Local authentication with access and refresh token rotation
- Roles and individual user overrides
- Groups, group managers, and membership roles
- Knowledge Spaces and inheritable resource ACLs
- OIDC/SSO providers, including Microsoft Entra ID
- JIT provisioning and external group and role mappings
- Audit logs, API keys, and a protected initial administrator account

### MCP and integrations

- MCP over Streamable HTTP with OAuth 2.1 and PKCE
- Knowledge search, read, write, and quality tools
- Resource and permission checks before every MCP data access
- Token management, rate limits, and structured audits
- Microsoft To Do integration with import, export, and synchronization
- SMTP configuration and secure password recovery

### Operations and backups

- Encrypted backups with scheduling and retention policies
- Local paths, network mounts, SFTP, and S3-compatible storage
- Checksums, atomic publishing, and guided restore preparation
- System information, readiness and liveness endpoints, and Prometheus metrics
- Structured JSON logs and WebSocket notifications
- Versioned GHCR images, SBOM, provenance, and automated CI/CD

## Quick start with Docker Compose

Installing from a release requires neither the repository nor Node.js. Docker
Engine with Docker Compose must be installed.

```bash
mkdir ad-wiki
cd ad-wiki

curl --fail --location --remote-name \
  https://github.com/alid-it/AD-Wiki/releases/latest/download/docker-compose.yml

curl --fail --location --remote-name \
  https://github.com/alid-it/AD-Wiki/releases/latest/download/env.production.example

cp env.production.example .env
nano .env
```

At a minimum, set the public domain, the initial administrator account, and
all empty `AD_WIKI_*` secrets in `.env`. On Linux, you can generate random
values as follows:

```bash
# General secrets
openssl rand -base64 48

# Keys that require exactly 32 bytes
openssl rand -base64 32
```

Validate the configuration and start the stack:

```bash
docker compose config --quiet
docker compose up -d
docker compose ps
```

Docker Compose pulls PostgreSQL, Redis, and the AD-Wiki version pinned in
`.env`. Before the API starts, `database-init` automatically applies all
Prisma migrations and idempotently creates the initial administrator account.

> **Registry note:** As long as the GHCR packages are private, the Docker host
> must run `docker login ghcr.io` once using a GitHub token with
> `read:packages`. Public packages can be pulled without signing in.

Learn more:

- [Production deployment with Docker](docs/production-docker.md)
- [CI/CD, releases, and rollback](docs/ci-cd.md)
- [Backup and restore](docs/backup-restore.md)

## Update and rollback

AD-Wiki deliberately uses fixed version tags instead of uncontrolled `latest`
deployments. To update, set the desired version in `.env`:

```env
AD_WIKI_IMAGE_TAG=v1.0.1
AD_WIKI_VERSION=1.0.1
```

Then run:

```bash
docker compose pull
docker compose up -d --remove-orphans
docker compose ps
```

Create and verify a backup before updating. To roll back, return to the
previous image tag. If a database migration is not backward compatible, also
follow the documented restore procedure.

## Local development

### Prerequisites

- Node.js 24
- npm 11
- Docker Desktop or Docker Engine with Compose
- Git

Other package managers, including pnpm and Yarn, are not supported.

### Start the repository

```bash
git clone https://github.com/alid-it/AD-WIKI.git
cd AD-WIKI

npm ci

cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local

docker compose up -d
npm run db:migrate
npm run dev
```

The real `.env` files remain local and must never be committed.

| Service | Address |
| --- | --- |
| Web interface | `http://localhost:3000` |
| REST API | `http://localhost:4000/api/v1` |
| Swagger | `http://localhost:4000/api/docs` |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |
| CloudBeaver | `http://localhost:8978` |

### Important commands

```bash
# Run the web app and API in development mode
npm run dev

# Build the complete monorepo
npm run build

# Run automated security, MCP, backup, and domain tests
npm run test:mcp

# Create a Prisma migration for a schema change
npx prisma migrate dev --name description

# Open Prisma Studio
npm run db:studio
```

All database changes must be made exclusively through Prisma migrations.

## Architecture

```text
AD-WIKI/
├── apps/
│   ├── api/                  NestJS API, Prisma, and workers
│   └── web/                  Next.js App Router
├── packages/
│   ├── api-client/           shared typed API client
│   ├── config/               shared TypeScript configuration
│   └── shared-types/         Zod schemas and TypeScript types
├── docker/                   multi-stage production Dockerfiles
├── deploy/                   source-free release Compose files
├── docs/                     operations and integration documentation
└── .github/workflows/        CI and container releases
```

| Layer | Technology |
| --- | --- |
| Web | Next.js 16, React 19, Tailwind CSS 4, Tiptap |
| API | NestJS 11, TypeScript strict mode, Swagger |
| Contracts | Zod and `packages/shared-types` as the single source of truth |
| Database | PostgreSQL 18, Prisma 7 with `@prisma/adapter-pg` |
| Cache and jobs | Redis 7 |
| Real-time | Socket.IO |
| Monorepo | npm Workspaces and Turborepo |
| Operations | Docker Compose, nginx, and GitHub Actions |

The Prisma schema currently contains 54 models. In addition to wiki content,
users, and sessions, these cover notes, standards, spaces, resource ACLs,
identity providers, OAuth, integrations, backups, and audit data.

## Security

- Strict Zod validation for API inputs and outputs
- No untyped `any` contracts between the web app and API
- Hashed passwords, refresh tokens, API keys, and MCP tokens
- Authenticated encryption for sensitive integration and backup data
- Host and origin allowlists, rate limits, and secure proxy configuration
- Permission checks for wiki content, notes, standards, spaces, and MCP
- Upload validation based on actual file content
- Secret history scanning in CI

Security-related production details are documented in:

- [MCP operations guide](docs/mcp-operations.md)
- [SSO operations](docs/sso-betrieb.md)
- [Monitoring](docs/monitoring.md)
- [Microsoft Entra setup](docs/entra-setup.md)

## CI/CD

Every push to `main` and every pull request runs:

1. A scan of the Git history for secrets
2. Installation from `package-lock.json`
3. Prisma validation and client generation
4. All migrations against an empty PostgreSQL 18 database
5. The monorepo build and automated tests
6. Validation of the source-free Compose deployment
7. Builds of all production images

A tag such as `v1.0.1` then starts the container release. The workflow
publishes versioned, immutable images to GHCR and creates a GitHub release with
`docker-compose.yml` and `env.production.example`.

## Documentation

| Topic | Document |
| --- | --- |
| Docker production | [docs/production-docker.md](docs/production-docker.md) |
| Releases and rollback | [docs/ci-cd.md](docs/ci-cd.md) |
| Backup and restore | [docs/backup-restore.md](docs/backup-restore.md) |
| MCP operations | [docs/mcp-operations.md](docs/mcp-operations.md) |
| MCP with Claude Code | [docs/MCP_Tutorial.md](docs/MCP_Tutorial.md) |
| Microsoft Entra | [docs/entra-setup.md](docs/entra-setup.md) |
| SSO operations | [docs/sso-betrieb.md](docs/sso-betrieb.md) |
| Monitoring | [docs/monitoring.md](docs/monitoring.md) |

Open and completed technical items are tracked in [Bugs.md](Bugs.md).

## Project status

AD-Wiki `v1.0.0` is available as the first versioned container release.
Production backup and restore tests have been completed for local mounts, SMB,
and SFTP. Ongoing work and outstanding operational approvals are documented in
[Bugs.md](Bugs.md).
