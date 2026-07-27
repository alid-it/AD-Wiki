# Backup und Restore betreiben

Phase 11B bis 11E sichern PostgreSQL und das Upload-Volume in einem isolierten
Operations-Container. Der dauerhafte Worker besitzt keinen Docker-Socket, keine
veröffentlichten Ports und keine Linux-Capabilities. Zeitplanung, Aufbewahrung
und Bedienung erfolgen über AD-Wiki. Als Ziele stehen vorkonfigurierte lokale
oder Netzwerk-Mounts, SFTP und S3-kompatibler Speicher bereit.

## 1. Host-Pfade vorbereiten

In `.env.production` müssen zusätzlich zu den allgemeinen Produktionswerten
folgende Werte gesetzt sein:

```env
BACKUP_LOCAL_PATH=./backups
BACKUP_NETWORK_PATH=/mnt/ad-wiki-backups
BACKUP_UID=1000
BACKUP_GID=1000
BACKUP_POLL_INTERVAL_MS=2000
AD_WIKI_BACKUP_ENCRYPTION_KEY=<32-zufällige-Bytes-als-Base64>
```

Den Verschlüsselungsschlüssel unter PowerShell erzeugen:

```powershell
$bytes = [byte[]]::new(32)
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
[Convert]::ToBase64String($bytes)
```

Der Schlüssel schützt Zugangsdaten der Remote-Ziele. Er muss unabhängig
von JWT-, Datenbank- und Integrationsschlüsseln gesichert werden.

Der Stack enthält den einmaligen Dienst `backup-storage-init`. Er erstellt beim
Stackstart automatisch `BACKUP_LOCAL_PATH`, `.staging` und `restore` und setzt
die Verzeichnisse auf `BACKUP_UID:BACKUP_GID` mit Modus `0750`. Dadurch bleibt
der dauerhafte `backup-worker` unprivilegiert, kann aber auch in einem von Docker
zunächst als `root:root` angelegten Bind-Mount schreiben.

Der Zielordner kann unter Windows optional schon vor dem Stackstart erstellt
werden:

```powershell
New-Item -ItemType Directory -Path backups -Force
```

Auf Linux bereitet `backup-storage-init` den lokalen Pfad automatisch vor. Die
durch `BACKUP_UID` und `BACKUP_GID` bezeichnete numerische Kennung muss jedoch
weiterhin Schreibzugriff auf einen extern eingehängten
`BACKUP_NETWORK_PATH` besitzen. Der Standard ist UID/GID 1000. Die Pfade werden
nur an die fest konfigurierten Container-Ziele eingebunden; freie Hostpfade aus
API-Anfragen werden nicht akzeptiert. Unter Windows müssen Host-Pfade mit
Vorwärtsschrägstrichen angegeben werden, zum Beispiel `D:/Backups`.

## 2. Worker starten

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build backup-worker
docker compose --env-file .env.production -f docker-compose.prod.yml logs backup-storage-init
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backup-worker
```

Uploads sind im Worker read-only eingebunden. Das Datenbankpasswort kommt als
Docker-Secret und wird `pg_dump` ausschließlich über die Prozessumgebung
übergeben, nicht als Kommandozeilenargument.

Nach erfolgreichem Start zeigt `docker compose ... ps` den Init-Dienst mit
`Exited (0)` und den Worker als `healthy`. Bei `Exited (1)` zeigen die
Init-Logs, ob das Host-Dateisystem `chown` oder `chmod` verweigert hat. Nach
einem manuellen Austausch des lokalen Backup-Verzeichnisses kann die
Vorbereitung gezielt erneut ausgeführt werden:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backup-storage-init
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate backup-worker
```

## 3. Backups in der Admin-Oberfläche einrichten

Mit einem Konto mit `backups:read` die Seite `/settings/backups` öffnen. Für
Änderungen beziehungsweise manuelle Läufe sind zusätzlich die passenden
`create`, `update`, `delete` und `run`-Rechte erforderlich.

1. Unter **Speicherziele** ein Ziel anlegen. Für Host-Speicher den Typ
   **Vorkonfigurierter Mount** und anschließend `local` oder `network` auswählen.
   Remote-Ziele speichern Zugangsdaten ausschließlich verschlüsselt.
2. Bei jedem Ziel **Verbindung testen** ausführen. SFTP und S3 können erst nach
   einem erfolgreichen Test für einen aktiven Zeitplan verwendet werden.
3. Uhrzeit, IANA-Zeitzone und mindestens einen Wochentag auswählen. Freie
   Cron-Ausdrücke werden nicht akzeptiert.
4. Tages-, Wochen- und Monatsstände festlegen und den Plan aktivieren.
5. Den berechneten nächsten Lauf prüfen oder **Jetzt sichern** verwenden.

Die Statuskarten und die Jobhistorie werden automatisch aktualisiert. Sie zeigen
letzten Erfolg, nächsten Lauf, Größe, Dauer, Artefaktverfügbarkeit und redigierte
Fehlertexte. Deutsch und Englisch werden über die normale AD-Wiki-Spracheinstellung
unterstützt.

## 4. Externe Speicherziele

### SFTP

- SSH-Benutzer, Basispfad und privaten Schlüssel oder Passwort hinterlegen.
- Den SHA-256-Fingerprint des Server-Host-Keys zwingend als
  `SHA256:<Base64>` oder als 64-stelligen Hexwert eintragen.
- Der Worker lehnt die Verbindung bei jeder Abweichung ab. Ein automatisches
  Akzeptieren unbekannter Host-Keys gibt es nicht.

### S3-kompatibler Objektspeicher

- Nur einen HTTPS-Endpunkt verwenden und Region, Bucket und optional ein Präfix
  angeben. Path-Style nur aktivieren, wenn der Anbieter es benötigt.
- Access Key und Secret Key müssen auf den vorgesehenen Bucket beziehungsweise
  das Präfix beschränkt sein.
- SSE-S3 mit AES-256 ist Standard. Für SSE-KMS zusätzlich die KMS-Schlüssel-ID
  eintragen. Unverschlüsselte Uploads werden nicht angeboten.

### Vorkonfigurierter Netzwerk-Mount

AD-Wiki mountet Netzwerkfreigaben bewusst nicht selbst. Der Betreiber bindet
die Freigabe auf dem Docker-Host ein und setzt `BACKUP_NETWORK_PATH` auf diesen
Pfad. Compose stellt ihn dem Worker als Mount `network` bereit. Dadurch benötigt
der Container weder `SYS_ADMIN` noch privilegierten Zugriff oder Zugangsdaten
für den Mount-Vorgang. Auf Linux müssen `BACKUP_UID` und `BACKUP_GID` dort lesen,
schreiben, umbenennen und löschen dürfen.

Der asynchrone Verbindungstest schreibt zufällige Daten, liest sie zurück,
vergleicht die Prüfsumme und entfernt die Testdatei. Backups werden zunächst
unter einem temporären Namen hochgeladen und erst nach Größen- und
Prüfsummenprüfung veröffentlicht. Fehler unterscheiden unter anderem
Erreichbarkeit, Authentifizierung, TLS, Speicherplatz und Prüfsummenabweichung;
Zugangsdaten erscheinen weder in Antworten, Auditdetails noch Fehlertexten.

## 5. Geführte Restore-Vorbereitung

Unter **Einstellungen > Backups > Wiederherstellungs-Assistent** einen
verfügbaren Wiederherstellungspunkt auswählen und **Vorprüfung starten**. Das
funktioniert für vorkonfigurierte Mount-, SFTP- und S3-Backups. Externe
Artefakte werden dabei in `local/restore` geladen; bereits eingebundene lokale
oder Netzwerk-Backups werden direkt auf ihrem freigegebenen Mount geprüft.

Die Vorprüfung verändert weder Datenbank noch Uploads und kontrolliert:

- Manifest, Backup-ID und sämtliche SHA-256-Prüfsummen,
- Lesbarkeit des PostgreSQL-Custom-Dumps,
- Lesbarkeit, Pfade und Dateitypen des Upload-Archivs,
- unterstützte Formatversion und benötigte Konfiguration,
- freien Speicher für Restore-Kopie, Staging und Upload-Volume.

Nach erfolgreicher Prüfung zeigt **Assistent öffnen** alle Resultate und ein
sechsstufiges Runbook. Jeder Befehl kann einzeln kopiert oder das vollständige
Runbook als Markdown heruntergeladen werden. Das destruktive Restore-Kommando
bleibt verborgen, bis der Admin ausdrücklich bestätigt, dass Datenbank und
Uploads ersetzt werden. Die Web-App führt keinen Restore-Befehl selbst aus.

## 6. Alternative Bedienung per REST API

Für Automatisierung stehen weiterhin die geschützten REST-Endpunkte zur
Verfügung. Das Konto benötigt die jeweiligen `backups`-ACLs.

```http
POST /api/v1/backups/destinations
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "name": "Lokales Backup",
  "isEnabled": true,
  "settings": {
    "type": "local",
    "config": {
      "mountName": "local",
      "subdirectory": "daily"
    }
  }
}
```

Danach mit der zurückgegebenen Ziel-ID starten:

```http
POST /api/v1/backups/jobs
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "destinationId": "<uuid>"
}
```

Status und letzte Aufträge:

```http
GET /api/v1/backups/jobs/<job-id>
GET /api/v1/backups/jobs
GET /api/v1/backups/overview
```

Verbindungstest, Restore-Vorprüfung und fertiges Runbook:

```http
POST /api/v1/backups/destinations/<ziel-id>/test
POST /api/v1/backups/jobs/<backup-job-id>/restore-preflight
GET  /api/v1/backups/jobs/<preflight-job-id>/restore-runbook
```

Ein Ziel nimmt zur selben Zeit höchstens einen Auftrag in den Status `queued`
oder `running` auf. Dauer lässt sich aus `startedAt` und `finishedAt` bestimmen;
erfolgreiche Jobs enthalten außerdem Größe und SHA-256-Prüfsumme.

## 7. Zeitplanung, Schreibschutz und Aufbewahrung

- Jede API-Instanz prüft Zeitpläne alle 30 Sekunden. Ein Redis-Lock und die
  eindeutige Kombination aus Plan und Fälligkeitszeit verhindern doppelte Jobs.
- Die Berechnung erfolgt in der gespeicherten IANA-Zeitzone. Nicht existente
  Minuten beim Wechsel zur Sommerzeit werden übersprungen; doppelte lokale
  Minuten beim Wechsel zur Winterzeit laufen nur einmal.
- Vor `pg_dump` und Upload-Archiv setzt der Worker eine Redis-Schreibbarriere,
  wartet auf laufende Mutationen und gibt sie in einem `finally`-Block wieder
  frei. GET-/HEAD-/OPTIONS- und lesende MCP-Aufrufe bleiben verfügbar. Neue
  Mutationen erhalten kurzzeitig HTTP 503 und können wiederholt werden.
- Die GFS-Aufbewahrung behält die Vereinigung der neuesten Tages-, Wochen- und
  Monatsstände. Ein Artefakt wird nur entfernt, wenn Status, Manifest, Backup-ID
  und alle Prüfsummen vorher erfolgreich verifiziert wurden. Der Job bleibt als
  Historieneintrag erhalten und wird als nicht mehr verfügbar angezeigt.

Start, Erfolg, Fehlschlag, Aufbewahrungslöschung und jede Konfigurationsänderung
werden auditiert. Neue Fehlschläge erscheinen als Admin-Benachrichtigung und als
persistente Warnung auf der Backup-Seite.

## 8. Backupformat

Jedes veröffentlichte Backup ist ein unveränderliches Verzeichnis:

```text
ad-wiki-<utc-zeitstempel>-<job-id>/
  database.dump
  uploads.tar.gz
  manifest.json
  SHA256SUMS
```

- `database.dump` ist ein PostgreSQL-Custom-Dump.
- `uploads.tar.gz` enthält das read-only gelesene Upload-Volume.
- `manifest.json` beschreibt Format, Backup-ID, Erstellungszeit, Größen und Hashes.
- `SHA256SUMS` schützt Dump, Upload-Archiv und Manifest.

Während der Erstellung endet der Verzeichnisname auf `.partial`. Erst nach
vollständiger Prüfung wird es auf demselben Dateisystem atomar umbenannt.
`.partial`-Verzeichnisse und manipulierte Dateien werden vom Restore abgelehnt.

## 9. Restore immer zuerst als Dry-Run prüfen

Den relativen Pfad unter `BACKUP_LOCAL_PATH` verwenden, niemals einen freien
absoluten Hostpfad:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml --profile operations run --rm backup-restore restore --mount local --backup daily/ad-wiki-<zeit>-<job-id> --dry-run
```

Der Dry-Run prüft:

- alle SHA-256-Prüfsummen und das Manifest,
- die Lesbarkeit des PostgreSQL-Custom-Dumps,
- die Lesbarkeit und sicheren Pfade des Upload-Archivs,
- dass kein `.partial`-Verzeichnis verwendet wird.

Er verändert weder PostgreSQL noch das Upload-Volume.

## 10. Vollständigen Restore durchführen

> **Warnung:** Der folgende Ablauf ersetzt Datenbank und Uploads. Vorher immer
> einen Dry-Run durchführen und sicherstellen, dass das richtige Deployment
> sowie die richtige Backup-ID ausgewählt sind.

Schreibende Dienste stoppen; PostgreSQL bleibt für `pg_restore` aktiv:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml stop nginx web api backup-worker
```

Restore mit der exakten `backupId` aus `manifest.json` bestätigen:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml --profile operations run --rm backup-restore restore --mount local --backup daily/ad-wiki-<zeit>-<job-id> --confirm <backup-id>
```

Der Operations-Container führt in dieser Reihenfolge aus:

1. Integritäts- und Archivprüfung
2. Entpacken der Uploads in ein isoliertes Staging-Verzeichnis
3. `pg_restore --clean --if-exists` ohne Owner und Privilegien
4. Austausch des Upload-Inhalts
5. `prisma migrate deploy` für Backups mit älterem Schema
6. Rückgabe des Upload-Volumes an `BACKUP_UID` und `BACKUP_GID`

Danach den Stack wieder starten und prüfen:

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl --fail --silent --show-error --insecure https://127.0.0.1/api/v1/health/ready
```

Zusätzlich Login, Rechte, Wiki-Seiten, Notizen, Standards und Medien fachlich
prüfen. Dry-Run, Erfolg und Fehlschlag werden als `backup_restore.*` mit Beginn,
Ende und Dauer im Audit-Log protokolliert. Bei einem fehlgeschlagenen Restore
bleibt der Fehlercode dort eindeutig sichtbar; den Stack nicht ungeprüft wieder
freigeben. RPO und RTO müssen anschließend in einem isolierten Test-Stack mit
einem echten Offsite-Backup gemessen und dokumentiert werden.

## 11. Monitoring

Der geschützte Prometheus-Endpunkt `/api/v1/health/metrics` liefert zusätzlich:

- `ad_wiki_backup_failures_total`
- `ad_wiki_backup_available_artifacts`
- `ad_wiki_backup_active_jobs`
- `ad_wiki_backup_last_success_timestamp_seconds`
- `ad_wiki_backup_last_success_age_seconds`
- `ad_wiki_backup_last_duration_seconds`
- `ad_wiki_backup_last_size_bytes`

Der Monitoring-Token wird wie bisher als Bearer-Token übergeben. Konkrete
Alarmgrenzen für das zulässige Alter des letzten erfolgreichen Backups werden in
Phase 11F passend zum dokumentierten RPO festgelegt.

## 12. Sicherheits- und Betriebsregeln

- Backups enthalten Kennwort-Hashes, Inhalte und potenziell vertrauliche Medien.
- `BACKUP_LOCAL_PATH` außerhalb des öffentlich ausgelieferten Webroots ablegen.
- Den Backupordner nicht mit dem Projekt veröffentlichen oder in Git aufnehmen.
- Mindestens eine verschlüsselte Offsite-Kopie auf SFTP, S3 oder einem getrennten Netzwerk-Mount einrichten.
- Restore regelmäßig in einem separat benannten Test-Stack üben.
- Redis, TLS-Dateien und Docker-Secrets sind bewusst kein Bestandteil dieses Datenbackups.
- Niemals `prisma migrate dev` oder den Development-Seed im Produktions-Restore verwenden.
