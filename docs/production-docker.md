# AD-Wiki mit Docker betreiben

Dieses Setup startet PostgreSQL, Redis, Datenbankmigration und Bootstrap, API,
Next.js und nginx als gemeinsamen Produktions-Stack. Nur nginx veröffentlicht
einen Host-Port. PostgreSQL, Redis, API und Web bleiben in Docker-Netzwerken.

## 1. Konfiguration anlegen

```powershell
Copy-Item .env.production.example .env.production
```

Danach alle Domains, den ersten Administrator und sämtliche
`AD_WIKI_*`-Secrets in `.env.production` eintragen. Die echte Datei wird durch
`.gitignore` ausgeschlossen. In Git liegen nur die leeren Beispielwerte.

Für lokale Installationen kann `.env.production` auf dem Server liegen. In CI
werden dieselben `AD_WIKI_*`-Variablen aus dem Secret Store des CI-Systems
bereitgestellt. Compose überführt sie in Docker-Secrets unter `/run/secrets`;
die API liest sie erst beim Containerstart. Secrets werden damit weder in ein
Image eingebaut noch als Service-Umgebungsvariablen hinterlegt.

Wichtige Regeln:

- Für Produktion müssen `APP_ORIGIN` und `MCP_PUBLIC_URL` endgültige
  `https://`-Adressen sein.
- `MCP_ALLOWED_HOSTS` enthält nur Hostnamen, keine URL und keinen Pfad.
- `AD_WIKI_INTEGRATION_ENCRYPTION_KEY` besteht aus exakt 32 zufälligen Bytes
  in Base64. Der Schlüssel schützt Microsoft-Integrationsdaten und das in der
  Datenbank gespeicherte SMTP-Passwort. Er darf nicht ohne kontrollierte
  Neukonfiguration dieser Zugangsdaten ersetzt werden.
- `AD_WIKI_BACKUP_ENCRYPTION_KEY` besteht ebenfalls aus exakt 32 zufälligen
  Bytes in Base64 und darf keinen anderen Schlüssel wiederverwenden. Er wird
  ab Phase 11A ausschließlich für Zugangsdaten externer Backup-Ziele genutzt.
- Der erste Admin benötigt ein Passwort mit mindestens 12 Zeichen.
- Wenn Microsoft To Do deaktiviert ist, bleiben Tenant-/Client-ID leer. Für
  `AD_WIKI_MICROSOFT_CLIENT_SECRET` genügt dann ein separater Zufallswert, der
  nicht anderweitig verwendet wird.
- Die vollständige Entra-Konfiguration für parallel laufende Dev- und
  Prod-Umgebungen steht in [`docs/entra-setup.md`](entra-setup.md).

## 2. Konfiguration prüfen und Stack starten

```powershell
npm run docker:config
npm run docker:build
npm run docker:up
npm run docker:logs
npm run docker:rebuild
```

Vorhandene Container vollständig neu erstellen, ohne Datenvolumes zu löschen:

```powershell
npm run docker:rebuild
```

Der Befehl entfernt alte Container und verwaiste Netzwerke, baut die Images neu
und startet den Stack wieder. PostgreSQL, Redis, Uploads und TLS-Zertifikate
bleiben erhalten, weil bewusst kein `--volumes` verwendet wird.

Für versionierte Deployments werden die von GitHub Actions veröffentlichten
GHCR-Images verwendet. `AD_WIKI_IMAGE_TAG` wird dabei auf den konkreten
Release-Tag gesetzt und der Stack mit `pull` sowie `up --no-build` aktualisiert.
Der vollständige Release-, Deployment- und Rollback-Ablauf steht in
[`docs/ci-cd.md`](ci-cd.md).

nginx veröffentlicht standardmäßig Port 80 und 443. HTTP-Anfragen werden mit
Status 308 auf HTTPS umgeleitet. Für den direkten Zugriff müssen DNS sowie
Firewall beziehungsweise Router die öffentliche Domain auf diesen Host und die
Ports 80/443 führen.

### Eigenes TLS-Zertifikat

Die drei Pfade werden nur zur Laufzeit read-only in den TLS-Init-Container
eingebunden. Der private Schlüssel wird nicht in ein Image kopiert.

```env
TLS_DOMAIN=wiki.example.com
TLS_CERT_PATH=C:/certs/wiki.example.com.crt
TLS_KEY_PATH=C:/certs/wiki.example.com.key
TLS_CA_CHAIN_PATH=C:/certs/ca-chain.crt
HTTPS_BIND_ADDRESS=0.0.0.0
HTTPS_PORT=443
HTTP_BIND_ADDRESS=0.0.0.0
HTTP_PORT=80
```

Unter Windows sollten absolute Pfade mit `/` geschrieben werden. Zertifikat und
Schlüssel müssen gemeinsam gesetzt sein und kryptografisch zusammengehören.
Die CA-Chain ist optional; bei öffentlichen Zertifikaten sollte sie angegeben
werden, damit nginx eine vollständige Zertifikatskette ausliefert.

Sind `TLS_CERT_PATH` und `TLS_KEY_PATH` leer, erzeugt `tls-init` einmalig ein
selbstsigniertes Zertifikat für `TLS_DOMAIN`. Fehlt auch `TLS_DOMAIN`, wird der
erste Host aus `MCP_ALLOWED_HOSTS` verwendet. Das Zertifikat bleibt im Volume
`tls_data` erhalten und wird bei Folgestarts wiederverwendet. Selbstsignierte
Zertifikate verschlüsseln die Verbindung, sind aber ohne manuell eingerichtetes
Vertrauen nicht browser-vertrauenswürdig. Für öffentlichen Betrieb ist daher
ein Zertifikat von Let's Encrypt, einer internen PKI oder einer vergleichbaren
CA erforderlich.

Beim ersten Start führt `database-init` `prisma migrate deploy` aus und legt
anschließend idempotent Systemrollen, ACLs, Grundeinstellungen sowie den ersten
Admin an. Der Entwicklungs-Seed mit Demo-Daten und Testpasswort wird nicht
ausgeführt. Bei späteren Starts wird das bestehende Admin-Passwort nicht
überschrieben.

Der über `INITIAL_ADMIN_EMAIL` festgelegte erste Admin ist als geschütztes
Setup-Konto markiert. Andere Administratoren können seine Rolle, seinen
Aktiv-Status, individuelle Rechte oder sein Passwort nicht ändern. Seine
effektiven Adminrechte bleiben auch dann vollständig, wenn die globale
Admin-Rolle bearbeitet wird. Der Kontoinhaber kann das eigene Passwort weiterhin
im Profil ändern oder über den öffentlichen Passwort-Reset wiederherstellen.

### SMTP und Passwort-Wiederherstellung

Nach dem ersten Start konfiguriert ein Administrator unter
`Einstellungen → E-Mail (SMTP)` den SMTP-Host, Port, STARTTLS oder implizites
TLS, optionale Zugangsdaten und den Absender. Das SMTP-Passwort wird mit
`AD_WIKI_INTEGRATION_ENCRYPTION_KEY` per AES-256-GCM verschlüsselt gespeichert
und von der API nie wieder ausgegeben. Über „Test-E-Mail senden“ sollte die
Verbindung vor dem Aktivieren geprüft werden.

`PASSWORD_RESET_TTL_MINUTES` steuert die Gültigkeit eines Reset-Links und ist
standardmäßig `30` (zulässig: 5 bis 1440 Minuten). Die Link-Basis ist
`APP_ORIGIN`, die Compose als `WEB_URL` an die API weitergibt. Reset-Tokens
liegen ausschließlich als SHA-256-Hash in PostgreSQL, sind einmalig verwendbar
und beenden nach erfolgreicher Nutzung alle Sitzungen des Kontos.

Administratoren können unter `Einstellungen → Benutzer` zusätzlich einen
Reset-Link versenden oder das Passwort eines anderen Benutzers direkt setzen.
Benutzeranlage, Mailversand und administrative Passwortwechsel werden
auditiert; Passwörter und Reset-Tokens erscheinen nicht im Audit-Log.

## 3. Status und Logs

```powershell
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api web nginx
curl.exe --insecure https://127.0.0.1/api/v1/health/ready
```

`--insecure` ist nur für das selbstsignierte Fallback gedacht. Bei
einem öffentlich vertrauenswürdigen Zertifikat wird die Domain ohne diese
Option geprüft:

```powershell
Invoke-RestMethod https://wiki.example.com/api/v1/health/ready
```

Die API schreibt in Produktion strukturierte JSON-Logs nach stdout. Docker oder
die spätere Monitoring-Plattform übernimmt Rotation und Versand. Der
Prometheus-Endpunkt `/api/v1/health/metrics` verlangt den Wert aus
`AD_WIKI_MONITORING_TOKEN` als Bearer-Token.

AD-Wiki startet bewusst keinen eigenen Monitoring-Stack. Das importierbare
Grafana-Dashboard, Prometheus-Regeln sowie Beispiele für Alertmanager und Zabbix
werden auf einer vorhandenen externen Monitoring-VM eingerichtet. Anbindung und
Alarmtest sind in [monitoring.md](monitoring.md) beschrieben.

## 4. MCP durch nginx testen

Die öffentliche MCP-Adresse lautet `${APP_ORIGIN}/mcp`. Nach der Anmeldung kann
im Profil ein MCP-Token erstellt und beispielsweise mit dem vorhandenen
MCP-Testskript oder einem Codex-MCP-Eintrag geprüft werden. OAuth-Metadaten unter
`/.well-known/` sowie `/oauth/` und der Streamable-HTTP-Endpunkt `/mcp` werden
von nginx an die API weitergeleitet. Für lang laufende MCP-Verbindungen ist
Proxy-Buffering deaktiviert.

Ein echter Produktions-MCP-Test erfolgt über die endgültige HTTPS-Domain, weil
die API im Produktionsmodus absichtlich keine öffentliche HTTP-MCP-URL akzeptiert.

## 5. Stoppen

```powershell
npm run docker:down
```

Die benannten Volumes bleiben erhalten. Ein Löschen mit `down --volumes` würde
Datenbank, Redis-Daten und Uploads entfernen und gehört nicht zum normalen
Betriebsablauf.

## 6. Backup und Restore

Der Produktions-Stack enthält einen separaten `backup-worker` sowie den nur über
das Profil `operations` startbaren Dienst `backup-restore`. Beide verwenden ein
eigenes Image mit Node.js 24 und PostgreSQL-18-Client und besitzen keinen
Docker-Socket.

Vor dem ersten Start `BACKUP_LOCAL_PATH`, optional `BACKUP_NETWORK_PATH`,
`BACKUP_UID`, `BACKUP_GID` und `AD_WIKI_BACKUP_ENCRYPTION_KEY` in
`.env.production` konfigurieren. Der komplette
Ablauf für manuellen Start, Artefaktprüfung, Dry-Run und Offline-Restore steht in
[`docs/backup-restore.md`](backup-restore.md).

## 7. Sichere Datei-Uploads

Die API akzeptiert ausschließlich JPEG, PNG, GIF, WebP, PDF und Markdown bis
10 MB. Die Dateiendung dient nur als Vorfilter. Nach dem Speichern prüft die API
die tatsächliche Dateisignatur beziehungsweise bei Markdown gültiges UTF-8 und
speichert ausschließlich den serverseitig ermittelten MIME-Typ. Stimmen Inhalt
und Endung nicht überein, wird die Datei verworfen und sofort gelöscht.

SVG und SVGZ sind deaktiviert. Das gilt auch für bereits vorhandene Dateien:
Vor jeder Auslieferung wird die Inhaltsprüfung erneut ausgeführt. Unsichere oder
manipulierte Bestandsdateien werden nicht gestreamt. Zusätzlich liefert die API
Mediendateien mit `X-Content-Type-Options: nosniff` aus.

## 8. Sichere Fehlerantworten und Datenbankabfragen

REST-Fehler werden zentral in ein kontrolliertes Antwortformat übersetzt. Zod-,
Prisma-, PostgreSQL-, Stack- und Framework-Texte werden niemals an Browser oder
API-Clients weitergegeben. Erwartbare Fehler enthalten eine bewusst formulierte
Meldung und einen stabilen Fehlercode; unerwartete interne Fehler werden nur
serverseitig protokolliert und nach außen neutral beantwortet.

Der Login begrenzt Eingabelängen, validiert die vollständige Anfrage und nutzt
für vorhandene wie unbekannte Konten einen bcrypt-Vergleich. Die Fehlermeldung
verrät nicht, ob eine E-Mail-Adresse existiert. Datenbankzugriffe erfolgen über
Prisma-Filterobjekte oder parametrisierte `Prisma.sql`-Templates. Unsichere
Raw-Methoden wie `$queryRawUnsafe`, `$executeRawUnsafe` und `Prisma.raw` sind im
API-Quellcode untersagt und werden automatisiert geprüft.
