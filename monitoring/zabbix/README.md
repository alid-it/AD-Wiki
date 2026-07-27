# AD-Wiki in Zabbix einbinden

AD-Wiki benötigt keinen Agenten auf dem Anwendungsserver. Zabbix fragt die
öffentlichen HTTPS-Endpunkte von seiner eigenen VM oder seinem Proxy aus ab.

## Host-Makros

Am AD-Wiki-Host werden zwei Makros hinterlegt:

- `{$AD_WIKI_URL}`: beispielsweise `https://wiki.example.com`
- `{$AD_WIKI_MONITORING_TOKEN}`: der Wert aus `AD_WIKI_MONITORING_TOKEN`,
  als **Secret text**

Der Token darf nicht in ein exportiertes Template geschrieben werden.

## Master-Items

1. **AD-Wiki readiness**
   - Typ: HTTP agent
   - URL: `{$AD_WIKI_URL}/api/v1/health/ready`
   - Statuscodes: `200`
   - Intervall: `1m`
2. **AD-Wiki Prometheus metrics**
   - Typ: HTTP agent
   - URL: `{$AD_WIKI_URL}/api/v1/health/metrics`
   - Header: `Authorization: Bearer {$AD_WIKI_MONITORING_TOKEN}`
   - Statuscodes: `200`
   - Intervall: `1m`

Für das Metrik-Master-Item werden abhängige Items mit der
**Prometheus pattern**-Vorverarbeitung und Ausgabe `value` angelegt:

| Item | Prometheus-Muster |
| --- | --- |
| PostgreSQL erreichbar | `ad_wiki_dependency_up{dependency="database"}` |
| Redis erreichbar | `ad_wiki_dependency_up{dependency="redis"}` |
| Backup veraltet | `ad_wiki_backup_stale` |
| Letzter Backup-Fehler offen | `ad_wiki_backup_latest_failure_open` |
| Aktive Backup-Jobs | `ad_wiki_backup_active_jobs` |
| Wartende Backup-Jobs | `ad_wiki_backup_queued_jobs` |
| Laufende Backup-Jobs | `ad_wiki_backup_running_jobs` |
| Ältester wartender Job | `ad_wiki_backup_oldest_queued_age_seconds` |
| Backup-Worker erreichbar | `ad_wiki_backup_worker_up` |
| Alter des Worker-Heartbeats | `ad_wiki_backup_worker_heartbeat_age_seconds` |
| Überfällige Sicherungspläne | `ad_wiki_backup_overdue_plans` |
| Zertifikat prüfbar | `ad_wiki_tls_certificate_configured` |
| Zertifikat Resttage | `ad_wiki_tls_certificate_days_remaining` |
| API-Prozessspeicher | `ad_wiki_process_resident_memory_bytes` |
| Verwendeter JavaScript-Heap | `ad_wiki_process_heap_used_bytes` |
| Anzahl Medien | `ad_wiki_media_files` |
| Größe der Medien | `ad_wiki_media_bytes` |
| Upload-Dateisystem prüfbar | `ad_wiki_upload_filesystem_inspectable` |
| Freier Upload-Speicher | `ad_wiki_upload_filesystem_free_ratio` |
| SMTP aktiviert | `ad_wiki_smtp_enabled` |
| Letzter SMTP-Fehler offen | `ad_wiki_smtp_latest_failure_open` |
| Letzter Audit-Fehler offen | `ad_wiki_audit_latest_failure_open` |
| Audit-Protokoll lesbar | `ad_wiki_audit_database_readable` |
| Gespeicherte Audit-Einträge | `ad_wiki_audit_entries` |
| Fehlgeschlagene Logins | `ad_wiki_login_attempts_total{result="failure"}` |
| HTTP 401 | `ad_wiki_security_http_responses_total{status_code="401"}` |
| HTTP 403 | `ad_wiki_security_http_responses_total{status_code="403"}` |
| HTTP 429 | `ad_wiki_security_http_responses_total{status_code="429"}` |
| Ungültige API-Keys | `ad_wiki_api_key_auth_attempts_total{result="failure"}` |
| Ungültige MCP-Tokens | `ad_wiki_mcp_auth_attempts_total{result="failure"}` |
| Fehlgeschlagene MCP-Anfragen | `ad_wiki_mcp_requests_total{result="failure"}` |

## Empfohlene Trigger

- Readiness-HTTP-Item nicht erfolgreich für 2 Minuten: **Disaster**
- PostgreSQL oder Redis gleich `0` für 2 Minuten: **Disaster**
- Backup veraltet gleich `1` für 15 Minuten: **Disaster**
- Letzter Backup-Fehler offen gleich `1` für 2 Minuten: **Disaster**
- Backup-Worker bei aktivierten Plänen gleich `0` für 2 Minuten: **Disaster**
- Überfällige Sicherungspläne größer `0` für 5 Minuten: **Disaster**
- Ältester wartender Job länger als 300 Sekunden: **Warning**
- Aktive Backup-Jobs größer `0` für 2 Stunden: **Warning**
- Zertifikat nicht prüfbar gleich `0` für 15 Minuten: **Warning**
- Zertifikat höchstens 30 Resttage: **Warning**
- Zertifikat höchstens 7 Resttage: **Disaster**
- Upload-Dateisystem nicht prüfbar für 15 Minuten: **Warning**
- Freier Upload-Speicher unter 15 Prozent: **Warning**
- Freier Upload-Speicher unter 8 Prozent: **Disaster**
- Letzter SMTP-Fehler bei aktiviertem Versand offen: **Warning**
- Letzter Audit-Schreibfehler offen: **Disaster**
- Audit-Protokoll nicht lesbar für 5 Minuten: **Disaster**
- Zunahme fehlgeschlagener Logins um mindestens 10 in 5 Minuten: **Warning**
- Zunahme von HTTP 401 oder 403 um mindestens 25 in 5 Minuten: **Warning**
- Zunahme von HTTP 429 um mindestens 20 in 5 Minuten: **Warning**
- Zunahme ungültiger API-Keys oder MCP-Tokens um mindestens 10 in 5 Minuten: **Warning**
- MCP-Fehlerquote über 20 Prozent bei mindestens 10 Anfragen in 5 Minuten: **Warning**

Die Weiterleitung wird anschließend wie bei allen anderen Hosts über die
vorhandenen Zabbix-Aktionen, Medien und Eskalationsregeln konfiguriert. AD-Wiki
betreibt dafür keinen eigenen Alarmdienst.

HTTP-Fehlerquoten und p95-/p99-Latenzen werden in Prometheus direkt aus
`ad_wiki_http_requests_total` und dem Histogramm
`ad_wiki_http_request_duration_seconds_bucket` berechnet. In Zabbix können
diese Serien ebenfalls als abhängige Items übernommen werden; die
Zusammenfassung sollte dort mit berechneten Items erfolgen, damit keine
dynamischen Routen oder Benutzerinformationen als neue Host-Makros entstehen.
Auch für Sicherheitswerte dürfen keine Benutzer, IP-Adressen oder
Tokenbestandteile als Item-Schlüssel oder Discovery-Makros ergänzt werden.
