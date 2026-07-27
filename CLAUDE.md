# AD-Wiki – Projektregeln

## Projekt
Open-Source Wiki-Plattform. Modern, dynamisch, visuell ansprechend.
Monorepo mit npm Workspaces + Turborepo.
Entwicklung lokal auf Windows.
Repo: github.com/alid-it/ad-wiki-dev

Ziel: Web-App zuerst (V1), danach native iOS/Android Apps für die Stores.

## Tech Stack
- Runtime: Node.js 24
- Frontend: Next.js (App Router) + React + Tailwind CSS v4
- Backend: NestJS + TypeScript
- Datenbank: PostgreSQL (Docker Desktop)
- ORM: Prisma
- Cache: Redis (Docker Desktop)
- Validierung: Zod (shared packages)
- Paketmanager: npm (KEIN pnpm, KEIN yarn)
- Build: Turborepo

## Sprache & Code-Stil
- TypeScript strict mode, kein reines JavaScript
- Deutsche Kommentare und Commit-Messages
- Keine any-Types, immer korrekt typisieren
- Console.log vor Commit entfernen
- Imports: absolute Pfade, keine relativen ../../

## Datenbank – KRITISCH
- Schema-Änderungen AUSSCHLIESSLICH per Prisma Migration
- Befehl: npx prisma migrate dev --name beschreibung
- Jede Migration muss reversibel sein
- Seed-Daten in prisma/seed.ts pflegen
- NIE direkt SQL gegen die Datenbank ausführen
- NIE das Schema manuell in der DB ändern

## Validierung & Types
- Zod-Schemas in packages/shared-types = Single Source of Truth
- Frontend UND Backend importieren von dort
- Types niemals duplizieren
- Jedes API-Request/Response braucht ein Zod-Schema

## Git
- Commit-Format: typ(bereich): deutsche beschreibung
- Typen: feat, fix, chore, docs, refactor, test
- Beispiel: feat(sidebar): kollabierbare Navigation erstellt
- Kleine, fokussierte Commits statt Riesen-Commits
- Branch-Namen: feature/kurze-beschreibung

## Design & UI
- UI-Skill: ui-ux-pro-max (in .claude/skills/)
- Design-System: design-system/MASTER.md ist die Referenz
- Vor JEDER UI-Arbeit MASTER.md konsultieren
- Seitenspezifische Overrides in design-system/pages/ prüfen
- Grundsatz: Modern und dynamisch beim Navigieren,
  ruhig und fokussiert beim Lesen von Artikeln
- Mobile-first: jede Seite muss auf dem Handy funktionieren

## Architektur
- Pages: parent_id für Verschachtelung (Kategorie → Ordner → Seite)
- pages.type Enum: FOLDER vs PAGE (kein separater Ordner-Table)
- 14 Tabellen: users, roles, acls, user_permissions, categories,
  pages, page_versions, tags, tags_on_pages, media, sessions,
  audit_logs, settings, bookmarks
- user_permissions für individuelle Overrides über Rollen hinaus
- Code so strukturieren, dass spätere React Native App maximalen
  Code-Sharing nutzen kann (shared-types, api-client)

## Windows-Hinweise
- Pfade immer mit / nicht mit \
- Shell-Befehle für PowerShell kompatibel halten
- Docker Desktop für PostgreSQL und Redis
