Erstelle saubere Commits und pushe zum Repository: $ARGUMENTS

Schritte:
1. git status – Was hat sich geändert?
2. git diff – Änderungen prüfen

3. Vor dem Commit checken:
   - Keine console.log übrig?
   - Keine any-Types?
   - Keine auskommentierten Code-Blöcke?
   - TypeScript kompiliert fehlerfrei?
   - Keine Secrets oder .env Werte im Code?

4. Änderungen logisch gruppieren:
   - Zusammengehörendes in einen Commit
   - Verschiedene Bereiche in separate Commits
   - z.B. DB-Migration ≠ Frontend-Komponente

5. Commits erstellen:
   - Format: typ(bereich): deutsche beschreibung
   - Typen: feat, fix, chore, docs, refactor, test
   - Beispiele:
     feat(sidebar): kollabierbare Navigation implementiert
     fix(auth): Token-Refresh bei abgelaufener Session
     chore(deps): Abhängigkeiten aktualisiert

6. git push origin [aktuelle-branch]

7. Zusammenfassung ausgeben:
   - Welche Commits erstellt
   - Welche Dateien betroffen
   - Welche Branch gepusht
