# Microsoft Entra für Dev und Prod konfigurieren

Die Microsoft-To-Do-Integration wird nur aktiviert, wenn Tenant-ID, Client-ID,
Client-Secret, Redirect-URI und der lokale Verschlüsselungsschlüssel gesetzt
sind. Solange einer dieser Werte fehlt, zeigt die Oberfläche absichtlich
„Die Entra-App ist im Backend noch nicht vollständig konfiguriert“.

## 1. App-Registrierung in Entra

In Microsoft Entra eine App-Registrierung für die AD-Wiki-Installation anlegen.
Unter **Authentication > Web > Redirect URIs** beide Adressen exakt eintragen:

```text
http://localhost:4000/api/v1/integrations/microsoft/callback
https://wiki.example.com/api/v1/integrations/microsoft/callback
```

Unter **API permissions > Microsoft Graph > Delegated permissions** wird
`Tasks.ReadWrite` benötigt. Die OpenID-Scopes `openid`, `profile` und
`offline_access` fordert MSAL während der Anmeldung an.

Unter **Certificates & secrets** ein Client-Secret erstellen. In AD-Wiki wird
der Secret-**Wert** benötigt, nicht die Secret-ID. Den Wert nur in den lokalen,
von Git ignorierten ENV-Dateien beziehungsweise im Secret Store ablegen.

## 2. Entwicklungsumgebung

In `apps/api/.env` eintragen:

```dotenv
MICROSOFT_TENANT_ID=<Directory-Tenant-ID>
MICROSOFT_CLIENT_ID=<Application-Client-ID>
MICROSOFT_CLIENT_SECRET=<Client-Secret-Wert>
MICROSOFT_REDIRECT_URI=http://localhost:4000/api/v1/integrations/microsoft/callback
INTEGRATION_ENCRYPTION_KEY=<32-zufällige-Bytes-als-Base64>
```

Der Verschlüsselungsschlüssel kann in PowerShell erzeugt werden:

```powershell
$bytes = [byte[]]::new(32)
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
[Convert]::ToBase64String($bytes)
```

Danach den API-Entwicklungsprozess neu starten.

## 3. Docker-/Prod-Umgebung

In `.env.production` eintragen:

```dotenv
MICROSOFT_TENANT_ID=<Directory-Tenant-ID>
MICROSOFT_CLIENT_ID=<Application-Client-ID>
MICROSOFT_REDIRECT_URI=https://wiki.example.com/api/v1/integrations/microsoft/callback
AD_WIKI_MICROSOFT_CLIENT_SECRET=<Client-Secret-Wert>
AD_WIKI_INTEGRATION_ENCRYPTION_KEY=<32-zufällige-Bytes-als-Base64>
```

`AD_WIKI_INTEGRATION_ENCRYPTION_KEY` muss stabil gesichert werden. Eine Änderung
macht bereits gespeicherte Microsoft-Token-Caches unlesbar und erfordert eine
erneute Verbindung der betroffenen Benutzer.

Die Container müssen nach ENV-Änderungen neu erstellt werden:

```powershell
npm run docker:rebuild
```

Anschließend unter `https://wiki.example.com/settings/integrations` prüfen,
dass die Warnung verschwunden und die Schaltfläche **Verbinden** aktiv ist.

## 4. Häufige Fehler

- `AADSTS50011`: Die Redirect-URI stimmt nicht Zeichen für Zeichen mit der
  Entra-App überein oder wurde unter dem falschen Plattformtyp registriert.
- Die Warnung bleibt sichtbar: Mindestens ein Backend-Wert ist leer oder der
  Verschlüsselungsschlüssel ist nicht exakt 32 Byte Base64.
- Anmeldung klappt nur in einer Umgebung: Beide Redirect-URIs müssen in
  derselben App registriert sein; jede AD-Wiki-Instanz verwendet ihre eigene
  `MICROSOFT_REDIRECT_URI`.
- Ein Client-Secret ist abgelaufen: Neues Secret erstellen, ENV aktualisieren,
  API neu starten und die Microsoft-Verbindung erneut autorisieren.
