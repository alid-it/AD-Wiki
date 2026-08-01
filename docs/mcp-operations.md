# MCP-Betriebshandbuch

Dieses Dokument beschreibt den produktiven Betrieb des AD-Wiki-MCP-Servers. Der öffentliche Streamable-HTTP-Endpunkt ist `/mcp`; REST, OAuth und Monitoring laufen im selben API-Prozess.

## Produktionsarchitektur

- Ein TLS-terminierender Reverse Proxy veröffentlicht Web und API ausschließlich über HTTPS.
- PostgreSQL speichert Benutzer, ACLs, OAuth-Clients, gehashte Codes, Refresh- und Access-Tokens sowie Audit-Einträge.
- Redis stellt gemeinsame atomare MCP-Rate-Limits für alle API-Instanzen bereit.
- Der MCP-Transport bleibt zustandslos. Mehrere API-Instanzen benötigen daher keine Session-Affinität.
- Microsoft-Graph-Tokens und MCP-OAuth-Tokens sind getrennte Vertrauensbereiche und werden niemals gegenseitig durchgereicht.

## Erforderliche Umgebung

Ausgangspunkt ist `apps/api/.env.example`. In Produktion müssen mindestens folgende Werte installationsspezifisch gesetzt werden:

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://USER:PASSWORD@postgres:5432/ad-wiki
REDIS_URL=redis://redis:6379
WEB_URL=https://wiki.example.de
CORS_ALLOWED_ORIGINS=https://wiki.example.de
TRUST_PROXY_HOPS=1
LOG_FORMAT=json
MONITORING_TOKEN=<separater-zufallswert>

MCP_PUBLIC_URL=https://wiki.example.de/mcp
MCP_ALLOWED_HOSTS=wiki.example.de
MCP_ALLOWED_ORIGINS=https://wiki.example.de
MCP_RATE_LIMIT_READ=120
MCP_RATE_LIMIT_WRITE=30
MCP_RATE_LIMIT_WINDOW_MS=60000
```

`MCP_PUBLIC_URL` ist die kanonische OAuth-Ressource und darf nach der Inbetriebnahme nicht ohne erneute Client-Autorisierung geändert werden. In Produktion werden HTTP, fehlende Host-/Origin-Allowlisten und fehlendes Redis beim Start abgelehnt.

Geheimnisse müssen aus einem Secret Store injiziert werden. Insbesondere `JWT_SECRET`, `MONITORING_TOKEN`, `MICROSOFT_CLIENT_SECRET` und `INTEGRATION_ENCRYPTION_KEY` gehören weder in Images noch in Git oder Logs.

## Bereitstellung

1. Abhängigkeiten mit `npm ci` installieren.
2. Prisma-Client mit `npx prisma generate` erzeugen.
3. Datenbankmigrationen mit `npx prisma migrate deploy` anwenden.
4. `npm run build` ausführen.
5. API und Web mit einem nicht privilegierten Betriebssystemkonto starten.
6. Reverse Proxy so konfigurieren, dass `Host`, `X-Forwarded-For` und `X-Forwarded-Proto` unverändert beziehungsweise korrekt gesetzt werden.
7. `TRUST_PROXY_HOPS` exakt auf die Anzahl vertrauenswürdiger Proxy-Hops setzen. Niemals pauschal allen Forwarded-Headern vertrauen.

Vor dem Freigeben des Traffics müssen `/api/v1/health/live` und `/api/v1/health/ready` erfolgreich sein. Ein fehlgeschlagener Readiness-Check entfernt die Instanz aus dem Load Balancer; ein fehlgeschlagener Liveness-Check darf einen Neustart auslösen.

## OAuth 2.1 und Discovery

Der Server implementiert Authorization Code mit PKCE `S256`, Resource Indicators, kurzlebige Access-Tokens, rotierende Refresh-Tokens mit Replay-Erkennung und Dynamic Client Registration für öffentliche Clients. Bei Wiederverwendung eines rotierten Refresh-Tokens wird dessen gesamte Token-Familie widerrufen. Client-Secrets werden nicht ausgegeben.

Öffentliche Endpunkte:

- `GET /.well-known/oauth-protected-resource/mcp`
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `POST /oauth/register`
- `GET /oauth/authorize`
- `POST /oauth/token`
- `POST /oauth/revoke`

Unautorisierte MCP-Anfragen liefern `401` mit einem `WWW-Authenticate`-Header, der auf die Protected Resource Metadata verweist. Access-Tokens werden bei jeder Anfrage auf Ablauf, Widerruf, aktiven Benutzer, aktuelle ACLs, OAuth-Scopes und die exakte MCP-Audience geprüft. Autorisierungscodes sind fünf Minuten gültig und nur einmal verwendbar. Refresh-Tokens werden bei jeder Verwendung rotiert.

## Clients

### Codex

Die geprüfte Vorlage liegt in `docs/mcp/codex-config.toml`. Alternativ:

```powershell
codex mcp add ad-wiki --url https://wiki.example.de/mcp
codex mcp login ad-wiki --scopes mcp:read,mcp:write
codex mcp get ad-wiki
```

Für reinen Lesezugriff wird nur `mcp:read` angefordert. `--oauth-resource` wird bewusst nicht gesetzt: Codex übernimmt die kanonische Resource aus der Protected Resource Metadata. Bei Codex CLI `0.145.0` kann eine zusätzlich konfigurierte Resource doppelt im Autorisierungsaufruf erscheinen und damit die Anmeldung verhindern. Die Syntax wurde mit Codex CLI `0.145.0` geprüft.

### Claude Code

Die geprüfte JSON-Vorlage liegt in `docs/mcp/claude-config.json`. Alternativ:

```powershell
claude mcp add --transport http ad-wiki https://wiki.example.de/mcp
claude mcp get ad-wiki
```

Danach in Claude Code `/mcp` öffnen und die Browser-Anmeldung starten. Die Syntax wurde mit Claude Code `2.1.205` geprüft.

Vor der Anmeldung zeigt `claude mcp get ad-wiki` bei funktionierender TLS-Verbindung `Needs authentication`. `Failed to connect` bedeutet dagegen, dass bereits Transport oder TLS scheitern. Selbstsignierte beziehungsweise intern ausgestellte Zertifikate müssen auf dem lokalen Rechner vertraut sein; die TLS-Prüfung darf nicht dauerhaft deaktiviert werden.

Persönliche `ad_wiki_mcp_...`-Bearer-Tokens bleiben für kontrollierte Automatisierung verfügbar. Sie gehören ausschließlich in Secret Stores oder Umgebungsvariablen und niemals direkt in gemeinsam versionierte Konfigurationen.

## Netzwerk- und Transportschutz

- Der `Host`-Header muss in `MCP_ALLOWED_HOSTS` enthalten sein.
- Ein vorhandener `Origin`-Header muss zu `MCP_ALLOWED_ORIGINS` gehören; ungültige Origins erhalten HTTP 403.
- Nicht-Browser-Clients dürfen den Origin-Header weglassen.
- Der MCP-Endpunkt akzeptiert Bearer-Tokens ausschließlich im `Authorization`-Header, nie in Query-Parametern.
- Antworten tragen `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` und `Referrer-Policy: no-referrer`.
- REST- und WebSocket-CORS verwenden `CORS_ALLOWED_ORIGINS`.

## Rate-Limits

Read- und Write-Tools besitzen getrennte Buckets pro MCP-Token. Standardwerte sind 120 Lese- und 30 Schreibanfragen pro Minute. Überschreitungen liefern HTTP 429 sowie `Retry-After`, `RateLimit-Limit` und `RateLimit-Remaining`.

In Entwicklung kann ein prozesslokaler Speicher verwendet werden. Produktion erfordert Redis, damit ein Client das Limit nicht durch Wechsel zwischen API-Instanzen umgehen kann. Ist ein konfiguriertes Redis nicht erreichbar, schlägt die Prüfung geschlossen mit HTTP 503 fehl.

## Monitoring und Logs

- `/api/v1/health/live`: Prozess lebt.
- `/api/v1/health/ready`: Datenbank ist erreichbar.
- `/api/v1/health/metrics`: Prometheus-Textformat; in Produktion nur mit `Authorization: Bearer <MONITORING_TOKEN>`.
- JSON-Logs enthalten Zeit, Level, Dienst, Kontext, Request-ID, Route, Status und Laufzeit.
- Request-Bodies, Inhalte, Passwörter, Cookies, Authorization-Header und Token werden nicht protokolliert beziehungsweise redigiert.

Empfohlene Alarme:

- Readiness länger als zwei Minuten fehlgeschlagen
- HTTP-5xx-Anteil über fünf Prozent für fünf Minuten
- gehäufte 401/403/429-Antworten
- Redis- oder Datenbankverbindungsfehler
- p95-Laufzeit des MCP-Endpunkts oberhalb des internen SLO

## Backup, Rotation und Wiederherstellung

- PostgreSQL täglich sichern und Wiederherstellung regelmäßig testen.
- Redis enthält nur kurzlebige Zähler und benötigt für MCP keine dauerhafte Sicherung.
- `INTEGRATION_ENCRYPTION_KEY` muss separat gesichert werden; ohne ihn können Microsoft-Token-Caches nicht entschlüsselt werden.
- Rotation von `JWT_SECRET` beendet bestehende Web-Sitzungen.
- Rotation oder Änderung der MCP-Ressourcen-URL erfordert eine neue OAuth-Autorisierung.
- Bei vermutetem MCP-Token-Abfluss Token in `/settings/mcp` widerrufen, Audit-Log prüfen und betroffene OAuth-Refresh-Tokens beziehungsweise Clients in der Datenbank sperren oder löschen.

## Prüfungen vor einem Release

```powershell
npx prisma validate
npm run test:mcp
npm run build
```

Zusätzlich müssen Discovery, OAuth-Anmeldung und ein Lese-Tool mit Codex sowie Claude gegen die echte HTTPS-Domain getestet werden. Lasttests werden zunächst gegen eine Staging-Umgebung mit produktionsgleichen Redis-/PostgreSQL-Ressourcen ausgeführt, niemals ungedrosselt gegen die Produktionsdatenbank.

## Fehleranalyse

- `401 Unauthorized`: Token fehlt, ist abgelaufen, widerrufen oder für eine andere Audience ausgestellt.
- `403 Forbidden host/origin`: Reverse-Proxy-Host oder Client-Origin fehlt in der Allowlist.
- `invalid_target`: `resource` stimmt nicht exakt mit `MCP_PUBLIC_URL` überein.
- `invalid_grant`: Code/Refresh-Token ist abgelaufen, wiederverwendet oder PKCE stimmt nicht.
- `429 Too many requests`: Client soll `Retry-After` beachten.
- `503 Rate-Limit-Speicher`: Redis-Verbindung und `REDIS_URL` prüfen.
