# Externes Monitoring

AD-Wiki bringt **keinen eigenen Prometheus-, Grafana-, Alertmanager- oder
Zabbix-Stack** mit. Der Produktions-Compose-Stack stellt ausschließlich die
Anwendung und ihre Betriebsdaten bereit. Eine vorhandene Monitoring-VM ruft
diese Daten über die öffentliche HTTPS-Adresse der Installation ab.

```text
Monitoring-VM                           AD-Wiki-VM
Prometheus + Grafana  ─── HTTPS/443 ──> /api/v1/health/*
oder Zabbix             <keine weiteren freizugebenden Ports>
```

Damit bleiben Speicherung, Dashboards, Alarmempfänger und Eskalationsregeln
vollständig in der bereits vorhandenen Monitoring-Infrastruktur.

## Endpunkte

| Endpunkt | Zugriff | Zweck |
| --- | --- | --- |
| `/api/v1/health/live` | öffentlich | Einfacher Liveness-Check |
| `/api/v1/health/ready` | öffentlich | API- und PostgreSQL-Bereitschaft |
| `/api/v1/health/metrics` | Bearer-Token | Prometheus-Metriken |
| `/settings/system-info` | Administrator | Lesbare Betriebsansicht in AD-Wiki |

Die Metriken enthalten unter anderem:

- Erreichbarkeit und Latenz von PostgreSQL und Redis;
- Alter, Status und laufende Jobs der Backups;
- Heartbeat des Backup-Workers, Warteschlangenalter und überfällige Pläne;
- Laufzeit und Prüfbarkeit des aktiven TLS-Zertifikats;
- HTTP-Anfragen, 5xx-/429-Raten und p95-/p99-fähige Latenzhistogramme;
- CPU-Zeit, RSS und Heap-Speicher des API-Prozesses.
- Anzahl und Gesamtgröße der Medien sowie freier Platz im Upload-Volume;
- redigierte SMTP- und Audit-Schreibergebnisse ohne Empfänger oder Benutzerlabels.
- gespeicherte Audit-Anzahl und Zeitpunkt des letzten Datenbankeintrags;
- fehlgeschlagene Logins sowie HTTP 401, 403 und 429;
- API-Key- und MCP-Authentifizierungsfehler als getrennte Serien.

## Datenschutz, Kardinalität und Aufbewahrung

Sicherheitsmetriken verwenden ausschließlich feste Labels:

- `result="success|failure"`;
- `status_code="401|403|429"`;
- eine kleine, fest definierte MCP-Ergebnismenge.

Benutzer-IDs, E-Mail-Adressen, IP-Adressen, Routen, API-Keys, MCP-Token und
Client-IDs werden nicht als Metriklabels ausgegeben. Die Prozesszähler beginnen
nach einem API-Neustart wieder bei null; Prometheus verarbeitet Counter-Resets
bei `rate()` und `increase()` automatisch.

Die langfristige Speicherung erfolgt ausschließlich in der externen
Monitoring-Plattform. Für sicherheitsbezogene Rohmetriken wird eine
Prometheus-Aufbewahrung von höchstens 30 Tagen empfohlen, sofern keine
abweichende betriebliche oder rechtliche Vorgabe besteht. Längere
Nachweiszeiträume gehören in das zugriffsgeschützte Audit-Protokoll und nicht
in personenbezogene Metriklabels.

## AD-Wiki vorbereiten

In `.env.production` wird ein eigener, zufälliger Monitoring-Token gesetzt:

```dotenv
AD_WIKI_MONITORING_TOKEN=<langes-zufälliges-secret>
BACKUP_STALE_AFTER_HOURS=26
BACKUP_WORKER_STALE_AFTER_SECONDS=60
BACKUP_SCHEDULE_GRACE_MINUTES=5
UPLOAD_DISK_WARNING_FREE_PERCENT=15
UPLOAD_DISK_CRITICAL_FREE_PERCENT=8
```

Danach wird der normale AD-Wiki-Stack neu gestartet. Es werden keine
Monitoring-Container gestartet:

```powershell
npm run docker:up
```

Der gleiche Token wird auf der Monitoring-VM als Secret hinterlegt. Ein
manueller Test von dort aus:

```powershell
$headers = @{ Authorization = "Bearer <monitoring-token>" }
Invoke-WebRequest `
  -Uri "https://wiki.example.com/api/v1/health/metrics" `
  -Headers $headers
```

Es genügt eine Firewall-Freigabe von der Monitoring-VM zur öffentlichen
AD-Wiki-Adresse auf TCP 443. Datenbank-, Redis- und interne Container-Ports
bleiben geschlossen.

## Prometheus und Grafana

Das Verzeichnis `monitoring/` ist ein Importpaket für die vorhandene
Monitoring-VM:

| Datei | Verwendung |
| --- | --- |
| `monitoring/prometheus/ad-wiki-scrape.example.yml` | Scrape-Jobs in die bestehende `prometheus.yml` übernehmen |
| `monitoring/prometheus/rules/ad-wiki-alerts.yml` | In das vorhandene Prometheus-Regelverzeichnis kopieren |
| `monitoring/grafana/ad-wiki-overview.json` | In die vorhandene Grafana-Instanz importieren |
| `monitoring/alertmanager/ad-wiki-route.example.yml` | Route und Receiver in vorhandenen Alertmanager übernehmen |

Im Scrape-Beispiel müssen mindestens der Hostname, der Pfad zur Token-Datei und
gegebenenfalls die Adresse des vorhandenen Blackbox Exporters angepasst werden.
Der Blackbox-Job ist optional; er prüft die Anwendung aus Sicht der
Monitoring-VM. Anschließend:

1. Prometheus-Konfiguration und Regeln mit `promtool check` validieren.
2. Prometheus neu laden und unter **Status → Targets** den Job
   `ad-wiki-api` prüfen.
3. Das Dashboard-JSON in Grafana importieren und die bestehende
   Prometheus-Datenquelle auswählen.
4. Die AD-Wiki-Route in den vorhandenen Alertmanager beziehungsweise die
   zentrale Alarmplattform einfügen.

Die mitgelieferten Regeln alarmieren bei:

- nicht erreichbaren Metriken oder optionalen Blackbox-Zielen;
- ausgefallener PostgreSQL- oder Redis-Verbindung;
- veralteten, fehlgeschlagenen oder festhängenden Backups;
- fehlendem Worker-Heartbeat, blockierter Warteschlange oder verpassten Plänen;
- erhöhter 5xx-Rate, p95-Latenz oder ungewöhnlich vielen HTTP-429-Antworten;
- ungewöhnlich vielen Login-, 401-, 403-, API-Key- oder MCP-Fehlern;
- einer erhöhten MCP-Fehlerquote bei ausreichendem Anfragevolumen;
- knappem Upload-Speicher sowie fehlgeschlagenem SMTP- oder Audit-Schreibpfad;
- nicht prüfbaren oder in 30 beziehungsweise 7 Tagen ablaufenden Zertifikaten.

Der Betrieb des Monitoring-Systems selbst wird weiterhin mit dessen bestehenden
Regeln überwacht; AD-Wiki liefert dafür bewusst keine zweite Alarmkette.

## Zabbix

Zabbix verwendet dieselben Endpunkte. Es ist kein Zabbix-Agent auf der
AD-Wiki-VM erforderlich. Die genaue Zuordnung der HTTP-Agent-Items,
Prometheus-Vorverarbeitung und Trigger steht in
[`monitoring/zabbix/README.md`](../monitoring/zabbix/README.md).

Kurzfassung:

1. `/api/v1/health/ready` als HTTP-Agent-Item mit erwartetem Status 200 anlegen.
2. `/api/v1/health/metrics` als zweites HTTP-Agent-Item mit dem Bearer-Header
   abrufen.
3. Werte wie `ad_wiki_dependency_up`, `ad_wiki_backup_stale` und
   `ad_wiki_tls_certificate_days_remaining` in abhängige Items aufteilen.
4. Benachrichtigungen über die vorhandenen Zabbix-Aktionen und Medien senden.

Der Token gehört als geschütztes Host-Makro in Zabbix und niemals in ein
exportiertes Template.

## Betriebsabnahme

- Erreichbarkeit ausschließlich von der Monitoring-VM aus testen.
- Einen ungefährlichen Testalarm in der externen Plattform auslösen und den
  Empfang dokumentieren.
- Einen echten Ausfalltest für ein entbehrliches Testsystem durchführen.
- Backup-Alter und Zertifikatsgrenzen gegen die Settings-Seite vergleichen.
- Alarmkette monatlich sowie Restore und Backup-Integrität regelmäßig prüfen.
