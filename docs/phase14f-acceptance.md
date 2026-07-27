# Phase 14F – Migrations- und Rechteabnahme

Stand: 24. Juli 2026

## Ergebnis

Die produktionsnahe Datenbankmigration, die automatisierte sowie live gegen die
gestartete Anwendung ausgeführte Rechte-Matrix und die Browser-Abnahme sind
erfolgreich. Phase 14F ist vollständig abgeschlossen.

## Isolierter Migrationslauf

Die Abnahme verwendete eine frische, temporäre PostgreSQL-18-Instanz auf einem
eigenen lokalen Port. Bestehende Entwicklungscontainer und persistente
Projekt-Volumes wurden nicht verwendet oder verändert.

Ausgeführt wurden:

```powershell
npx prisma migrate deploy
npx prisma migrate status
npx prisma db seed
```

Ergebnis:

- alle 31 Migrationen wurden in ihrer gespeicherten Reihenfolge angewendet
- `prisma migrate status` meldete „Database schema is up to date“
- der Seed wurde erfolgreich und ohne manuelle SQL-Änderung ausgeführt
- die vier Phase-14-Migrationen für Gruppen, Bereiche, aktivierte Inhaltstypen
  und Ressourcen-ACLs liefen auf PostgreSQL 18 fehlerfrei
- der offene Systembereich `Allgemein` wird durch Migration und Seed
  idempotent bereitgestellt

## Live-Rechte-Matrix

Der reproduzierbare Lauf befindet sich unter
`apps/api/test/phase14/live-acceptance.mts` und wird mit folgendem Befehl gegen
eine gestartete isolierte Anwendung ausgeführt:

```powershell
npm run test:phase14:acceptance --workspace=api
```

Der Lauf erzeugt ausschließlich temporäre Abnahmedaten und prüft:

1. Admin, Bereichsverwalter, lokaler Gruppenmanager, direkt freigegebener
   Benutzer und vollständig ausgeschlossener Benutzer.
2. Vererbte Gruppenfreigabe über Bereich, Kategorie und Ordner bis zur Seite.
3. Direkte Benutzerfreigabe sowie direktes Benutzerverbot gegenüber einer
   geerbten Gruppenfreigabe.
4. Globale Benutzerverbote als nicht durch Ressourcen-ACLs erweiterbare
   Obergrenze.
5. Verschleierten Direktzugriff ohne interne ID oder Titel in der
   Fehlerantwort.
6. Metadatenfilterung in globaler Suche und Knowledge Graph.
7. Identische Entscheidung beim Markdown-Einzelexport.
8. Beschränkung lokaler Gruppenmanager auf die eigene Gruppe und normale
   Mitglieder.
9. Sofortigen Rechteentzug nach Entfernen einer Gruppenmitgliedschaft und
   Wiederherstellung nach erneuter Aufnahme.

Der erfolgreiche Lauf meldete sieben zusammengefasste Prüfpunkte. Die
vollständige Regression umfasst zusätzlich 189 erfolgreiche Backend-, Rechte-,
Sicherheits-, Such-, MCP-, Backup- und Integrationstests.

## Während der Abnahme behobener Fehler

Der erste Live-Lauf fand eine nicht von den bisherigen Mock-Tests erfasste
Fehlerstelle in der globalen Suche: Wenn ein Benutzer für einen Inhaltstyp
keine erlaubte Ziel-ID besaß, wurde beim Aufbau der SQL-Abfrage
`Prisma.join([])` aufgerufen. Die Abfrage verwendet für leere ID-Mengen jetzt
eine sichere `AND FALSE`-Bedingung. Ein eigener Regressionstest deckt diesen
Fall dauerhaft ab.

## Visuelle Browser-Matrix

Die Oberfläche wurde mit folgenden Rollen und Erwartungen abgenommen:

| Konto | Erwartung |
| --- | --- |
| Admin | sieht und verwaltet den gesamten Abnahmebereich |
| Bereichsverwalter | sieht den Bereich und kann dessen freigegebene ACL-Funktionen verwenden |
| lokaler Gruppenmanager | sieht Gruppeninhalte, verwaltet aber nur normale Mitglieder der eigenen Gruppe |
| direkt freigegebener Benutzer | sieht ausschließlich die direkt erlaubte Seite |
| ausgeschlossener Benutzer | sieht weder Navigation, Suche, Graph noch Direktinhalt des Bereichs |

Am 24. Juli 2026 wurden die Administratoransicht, der vollständige Leitfaden
unter `/settings/setup#access` und die globale Gruppenverwaltung im verbundenen
Chrome-Browser kontrolliert. Der Projekteigentümer hat die übrigen
Frontend-Rollenfälle bereits manuell geprüft und bestätigt.

Der sofortige Gruppenentzug und die Wiederherstellung des Zugriffs wurden im
Live-Abnahmelauf gegen die gestartete Anwendung bestätigt. Die Weitergabe und
clientseitige Verarbeitung der typisierten WebSocket-Ereignisse ist zusätzlich
durch die automatisierte Regression abgedeckt.

## Abschluss

- 31 von 31 Migrationen erfolgreich
- Seed und Statusprüfung erfolgreich
- sieben zusammengefasste Live-Prüfpunkte erfolgreich
- 189 von 189 automatisierte Tests erfolgreich
- API- und Web-Produktionsbuild erfolgreich
- Browser- und manuelle Frontend-Abnahme erfolgreich

Phase 14F und damit Phase 14 wurden am 24. Juli 2026 abgeschlossen.
