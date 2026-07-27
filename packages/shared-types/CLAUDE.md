# Shared Types – Regeln

## Zweck
Single Source of Truth für alle Typen und Validierung.
Frontend, Backend und zukünftige Mobile App importieren NUR von hier.

## Aufbau
- Ein File pro Domäne:
  src/
  ├── user.ts
  ├── page.ts
  ├── auth.ts
  ├── category.ts
  ├── tag.ts
  ├── media.ts
  ├── settings.ts
  └── index.ts       → Re-export alles

## Jedes File exportiert
1. Zod-Schema (z.B. export const pageSchema = z.object({...}))
2. TypeScript Type (z.B. export type Page = z.infer<typeof pageSchema>)
3. Create/Update Input-Schemas
4. API Response-Schemas

## Regeln
- Keine Abhängigkeiten zu Frontend oder Backend
- Nur Zod und TypeScript, keine Runtime-Logik
- Keine UI-Komponenten, keine NestJS-Decorator
- Änderung hier → Frontend UND Backend prüfen
