# CI/CD, Releases und Rollback

AD-Wiki verwendet ein einziges öffentliches Quellcode-Repository. Reale
`.env`-Dateien, TLS-Schlüssel und andere Secrets werden nicht versioniert. Die
GitHub Actions prüfen den Quellcode und veröffentlichen unveränderliche
Produktionsimages in der GitHub Container Registry (GHCR). Die Produktions-VM
enthält nur ihre lokale `.env.production`, Zertifikate, Volumes und
Backup-Mounts.

## 1. Workflows

### CI

`.github/workflows/ci.yml` läuft bei Pull Requests, Pushes auf `main`, manuellen
Starts und als wiederverwendbarer Workflow vor einem Release. Die Pipeline:

1. scannt die vollständige Git-Historie mit Gitleaks,
2. installiert ausschließlich aus `package-lock.json`,
3. validiert das Prisma-Schema und generiert den Prisma Client,
4. wendet alle Migrationen auf eine leere PostgreSQL-18-Datenbank an,
5. baut das TypeScript-Monorepo,
6. führt die automatisierten Tests aus,
7. validiert Compose mit `.env.production.example` und
8. baut alle Produktionsimages.

Pull Requests dürfen erst nach erfolgreicher CI in `main` übernommen werden.

### Container-Release

`.github/workflows/release.yml` reagiert auf Tags im Format `v*.*.*`. Vor der
Veröffentlichung wird die komplette CI erneut ausgeführt. Danach entstehen
folgende Linux/AMD64-Images:

```text
ghcr.io/alid-it/ad-wiki-api:<tag>
ghcr.io/alid-it/ad-wiki-database-init:<tag>
ghcr.io/alid-it/ad-wiki-backup:<tag>
ghcr.io/alid-it/ad-wiki-web:<tag>
ghcr.io/alid-it/ad-wiki-nginx:<tag>
ghcr.io/alid-it/ad-wiki-tls-init:<tag>
```

Jedes Image erhält zusätzlich einen unveränderlichen `sha-<commit>`-Tag,
Provenance und eine SBOM. Ein stabiler Tag ohne Bindestrich aktualisiert auch
`latest`; Deployments verwenden trotzdem immer den konkreten Versionstag.
Das Web-Image verwendet `/api/v1` auf derselben öffentlichen Domain und ist
dadurch unabhängig von der Domain der jeweiligen Installation.

## 2. GitHub einmalig konfigurieren

1. Unter `Settings → Actions → General` GitHub Actions aktivieren und dem
   `GITHUB_TOKEN` das Veröffentlichen von Packages erlauben. Der Workflow
   beschränkt seine Rechte selbst auf `contents: read` und `packages: write`.
2. Nach dem ersten Release unter dem jeweiligen GHCR-Package die gewünschte
   Sichtbarkeit einstellen. Öffentliche Images können ohne Registry-Login
   heruntergeladen werden.
3. Für `main` eine Branch-Protection beziehungsweise ein Ruleset anlegen:
   Pull Request, erfolgreiche CI und keine erzwungenen Pushes.
4. In GitHub Secret Scanning und Push Protection aktivieren, soweit für das
   Repository verfügbar.

Ein Docker-Hub-Konto ist für diesen Ablauf nicht erforderlich. Eine spätere
Spiegelung nach Docker Hub kann als getrennter Release-Job ergänzt werden.

## 3. Release erstellen

Der Arbeitsbaum muss sauber und `main` aktuell sein. Anschließend:

```powershell
git tag -a v1.0.0 -m "AD-Wiki v1.0.0"
git push origin v1.0.0
```

Der Tag wird erst veröffentlicht, wenn die gewünschte Version zuvor nach
`main` gepusht wurde. Der Workflow zeigt unter `Actions → Container-Release`
den Status aller sechs Images. Nach erfolgreicher Veröffentlichung erstellt er
außerdem ein GitHub Release mit:

```text
docker-compose.yml
env.production.example
SHA256SUMS
```

## 4. Deployment aus GHCR

Für eine neue Installation werden nur die beiden Deployment-Dateien des
gewünschten Releases benötigt:

```bash
mkdir ad-wiki
cd ad-wiki
curl --fail --location --remote-name \
  https://github.com/alid-it/AD-Wiki/releases/latest/download/docker-compose.yml
curl --fail --location --remote-name \
  https://github.com/alid-it/AD-Wiki/releases/latest/download/env.production.example
cp env.production.example .env
nano .env
docker compose config --quiet
docker compose up -d
docker compose ps -a
```

`database-init` führt vor dem API-Start `prisma migrate deploy` und den
idempotenten Bootstrap aus. Compose lädt die fest eingetragene Release-Version
automatisch aus GHCR. Abschließend:

```bash
curl --fail https://wiki.danakiran.de/api/v1/health/ready
```

Wenn die Packages privat bleiben, meldet sich die VM einmalig mit einem
dedizierten GitHub-Token mit ausschließlich `read:packages` an:

```bash
docker login ghcr.io --username alid-it
```

Das Token wird interaktiv als Passwort eingegeben und nicht in Shell-Historie
oder `.env.production` gespeichert.

## 5. Rollback

Vor jedem Deployment werden bisheriger `AD_WIKI_IMAGE_TAG`, Datenbank-Backup
und Zeitpunkt notiert. Ist die neue Migration mit der vorherigen Anwendung
rückwärtskompatibel, genügt ein Image-Rollback:

```env
AD_WIKI_IMAGE_TAG=v0.9.0
AD_WIKI_VERSION=0.9.0
```

```bash
sudo docker compose \
  --env-file .env.production \
  --file docker-compose.prod.yml \
  pull

sudo docker compose \
  --env-file .env.production \
  --file docker-compose.prod.yml \
  up -d --no-build --remove-orphans
```

Danach werden Containerstatus, Readiness, Login und ein Lese-/Schreibvorgang
geprüft. Bei einer nicht rückwärtskompatiblen Datenbankmigration darf nicht nur
das alte Image gestartet werden. Dann wird der dokumentierte
migrationsspezifische Rollback verwendet oder der unmittelbar vor dem Release
erstellte vollständige Stand über den Restore-Ablauf wiederhergestellt. Direkte
manuelle Schemaänderungen in PostgreSQL bleiben verboten.

## 6. Fehlerfall während eines Releases

- Schlägt CI fehl, werden keine Images veröffentlicht.
- Schlägt nur ein Matrix-Build fehl, gilt der gesamte Release als
  fehlgeschlagen; der Tag wird nicht deployt.
- Schlägt `database-init` fehl, bleiben API, Web und nginx durch ihre
  Abhängigkeiten gestoppt. Zuerst die Init-Logs prüfen und nicht wiederholt
  unkontrolliert neu starten.
- Ein abgebrochener Release-Tag wird nicht verschoben. Die Korrektur erhält
  eine neue Patchversion, beispielsweise `v1.0.1`.
