import assert from "node:assert/strict";
import test from "node:test";
import { BackupJobStatus } from "@prisma/client";
import { SystemInfoSchema } from "@ad-wiki/shared-types";
import { MonitoringService } from "../../dist/health/monitoring.service.js";
import { BackupCoordinationService } from "../../dist/modules/backups/backup-coordination.service.js";

function monitoringWith(options: { stale: boolean; openFailure: boolean }): MonitoringService {
  const now = Date.now();
  const successAt = options.stale ? null : new Date(now - 60 * 60 * 1_000);
  const failureAt = options.openFailure
    ? new Date(now - 30 * 60 * 1_000)
    : new Date(now - 2 * 60 * 60 * 1_000);
  const prisma = {
    $queryRaw: async () => 1,
    backupJob: {
      findFirst: async (args: { where: { status: BackupJobStatus } }) => {
        if (args.where.status === BackupJobStatus.SUCCEEDED) {
          return successAt
            ? {
              startedAt: new Date(successAt.getTime() - 90_000),
              finishedAt: successAt,
              artifactSize: BigInt(1_048_576),
            }
            : null;
        }
        if (args.where.status === BackupJobStatus.FAILED) {
          return {
            finishedAt: failureAt,
            errorCode: options.openFailure ? "PG_DUMP_FAILED" : null,
          };
        }
        return null;
      },
      count: async (args: { where: { status: BackupJobStatus | { in: BackupJobStatus[] } } }) => {
        if (args.where.status === BackupJobStatus.FAILED) return options.openFailure ? 1 : 0;
        if (args.where.status === BackupJobStatus.SUCCEEDED) return successAt ? 1 : 0;
        return 0;
      },
    },
    backupPlan: {
      count: async (args: { where: { nextRunAt?: { lt: Date } } }) =>
        args.where.nextRunAt ? 0 : 1,
    },
    media: {
      aggregate: async () => ({
        _count: { _all: 3 },
        _sum: { size: 12_345 },
      }),
    },
    smtpConfiguration: {
      findUnique: async () => ({ isEnabled: true }),
    },
    auditLog: {
      count: async () => 42,
      findFirst: async () => ({ createdAt: new Date("2026-07-23T09:00:00.000Z") }),
    },
  };
  const coordination = {
    health: async () => ({ available: true, mode: "native" as const }),
    workerHeartbeat: async () => new Date(),
  };
  return new MonitoringService(
    prisma as unknown as ConstructorParameters<typeof MonitoringService>[0],
    coordination as unknown as ConstructorParameters<typeof MonitoringService>[1],
  );
}

test("Systemstatus und Prometheus verwenden dieselbe gesunde Zustandsquelle", async () => {
  const service = monitoringWith({ stale: false, openFailure: false });
  const info = await service.systemInfo();
  assert.equal(info.status, "healthy");
  assert.equal(info.backup.stale, false);
  assert.equal(info.backup.latestFailureOpen, false);
  assert.equal(info.services.find((item) => item.id === "database")?.status, "healthy");
  assert.equal(info.capacity.mediaCount, 3);
  assert.equal(info.capacity.mediaTotalBytes, "12345");
  assert.equal(info.audit.databaseReadable, true);
  assert.equal(info.audit.totalEntries, 42);
  assert.equal(info.audit.lastEntryAt, "2026-07-23T09:00:00.000Z");
  SystemInfoSchema.parse(info);

  const metrics = await service.prometheus();
  assert.match(metrics, /ad_wiki_dependency_up\{dependency="database"\} 1/);
  assert.match(metrics, /ad_wiki_dependency_up\{dependency="redis"\} 1/);
  assert.match(metrics, /ad_wiki_backup_stale 0/);
  assert.match(metrics, /ad_wiki_backup_latest_failure_open 0/);
  assert.match(metrics, /ad_wiki_backup_worker_up 1/);
  assert.match(metrics, /ad_wiki_backup_overdue_plans 0/);
  assert.match(metrics, /ad_wiki_media_files 3/);
  assert.match(metrics, /ad_wiki_media_bytes 12345/);
  assert.match(metrics, /ad_wiki_audit_entries 42/);
});

test("Ein neuerer Backup-Fehler setzt Systemstatus und Alarmmetrik auf kritisch", async () => {
  const service = monitoringWith({ stale: true, openFailure: true });
  const info = await service.systemInfo();
  assert.equal(info.status, "critical");
  assert.equal(info.backup.stale, true);
  assert.equal(info.backup.latestFailureOpen, true);
  assert.equal(info.backup.lastFailureCode, "PG_DUMP_FAILED");

  const metrics = await service.prometheus();
  assert.match(metrics, /ad_wiki_backup_stale 1/);
  assert.match(metrics, /ad_wiki_backup_latest_failure_open 1/);
});

test("HTTP-Histogramm und Prozessressourcen bleiben niedrig-kardinal und Prometheus-kompatibel", async () => {
  const service = monitoringWith({ stale: false, openFailure: false });
  service.recordHttp("GET", "/api/v1/pages/:id", 200, 120);

  const metrics = await service.prometheus();
  assert.match(
    metrics,
    /ad_wiki_http_request_duration_seconds_bucket\{method="GET",route="\/api\/v1\/pages\/:id",status_code="200",status_class="2xx",le="0\.1"\} 0/,
  );
  assert.match(
    metrics,
    /ad_wiki_http_request_duration_seconds_bucket\{method="GET",route="\/api\/v1\/pages\/:id",status_code="200",status_class="2xx",le="0\.25"\} 1/,
  );
  assert.match(
    metrics,
    /ad_wiki_http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/pages\/:id",status_code="200",status_class="2xx"\} 1/,
  );
  assert.match(metrics, /ad_wiki_process_resident_memory_bytes \d+/);
  assert.match(metrics, /ad_wiki_process_cpu_user_seconds_total \d/);
});

test("Backup-Worker-Heartbeat ist auch im lokalen Koordinationsmodus lesbar", async () => {
  const coordination = new BackupCoordinationService();
  const heartbeat = new Date("2026-07-23T10:00:00.000Z");
  await coordination.recordWorkerHeartbeat(heartbeat);
  assert.equal((await coordination.workerHeartbeat())?.toISOString(), heartbeat.toISOString());
});

test("SMTP- und Audit-Fehler werden ohne Empfänger- oder Benutzerdaten erfasst", async () => {
  const service = monitoringWith({ stale: false, openFailure: false });
  service.recordSmtpDelivery(false, new Date("2026-07-23T10:00:00.000Z"));
  service.recordAuditWrite(false, new Date("2026-07-23T10:01:00.000Z"));

  const failed = await service.systemInfo();
  assert.equal(failed.smtp.latestFailureOpen, true);
  assert.equal(failed.audit.latestFailureOpen, true);
  assert.equal(failed.status, "critical");

  service.recordSmtpDelivery(true, new Date("2026-07-23T10:02:00.000Z"));
  service.recordAuditWrite(true, new Date("2026-07-23T10:03:00.000Z"));
  const metrics = await service.prometheus();
  assert.match(metrics, /ad_wiki_smtp_delivery_attempts_total\{result="failure"\} 1/);
  assert.match(metrics, /ad_wiki_smtp_delivery_attempts_total\{result="success"\} 1/);
  assert.match(metrics, /ad_wiki_audit_latest_failure_open 0/);
  assert.doesNotMatch(metrics, /recipient|user_id|email=/i);
});

test("Sicherheitsmetriken verwenden ausschließlich fest begrenzte Labels", async () => {
  const service = monitoringWith({ stale: false, openFailure: false });
  service.recordLoginAttempt(false);
  service.recordSecurityHttpResponse(401);
  service.recordSecurityHttpResponse(403);
  service.recordSecurityHttpResponse(429);
  service.recordApiKeyAuthentication(false);
  service.recordMcpAuthentication(false);
  service.recordMcpRequest("auth_failure");

  const info = await service.systemInfo();
  assert.equal(info.security.loginFailureCount, 1);
  assert.equal(info.security.apiKeyFailureCount, 1);
  assert.equal(info.security.mcpRequestFailureCount, 1);

  const metrics = await service.prometheus();
  assert.match(metrics, /ad_wiki_login_attempts_total\{result="failure"\} 1/);
  assert.match(metrics, /ad_wiki_security_http_responses_total\{status_code="401"\} 1/);
  assert.match(metrics, /ad_wiki_api_key_auth_attempts_total\{result="failure"\} 1/);
  assert.match(metrics, /ad_wiki_mcp_auth_attempts_total\{result="failure"\} 1/);
  assert.doesNotMatch(metrics, /user_id|email=|token_id|client_id|ip_address|route=/i);
});
