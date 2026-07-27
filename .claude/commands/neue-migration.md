Erstelle eine Prisma Migration für: $ARGUMENTS

Schritte:
1. Prisma Schema in prisma/schema.prisma anpassen
2. Prüfen: Ist die Änderung reversibel?
3. Ausführen: npx prisma migrate dev --name $ARGUMENTS
4. Prisma Client generieren: npx prisma generate
5. Zod-Schemas in packages/shared-types aktualisieren
6. Prüfen ob Frontend und Backend noch kompilieren
7. Commit: chore(db): migration $ARGUMENTS

Regeln:
- Kebab-case für Migration-Namen (z.B. add-user-permissions)
- Bei destruktiven Änderungen (Spalte löschen, Typ ändern) warnen
- Seed-Daten in prisma/seed.ts aktualisieren falls betroffen
