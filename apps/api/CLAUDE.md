# Backend-Regeln (NestJS)

## Modulstruktur (Ist-Zustand)
- Ein NestJS-Modul pro Domäne unter `src/modules/`
- Pro Modul: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `dto/`
- Tatsächliche Ordnerstruktur:
  ```
  src/
  ├── main.ts                  # Bootstrap: Port 4000, globalPrefix "api/v1", CORS, Swagger
  ├── app.module.ts            # Wurzel-Modul, bindet alle Feature-Module ein
  ├── common/
  │   ├── config/
  │   │   └── jwt.config.ts     # getJwtSecret() – Pflicht-Secret ohne Fallback
  │   ├── decorators/
  │   │   └── roles.decorator.ts   # @Roles(...UserRole[])
  │   ├── guards/
  │   │   └── roles.guard.ts        # RolesGuard (prüft ROLES_KEY-Metadaten)
  │   └── pipes/
  │       └── zod-validation.pipe.ts
  ├── health/                  # GET /health (Liveness)
  ├── prisma/                  # PrismaService + PrismaModule (global)
  └── modules/
      ├── auth/                # Registrierung, Login, JWT, Refresh
      │   ├── decorators/current-user.decorator.ts  # @CurrentUser()
      │   ├── guards/jwt-auth.guard.ts              # JwtAuthGuard
      │   ├── strategies/jwt.strategy.ts
      │   └── types/jwt-payload.ts                  # JwtPayload, AuthenticatedUser
      ├── users/               # Eigenes Profil + Benutzerverwaltung (Admin)
      ├── pages/               # Seiten & Ordner (type=FOLDER|PAGE), Baum, Versionen
      ├── categories/          # Kategorien
      ├── media/               # Uploads, Markdown-Import, Seitenzuordnung
      ├── tags/  → nicht eigenständig: Tags werden im pages-Modul gepflegt
      ├── search/              # PostgreSQL Full-Text-Search
      ├── settings/            # Systemeinstellungen (Admin)
      ├── acls/                # Rollen-ACLs + individuelle user_permissions (Admin)
      └── versioning/          # Versionslogik (Service, von pages genutzt)
  ```
- Hinweis: Für `bookmarks` existiert eine DB-Tabelle, aber (noch) kein API-Modul.

## Endpunkte (Prefix `/api/v1`)
| Modul | Route | Auth |
|-------|-------|------|
| health | `GET /health` | öffentlich |
| auth | `POST /auth/register`, `/login`, `/refresh`, `/logout` | öffentlich |
| auth | `POST /auth/change-password`, `GET /auth/me` | JWT |
| users | `PATCH /users/me` | JWT |
| users | `GET /users`, `GET /users/:id`, `PATCH /users/:id`, `DELETE /users/:id` | JWT + Admin |
| pages | `GET /pages`, `/pages/tree/:categorySlug`, `/pages/uncategorized`, `/pages/tags`, `/pages/:id/versions`, `/pages/:slug` | öffentlich (Lesen) |
| pages | `POST /pages`, `PATCH /pages/:id`, `DELETE /pages/:id`, `POST /pages/import-markdown` | JWT + admin/editor |
| categories | `GET /categories`, `GET /categories/:slug` | öffentlich (Lesen) |
| categories | `POST /categories`, `PATCH /categories/:id`, `DELETE /categories/:id` | JWT + admin/editor |
| media | `GET /media`, `GET /media/:id` | öffentlich (Ausliefern) |
| media | `POST /media/upload`, `POST /media/import-markdown`, `PUT /media/:id/pages`, `DELETE /media/:id` | JWT |
| search | `GET /search?q=` | öffentlich |
| settings | `GET /settings`, `PATCH /settings/:key` | JWT + Admin |
| acls | `GET /acls`, `PUT /acls/role/:roleId`, `GET|PUT /users/:id/permissions` | JWT + Admin |

## Auth & Autorisierung (Architektur-Entscheidung)
- **Lesen ist öffentlich**: Das Wiki ist ohne Login lesbar (GET auf pages, categories,
  search, media-Auslieferung). Diese Routen tragen bewusst keine Guards.
- **Schreiben erfordert Auth**: Jede mutierende Route (POST/PATCH/PUT/DELETE) trägt
  `@UseGuards(JwtAuthGuard, RolesGuard)` und ein `@Roles(...)`.
  - Inhalte (pages, categories): `@Roles("admin", "editor")`
  - Verwaltung (users, settings, acls): `@Roles("admin")`
  - Medien: aktuell `@UseGuards(JwtAuthGuard)` (jeder eingeloggte User)
- **Autor niemals aus dem Body**: Beim Erstellen einer Seite kommt `authorId`
  ausschließlich aus dem JWT via `@CurrentUser()` und wird an den Service übergeben.
  `authorId` ist bewusst KEIN Feld von `CreatePageSchema`.
- **JWT-Secret ist Pflicht**: `getJwtSecret()` (common/config) wirft beim Start, wenn
  `JWT_SECRET` fehlt. Kein hartkodierter Fallback – die App startet lieber gar nicht,
  als mit einem bekannten Secret zu laufen.
- Rollen: `admin`, `editor`, `viewer` (siehe `@ad-wiki/shared-types` `UserRole`).

## DTOs & Validierung
- Zod-Schemas aus `@ad-wiki/shared-types` importieren (Single Source of Truth)
- DTO-Dateien re-exportieren nur Schema + `type X = z.infer<...>`
- NestJS `ZodValidationPipe` für die Validierung verwenden
- Kein class-validator, kein class-transformer → nur Zod
- `z.object` strippt unbekannte Felder – gefälschte Extra-Felder landen nie im Service

## Datenbank
- Zugriff NUR über `PrismaService`
- Kein raw SQL, immer Prisma Client (Ausnahme: FTS-Query im search-Modul)
- Queries mit select/include begrenzen (kein select *)
- Listen: Pagination mit skip + take, Standard: 20 pro Seite
- Schema-Änderungen ausschließlich per `npx prisma migrate dev`

## API-Design
- REST mit Prefix `/api/v1/`
- Response-Format einheitlich:
  - Erfolg: `{ success: true, data: ... }`
  - Liste:  `{ success: true, data: [...], meta: { total, page, perPage } }`
  - Fehler: `{ success: false, error: "Deutsche Fehlermeldung" }`
- HTTP-Status korrekt: 200, 201, 400, 401, 403, 404, 500
- Swagger unter `/api/docs` (aus main.ts); Schreibrouten mit `@ApiBearerAuth()`

## Fehlerbehandlung
- HttpException mit klarer deutscher Message
- Globaler Exception-Filter, keine Stack-Traces an den Client
- Kritische Änderungen sollen ins `audit_log` geschrieben werden (offener Punkt)

## Sicherheit
- Passwörter: bcrypt (Salt-Rounds im seed/Service)
- JWT für Auth; Access-Token 15min, Refresh-Token 7 Tage (rotierende, nur gehashte Session in DB)
- Input immer mit Zod validieren, nie dem Client vertrauen
- Rate-Limiting via `@nestjs/throttler` (global über APP_GUARD `AppThrottlerGuard`):
  - Global 100/min, konfigurierbar über `THROTTLE_TTL` / `THROTTLE_LIMIT` (.env)
  - Endpunkt-spezifisch per `@Throttle`: Login 5/min, Registrierung 3/min, Upload 10/min
  - Gezählt pro Benutzer (User-ID aus dem Bearer-Token), sonst pro IP
  - Bei Überschreitung: HTTP 429 mit deutscher Meldung
- FTS: GIN-Index `idx_pages_fts` auf `to_tsvector('german', title || ' ' || content)`
  (Migration `add_fts_gin_index`, manuelles Raw-SQL – Prisma kann GIN nicht generieren)
- Audit-Log: `GET /audit-logs` blättert Cursor-basiert `(createdAt, id)` statt Offset
- Offene Härtungspunkte (siehe /info.md): Refresh-Token-Rotation, restriktive CORS,
  Datei-Inhaltsprüfung, Security-Header

## Zukunft: Mobile App
- API so designen, dass iOS/Android dieselben Endpoints nutzen
- JWT-basiert (kein Cookie-only Auth), damit Mobile und Web gleich funktionieren
- Keine web-spezifischen Annahmen
