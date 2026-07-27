# SSO-Betrieb

Diese Betriebsanleitung gilt für Microsoft Entra ID, Keycloak und andere
OpenID-Connect-Provider. AD-Wiki verarbeitet ausschließlich OIDC-Claims;
LDAP-/Active-Directory-Zugangsdaten verbleiben in Keycloak.

## Secrets und Key-Rotation

- `AD_WIKI_SSO_ENCRYPTION_KEY` wird im Produktions-Compose als Docker-Secret
  eingehängt. Der Wert muss genau 32 zufällige Bytes als Base64 enthalten.
- Client-Secrets werden in der Datenbank authentifiziert verschlüsselt und
  niemals über Lese-Endpunkte zurückgegeben.
- Für eine Client-Secret-Rotation zuerst beim Provider ein überlappend gültiges
  Secret erstellen, es unter `/settings/identity-providers` ersetzen und den
  Verbindungstest sowie einen Login ausführen. Erst danach das alte Secret
  beim Provider widerrufen.
- Eine Rotation von `AD_WIKI_SSO_ENCRYPTION_KEY` benötigt ein geplantes
  Wartungsfenster und die Neueingabe aller Provider-Secrets. Vorher ein
  verschlüsseltes Backup erstellen und lokalen Notfallzugang prüfen.

## Interne PKI, DNS und Reverse Proxy

- Produktions-Issuer, Discovery, JWKS, Authorization und Token-Endpunkte müssen
  HTTPS verwenden. Die ausstellende interne CA wird im API-Container als
  Systemvertrauen bereitgestellt; TLS-Prüfungen werden nicht deaktiviert.
- Private, kontrollierte Keycloak-Ziele müssen mit ihrem exakten DNS-Namen in
  `OIDC_ALLOWED_PRIVATE_HOSTS` freigegeben werden. Keine IP-Adressen, Wildcards
  oder `localhost` eintragen.
- Der Reverse Proxy muss `Host` und `X-Forwarded-Proto` korrekt setzen. Die
  öffentliche Basis ist `APP_ORIGIN`; die registrierte Redirect-URI lautet
  exakt `https://<host>/api/v1/auth/oidc/<provider-slug>/callback`.
- Offene Redirects sind nicht vorgesehen. Callback und Ziele werden
  ausschließlich serverseitig erzeugt.

## Providerwechsel

1. Neuen Provider zunächst inaktiv anlegen und Verbindung testen.
2. Claim-Mapping, nicht-administrative JIT-Standardrolle sowie Gruppen- und
   Rollen-Mappings mit der schreibfreien Vorschau prüfen.
3. Neuen Provider aktivieren und mit einem Testkonto anmelden.
4. Effektive Rechte, Wissensbereiche und Ressourcen-ACLs prüfen.
5. Erst danach den alten Provider deaktivieren. Verknüpfte Identitäten vor
   einem späteren Löschen kontrolliert migrieren oder entfernen.

Das Deaktivieren des letzten aktiven Providers und der lokalen Anmeldung
benötigt jeweils eine ausdrückliche Bestätigung. Provider-Metadaten zu
RP-initiated, Frontchannel oder Backchannel Logout werden im Verbindungstest
angezeigt. Eine Provider-Logout-Funktion wird erst nach einer praktischen
Abnahme mit exakt diesem Provider aktiviert; bis dahin widerruft AD-Wiki seine
eigenen Sitzungen zuverlässig und leitet keine ungeprüften Logout-Tokens weiter.

## Notfallzugang

- Das bei der Installation erzeugte geschützte lokale Administratorkonto kann
  weder durch externe Claims verändert noch durch SSO deaktiviert werden.
- Zugangsdaten getrennt und offline verwahren. Nach jeder SSO- oder
  Reverse-Proxy-Änderung in einem privaten Browserfenster testen.
- Bei Provider-Ausfall über die normale Loginseite lokal anmelden. Falls die
  lokale Anmeldung für normale Benutzer deaktiviert ist, bleibt sie für das
  geschützte Notfallkonto serverseitig erzwungen verfügbar.
- Danach den fehlerhaften Provider deaktivieren, lokale Anmeldung temporär
  aktivieren und Audit-/Monitoring-Ereignisse prüfen.

## Monitoring und Audit

Login-Erfolg und -Fehler, Provider-Verbindungstests, Mappingänderungen,
Synchronisationsfehler und effektive Rechteänderungen werden protokolliert.
Metriken verwenden keine E-Mail-Adressen, Subjects, Gruppen-IDs oder andere
hoch-kardinale personenbezogene Labels. Alarmiert werden sollten wiederholte
Providerfehler und Synchronisationsfehler.

## Rollback

1. Vor Deployment Datenbank und Uploads sichern.
2. Bei einem Anwendungsfehler die vorherige gespeicherte Container-Version
   starten; Datenbankmigrationen in umgekehrter Reihenfolge anhand der
   jeweiligen `rollback.sql` ausführen.
3. Für Phase 15F zuerst
   `20260724192000_add_identity_administration_permissions/rollback.sql`
   verwenden. Danach folgen 15E bis 15A rückwärts.
4. Rollback-Dateien nur über den dokumentierten Prisma-Migrationsprozess
   anwenden, niemals Tabellen manuell verändern.
5. Notfallkonto, lokalen Login, eine bestehende Sitzung und effektive Rechte
   praktisch prüfen.
