# AD-Wiki per MCP mit Claude Code verbinden

Diese Anleitung beschreibt die lokale Windows-Einrichtung von Claude Code für die beiden parallel nutzbaren AD-Wiki-MCP-Endpunkte:

```text
Entwicklung: http://localhost:4000/mcp
Docker/Prod: https://wiki.playground.local/mcp
```

`http://localhost:3000` ist nur das Entwicklungs-Frontend. Der lokale MCP-Server
liegt direkt an der API auf Port 4000.

## Veralteten Claude-Eintrag korrigieren

Wenn `claude mcp get ad-wiki` noch `https://wiki.danakiran.de/mcp` anzeigt,
verbindet sich Claude mit der alten OAuth-Ressource. Neue Zugangsdaten für diese
Ressource können nicht für `wiki.playground.local` verwendet werden. Den alten
Eintrag deshalb entfernen und Dev sowie Prod unter getrennten Namen anlegen:

```powershell
claude mcp remove ad-wiki
claude mcp add --transport http ad-wiki-dev http://localhost:4000/mcp
claude mcp add --transport http ad-wiki-prod https://wiki.playground.local/mcp
claude mcp get ad-wiki-dev
claude mcp get ad-wiki-prod
```

Danach Claude Code vollständig beenden und neu starten. In `/mcp` bei beiden
Einträgen gegebenenfalls `Clear authentication` wählen und die Anmeldung neu
starten. Getrennte Namen verhindern, dass zwischengespeicherte OAuth-Daten der
einen Umgebung für die andere Umgebung wiederverwendet werden.

## Ursache des Zertifikatsfehlers

Der produktive Docker-Stack erzeugt ein selbstsigniertes Fallback-Zertifikat, wenn in `.env.production` kein öffentlich vertrauenswürdiges TLS-Zertifikat konfiguriert ist. Claude Code meldet dann beispielsweise:

```text
UNABLE_TO_VERIFY_LEAF_SIGNATURE
unable to verify the first certificate
```

Die TLS-Verbindung scheitert dabei vor der MCP- beziehungsweise OAuth-Anmeldung. `Auth: not authenticated` ist deshalb zunächst nur eine Folge des Zertifikatsfehlers.

## Voraussetzungen

- Windows PowerShell
- laufender produktiver Docker-Stack
- Claude Code ist installiert
- das Arbeitsverzeichnis ist `C:\Projekte\ad-wiki`

Version und MCP-Konfiguration können so geprüft werden:

```powershell
claude --version
claude mcp get ad-wiki
```

## Variante A: Zertifikat unter Windows vertrauen

Diese Variante ist für ein internes Netzwerk der empfohlene Workaround. Die vollständige TLS-Prüfung bleibt aktiv; Windows vertraut lediglich dem konkreten selbstsignierten AD-Wiki-Zertifikat.

### 1. Zertifikat aus dem nginx-Container kopieren

Im Projektverzeichnis ausführen:

```powershell
New-Item -ItemType Directory -Force .claude/certs

$nginx = docker compose `
  --env-file .env.production `
  -f docker-compose.prod.yml `
  ps -q nginx

docker cp "${nginx}:/etc/nginx/tls/server.crt" `
  ".claude/certs/wiki.playground.local.pem"
```

Die Datei sollte anschließend vorhanden sein:

```powershell
Test-Path ".claude/certs/wiki.playground.local.pem"
```

Erwartete Ausgabe:

```text
True
```

### 2. Zertifikat für den aktuellen Windows-Benutzer importieren

```powershell
$certificatePath = (Resolve-Path `
  ".claude/certs/wiki.playground.local.pem").Path

$certificate = Import-Certificate `
  -FilePath $certificatePath `
  -CertStoreLocation "Cert:\CurrentUser\Root"

$certificate | Select-Object Subject, Issuer, Thumbprint
```

Der Import betrifft nur den aktuellen Windows-Benutzer und benötigt normalerweise keine Administratorrechte.

> Das Zertifikat sollte nur auf einem vertrauenswürdigen Rechner importiert werden. Vor dem Import muss sichergestellt sein, dass es direkt aus dem eigenen AD-Wiki-nginx-Container stammt.

### 3. Claude Code neu starten und Verbindung prüfen

Alle laufenden Claude-Code-Prozesse schließen. Danach eine neue PowerShell öffnen und aus dem Projektverzeichnis prüfen:

```powershell
claude mcp get ad-wiki-prod
```

Der erwartete Zustand vor der ersten Anmeldung ist:

```text
Status: ! Needs authentication
```

Anschließend Claude starten, `/mcp` öffnen und beim Eintrag `ad-wiki-prod`
`Authenticate` auswählen:

```powershell
claude
```

Nach erfolgreicher Browserfreigabe sollte der MCP-Server verbunden sein.

### 4. Vertrauensstellung bei Bedarf entfernen

Zuerst den Fingerabdruck des importierten Zertifikats ermitteln:

```powershell
$certificatePath = (Resolve-Path `
  ".claude/certs/wiki.playground.local.pem").Path

$thumbprint = (Get-PfxCertificate `
  -FilePath $certificatePath).Thumbprint

$thumbprint
```

Vor dem Entfernen kontrollieren, welches Zertifikat gefunden wurde:

```powershell
Get-Item "Cert:\CurrentUser\Root\$thumbprint" |
  Select-Object Subject, Issuer, Thumbprint
```

Nur wenn die angezeigten Daten eindeutig zu `wiki.playground.local` gehören, entfernen:

```powershell
Remove-Item "Cert:\CurrentUser\Root\$thumbprint"
```

## Variante B: Unsicherer kurzfristiger Funktionstest

Falls lediglich bestätigt werden soll, dass TLS die einzige Fehlerursache ist, kann die Zertifikatsprüfung für den gestarteten Claude-Prozess vorübergehend deaktiviert werden:

```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

claude mcp get ad-wiki-prod
claude
```

Danach in `/mcp` bei `ad-wiki-prod` die Anmeldung starten.

Der Status sollte sich von `Failed to connect` zu `Needs authentication` ändern.

Nach dem Beenden von Claude die Variable sofort entfernen:

```powershell
Remove-Item Env:NODE_TLS_REJECT_UNAUTHORIZED
```

> Diese Variante deaktiviert für den gestarteten Prozess die Prüfung sämtlicher HTTPS-Zertifikate. Sie darf nicht dauerhaft in einem PowerShell-Profil oder als Windows-Umgebungsvariable gespeichert werden.

## Warum `NODE_EXTRA_CA_CERTS` hier nicht genügt

Der folgende Aufruf funktioniert mit normalen Node.js-Verbindungen gegen den AD-Wiki-Endpunkt:

```powershell
$env:NODE_EXTRA_CA_CERTS = `
  (Resolve-Path ".claude/certs/wiki.playground.local.pem").Path
```

Bei der getesteten Claude-Code-Version `2.1.205` verwendete der MCP-HTTP-Client diese zusätzliche Node-CA jedoch nicht. Auch `SSL_CERT_FILE` änderte den MCP-Verbindungsstatus nicht. Deshalb wird für dieses Setup die Windows-Vertrauensstellung aus Variante A verwendet.

## Fehleranalyse

### Der Status bleibt `Failed to connect`

Prüfen, ob Windows dem Endpunkt vertraut:

```powershell
curl.exe -I https://wiki.playground.local/mcp
```

Eine Antwort wie `401 Unauthorized` ist an dieser Stelle korrekt: TLS funktioniert, aber die MCP-Anmeldung fehlt noch. Eine Zertifikatsmeldung wie `SEC_E_UNTRUSTED_ROOT` bedeutet, dass die Vertrauensstellung noch nicht greift.

Danach prüfen:

```powershell
claude mcp get ad-wiki-prod
```

### Der Status lautet `Needs authentication`

TLS und MCP-Erreichbarkeit funktionieren. Nun anmelden:

```powershell
claude
```

In Claude Code `/mcp` öffnen und bei `ad-wiki-prod` `Authenticate` auswählen.

### Das Zertifikat wurde nach einem Docker-Neustart ungültig

Ein normaler Neustart ändert das Zertifikat nicht, weil es in einem Docker-Volume liegt. Wird das TLS-Volume jedoch gelöscht oder neu erzeugt, entsteht ein neues Zertifikat. Dann muss das alte Zertifikat aus dem Windows-Zertifikatsspeicher entfernt und das neue Zertifikat erneut aus dem Container importiert werden.

## Dauerhafte Produktionslösung

Ein öffentlich vertrauenswürdiges Zertifikat bleibt die sauberste Lösung. Dafür müssen in `.env.production` Zertifikat, privater Schlüssel und Zwischenzertifikatskette angegeben werden:

```dotenv
TLS_CERT_PATH=C:/pfad/zum/cert.pem
TLS_KEY_PATH=C:/pfad/zum/privkey.pem
TLS_CA_CHAIN_PATH=C:/pfad/zum/chain.pem
```

Da `wiki.playground.local` keine öffentlich registrierbare DNS-Domain ist, kann
Let's Encrypt dafür kein Zertifikat ausstellen. Für diesen Host muss das
selbstsignierte Zertifikat wie oben beschrieben oder ein Zertifikat einer
internen PKI vertraut werden. Für eine öffentlich erreichbare Installation ist
stattdessen eine echte DNS-Domain mit einem öffentlich vertrauenswürdigen
Zertifikat zu verwenden.
