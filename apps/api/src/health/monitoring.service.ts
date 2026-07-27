import { Injectable } from "@nestjs/common";
import { BackupJobOperation, BackupJobStatus } from "@prisma/client";
import type {
  SystemAuditStatus,
  SystemBackupStatus,
  SystemCapacityStatus,
  SystemCertificateStatus,
  SystemDependency,
  SystemHealthStatus,
  SystemInfo,
  SystemSecurityStatus,
  SystemSmtpStatus,
} from "@ad-wiki/shared-types";
import { readFile, statfs } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import { PrismaService } from "@/prisma/prisma.service";
import { BackupCoordinationService } from "@/modules/backups/backup-coordination.service";
import { UPLOAD_DIR } from "@/modules/media/media.config";

interface Metric {
  count: number;
  durationMs: number;
  durationBuckets: number[];
}

const API_PREFIX = "/api/v1";
const DAY_MS = 24 * 60 * 60 * 1_000;
const HTTP_DURATION_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];

@Injectable()
export class MonitoringService {
  private readonly startedAt = Date.now();
  private readonly http = new Map<string, Metric>();
  private smtpSuccessCount = 0;
  private smtpFailureCount = 0;
  private smtpLastSuccessAt: Date | null = null;
  private smtpLastFailureAt: Date | null = null;
  private auditSuccessCount = 0;
  private auditFailureCount = 0;
  private auditLastSuccessAt: Date | null = null;
  private auditLastFailureAt: Date | null = null;
  private loginSuccessCount = 0;
  private loginFailureCount = 0;
  private unauthorizedCount = 0;
  private forbiddenCount = 0;
  private rateLimitedCount = 0;
  private apiKeySuccessCount = 0;
  private apiKeyFailureCount = 0;
  private mcpAuthSuccessCount = 0;
  private mcpAuthFailureCount = 0;
  private mcpRequestSuccessCount = 0;
  private mcpRequestFailureCount = 0;
  private mcpRateLimitedCount = 0;
  private securityLastEventAt: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly coordination: BackupCoordinationService,
  ) {}

  recordHttp(method: string, route: string, statusCode: number, durationMs: number): void {
    const key = `${method}|${route}|${statusCode}|${Math.floor(statusCode / 100)}xx`;
    const current = this.http.get(key) ?? {
      count: 0,
      durationMs: 0,
      durationBuckets: HTTP_DURATION_BUCKETS_MS.map(() => 0),
    };
    current.count += 1;
    current.durationMs += durationMs;
    HTTP_DURATION_BUCKETS_MS.forEach((bucket, index) => {
      if (durationMs <= bucket) current.durationBuckets[index] += 1;
    });
    this.http.set(key, current);
  }

  /** Erfasst ausschließlich das Ergebnis eines SMTP-Versands, niemals Empfänger oder Inhalte. */
  recordSmtpDelivery(success: boolean, at = new Date()): void {
    if (success) {
      this.smtpSuccessCount += 1;
      this.smtpLastSuccessAt = at;
      return;
    }
    this.smtpFailureCount += 1;
    this.smtpLastFailureAt = at;
  }

  /** Erfasst den Audit-Schreibpfad ohne Aktion, Benutzer oder Nutzdaten als Label. */
  recordAuditWrite(success: boolean, at = new Date()): void {
    if (success) {
      this.auditSuccessCount += 1;
      this.auditLastSuccessAt = at;
      return;
    }
    this.auditFailureCount += 1;
    this.auditLastFailureAt = at;
  }

  /** Erfasst Login-Ergebnisse ohne Benutzer-, E-Mail- oder IP-Bezug. */
  recordLoginAttempt(success: boolean, at = new Date()): void {
    if (success) this.loginSuccessCount += 1;
    else this.loginFailureCount += 1;
    this.securityLastEventAt = at;
  }

  /** Erfasst ausschließlich sicherheitsrelevante HTTP-Statuscodes. */
  recordSecurityHttpResponse(statusCode: number, at = new Date()): void {
    if (statusCode === 401) this.unauthorizedCount += 1;
    else if (statusCode === 403) this.forbiddenCount += 1;
    else if (statusCode === 429) this.rateLimitedCount += 1;
    else return;
    this.securityLastEventAt = at;
  }

  /** Erfasst API-Key-Prüfungen ohne Schlüssel, Besitzer oder Route. */
  recordApiKeyAuthentication(success: boolean, at = new Date()): void {
    if (success) this.apiKeySuccessCount += 1;
    else this.apiKeyFailureCount += 1;
    this.securityLastEventAt = at;
  }

  /** Erfasst MCP-Tokenprüfungen ohne Token-ID, Client oder Benutzer. */
  recordMcpAuthentication(success: boolean, at = new Date()): void {
    if (success) this.mcpAuthSuccessCount += 1;
    else this.mcpAuthFailureCount += 1;
    this.securityLastEventAt = at;
  }

  /** Erfasst MCP-Transportergebnisse mit einer fest begrenzten Ergebnismenge. */
  recordMcpRequest(
    result: "success" | "auth_failure" | "forbidden" | "rate_limited" | "transport_error",
    at = new Date(),
  ): void {
    if (result === "success") this.mcpRequestSuccessCount += 1;
    else this.mcpRequestFailureCount += 1;
    if (result === "rate_limited") this.mcpRateLimitedCount += 1;
    this.securityLastEventAt = at;
  }

  /** Liefert denselben Betriebszustand, den auch die Prometheus-Metriken abbilden. */
  async systemInfo(): Promise<SystemInfo> {
    const staleBackupAfterHours = positiveNumber(process.env.BACKUP_STALE_AFTER_HOURS, 26);
    const [database, redis, backup, certificate, capacity, smtp, audit] = await Promise.all([
      this.databaseStatus(),
      this.redisStatus(),
      this.backupStatus(staleBackupAfterHours),
      this.certificateStatus(),
      this.capacityStatus(),
      this.smtpStatus(),
      this.auditStatus(),
    ]);
    const security = this.securityStatus();
    const services: SystemDependency[] = [
      { id: "api", status: "healthy", latencyMs: 0, mode: "native" },
      database,
      redis,
    ];
    const states: SystemHealthStatus[] = [
      ...services.map((service) => service.status),
      backup.status,
      certificate.status,
      capacity.status,
      smtp.status,
      audit.status,
    ];

    return {
      status: states.includes("critical")
        ? "critical"
        : states.includes("warning") || backup.status === "unknown"
          ? "warning"
          : "healthy",
      generatedAt: new Date().toISOString(),
      version: process.env.AD_WIKI_VERSION?.trim() || "0.1.0",
      environment: process.env.NODE_ENV?.trim() || "development",
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1_000),
      staleBackupAfterHours,
      services,
      backup,
      certificate,
      capacity,
      smtp,
      audit,
      security,
      monitoring: {
        livePath: `${API_PREFIX}/health/live`,
        readyPath: `${API_PREFIX}/health/ready`,
        metricsPath: `${API_PREFIX}/health/metrics`,
        metricsProtected: Boolean(process.env.MONITORING_TOKEN?.trim()) || process.env.NODE_ENV === "production",
        prometheusCompatible: true,
        zabbixCompatible: true,
      },
    };
  }

  async prometheus(): Promise<string> {
    const info = await this.systemInfo();
    const backup = info.backup;
    const lines = [
      "# HELP ad_wiki_build_info AD-Wiki build and runtime information.",
      "# TYPE ad_wiki_build_info gauge",
      `ad_wiki_build_info{version="${escapeLabel(info.version)}",node_version="${escapeLabel(process.version)}"} 1`,
      "# HELP ad_wiki_api_uptime_seconds Process uptime in seconds.",
      "# TYPE ad_wiki_api_uptime_seconds gauge",
      `ad_wiki_api_uptime_seconds ${info.uptimeSeconds}`,
      "# HELP ad_wiki_http_requests_total Completed HTTP requests.",
      "# TYPE ad_wiki_http_requests_total counter",
      "# HELP ad_wiki_http_request_duration_milliseconds_total Sum of HTTP request durations.",
      "# TYPE ad_wiki_http_request_duration_milliseconds_total counter",
      "# HELP ad_wiki_http_request_duration_seconds HTTP request duration histogram.",
      "# TYPE ad_wiki_http_request_duration_seconds histogram",
    ];
    for (const [key, metric] of this.http) {
      const [method = "", route = "", statusCode = "", statusClass = ""] = key.split("|");
      const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status_code="${escapeLabel(statusCode)}",status_class="${escapeLabel(statusClass)}"`;
      lines.push(`ad_wiki_http_requests_total{${labels}} ${metric.count}`);
      lines.push(`ad_wiki_http_request_duration_milliseconds_total{${labels}} ${metric.durationMs}`);
      HTTP_DURATION_BUCKETS_MS.forEach((bucket, index) => {
        lines.push(
          `ad_wiki_http_request_duration_seconds_bucket{${labels},le="${bucket / 1_000}"} ${metric.durationBuckets[index]}`,
        );
      });
      lines.push(`ad_wiki_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${metric.count}`);
      lines.push(`ad_wiki_http_request_duration_seconds_sum{${labels}} ${metric.durationMs / 1_000}`);
      lines.push(`ad_wiki_http_request_duration_seconds_count{${labels}} ${metric.count}`);
    }
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    lines.push(
      "# HELP ad_wiki_process_resident_memory_bytes Resident memory size of the API process.",
      "# TYPE ad_wiki_process_resident_memory_bytes gauge",
      `ad_wiki_process_resident_memory_bytes ${memory.rss}`,
      "# HELP ad_wiki_process_heap_used_bytes Used JavaScript heap of the API process.",
      "# TYPE ad_wiki_process_heap_used_bytes gauge",
      `ad_wiki_process_heap_used_bytes ${memory.heapUsed}`,
      "# HELP ad_wiki_process_heap_total_bytes Allocated JavaScript heap of the API process.",
      "# TYPE ad_wiki_process_heap_total_bytes gauge",
      `ad_wiki_process_heap_total_bytes ${memory.heapTotal}`,
      "# HELP ad_wiki_process_cpu_user_seconds_total User CPU time consumed by the API process.",
      "# TYPE ad_wiki_process_cpu_user_seconds_total counter",
      `ad_wiki_process_cpu_user_seconds_total ${cpu.user / 1_000_000}`,
      "# HELP ad_wiki_process_cpu_system_seconds_total System CPU time consumed by the API process.",
      "# TYPE ad_wiki_process_cpu_system_seconds_total counter",
      `ad_wiki_process_cpu_system_seconds_total ${cpu.system / 1_000_000}`,
    );
    for (const service of info.services.filter((item) => item.id !== "api")) {
      lines.push(
        "# HELP ad_wiki_dependency_up Whether a required API dependency is reachable.",
        "# TYPE ad_wiki_dependency_up gauge",
        `ad_wiki_dependency_up{dependency="${service.id}"} ${service.status === "healthy" ? 1 : 0}`,
        "# HELP ad_wiki_dependency_latency_milliseconds Dependency health-check duration.",
        "# TYPE ad_wiki_dependency_latency_milliseconds gauge",
        `ad_wiki_dependency_latency_milliseconds{dependency="${service.id}"} ${service.latencyMs ?? 0}`,
      );
    }
    lines.push(
      "# HELP ad_wiki_backup_failures_total Persisted failed backup jobs.",
      "# TYPE ad_wiki_backup_failures_total gauge",
      `ad_wiki_backup_failures_total ${backup.failureCount}`,
      "# HELP ad_wiki_backup_available_artifacts Available verified backup artifacts.",
      "# TYPE ad_wiki_backup_available_artifacts gauge",
      `ad_wiki_backup_available_artifacts ${backup.availableArtifacts}`,
      "# HELP ad_wiki_backup_active_jobs Queued or running backup jobs.",
      "# TYPE ad_wiki_backup_active_jobs gauge",
      `ad_wiki_backup_active_jobs ${backup.activeJobs}`,
      "# HELP ad_wiki_backup_queued_jobs Backup worker jobs waiting to be processed.",
      "# TYPE ad_wiki_backup_queued_jobs gauge",
      `ad_wiki_backup_queued_jobs ${backup.queuedJobs}`,
      "# HELP ad_wiki_backup_running_jobs Backup worker jobs currently running.",
      "# TYPE ad_wiki_backup_running_jobs gauge",
      `ad_wiki_backup_running_jobs ${backup.runningJobs}`,
      "# HELP ad_wiki_backup_oldest_queued_age_seconds Age of the oldest queued worker job.",
      "# TYPE ad_wiki_backup_oldest_queued_age_seconds gauge",
      `ad_wiki_backup_oldest_queued_age_seconds ${backup.oldestQueuedAgeSeconds ?? 0}`,
      "# HELP ad_wiki_backup_enabled_plans Enabled backup schedules.",
      "# TYPE ad_wiki_backup_enabled_plans gauge",
      `ad_wiki_backup_enabled_plans ${backup.enabledPlans}`,
      "# HELP ad_wiki_backup_overdue_plans Enabled backup schedules overdue beyond the grace period.",
      "# TYPE ad_wiki_backup_overdue_plans gauge",
      `ad_wiki_backup_overdue_plans ${backup.overduePlans}`,
      "# HELP ad_wiki_backup_worker_up Whether the backup worker heartbeat is current.",
      "# TYPE ad_wiki_backup_worker_up gauge",
      `ad_wiki_backup_worker_up ${backup.workerAvailable ? 1 : 0}`,
      "# HELP ad_wiki_backup_worker_last_heartbeat_timestamp_seconds Last backup worker heartbeat.",
      "# TYPE ad_wiki_backup_worker_last_heartbeat_timestamp_seconds gauge",
      `ad_wiki_backup_worker_last_heartbeat_timestamp_seconds ${timestampSeconds(backup.workerLastSeenAt)}`,
      "# HELP ad_wiki_backup_worker_heartbeat_age_seconds Age of the last backup worker heartbeat.",
      "# TYPE ad_wiki_backup_worker_heartbeat_age_seconds gauge",
      `ad_wiki_backup_worker_heartbeat_age_seconds ${backup.workerHeartbeatAgeSeconds ?? 0}`,
      "# HELP ad_wiki_backup_last_success_timestamp_seconds Last successful backup completion.",
      "# TYPE ad_wiki_backup_last_success_timestamp_seconds gauge",
      `ad_wiki_backup_last_success_timestamp_seconds ${timestampSeconds(backup.lastSuccessAt)}`,
      "# HELP ad_wiki_backup_last_success_age_seconds Age of the last successful backup.",
      "# TYPE ad_wiki_backup_last_success_age_seconds gauge",
      `ad_wiki_backup_last_success_age_seconds ${backup.lastSuccessAgeSeconds ?? 0}`,
      "# HELP ad_wiki_backup_last_duration_seconds Duration of the last successful backup.",
      "# TYPE ad_wiki_backup_last_duration_seconds gauge",
      `ad_wiki_backup_last_duration_seconds ${backup.lastDurationSeconds ?? 0}`,
      "# HELP ad_wiki_backup_last_size_bytes Size of the last successful backup artifact.",
      "# TYPE ad_wiki_backup_last_size_bytes gauge",
      `ad_wiki_backup_last_size_bytes ${backup.lastSizeBytes ?? "0"}`,
      "# HELP ad_wiki_backup_last_failure_timestamp_seconds Last failed backup completion.",
      "# TYPE ad_wiki_backup_last_failure_timestamp_seconds gauge",
      `ad_wiki_backup_last_failure_timestamp_seconds ${timestampSeconds(backup.lastFailureAt)}`,
      "# HELP ad_wiki_backup_latest_failure_open Whether the latest backup result is a failure.",
      "# TYPE ad_wiki_backup_latest_failure_open gauge",
      `ad_wiki_backup_latest_failure_open ${backup.latestFailureOpen ? 1 : 0}`,
      "# HELP ad_wiki_backup_stale Whether the latest successful backup exceeds the configured RPO window.",
      "# TYPE ad_wiki_backup_stale gauge",
      `ad_wiki_backup_stale ${backup.stale ? 1 : 0}`,
      "# HELP ad_wiki_backup_stale_after_seconds Configured freshness threshold.",
      "# TYPE ad_wiki_backup_stale_after_seconds gauge",
      `ad_wiki_backup_stale_after_seconds ${info.staleBackupAfterHours * 60 * 60}`,
      "# HELP ad_wiki_tls_certificate_configured Whether the API can inspect the active TLS certificate.",
      "# TYPE ad_wiki_tls_certificate_configured gauge",
      `ad_wiki_tls_certificate_configured ${info.certificate.validUntil ? 1 : 0}`,
      "# HELP ad_wiki_tls_certificate_expiry_timestamp_seconds TLS certificate expiry time.",
      "# TYPE ad_wiki_tls_certificate_expiry_timestamp_seconds gauge",
      `ad_wiki_tls_certificate_expiry_timestamp_seconds ${timestampSeconds(info.certificate.validUntil)}`,
      "# HELP ad_wiki_tls_certificate_days_remaining Full days until TLS certificate expiry.",
      "# TYPE ad_wiki_tls_certificate_days_remaining gauge",
      `ad_wiki_tls_certificate_days_remaining ${info.certificate.daysRemaining ?? 0}`,
      "# HELP ad_wiki_media_files Stored media records.",
      "# TYPE ad_wiki_media_files gauge",
      `ad_wiki_media_files ${info.capacity.mediaCount}`,
      "# HELP ad_wiki_media_bytes Total logical size of stored media records.",
      "# TYPE ad_wiki_media_bytes gauge",
      `ad_wiki_media_bytes ${info.capacity.mediaTotalBytes}`,
      "# HELP ad_wiki_upload_filesystem_size_bytes Size of the upload filesystem visible to the API.",
      "# TYPE ad_wiki_upload_filesystem_size_bytes gauge",
      `ad_wiki_upload_filesystem_size_bytes ${info.capacity.uploadFilesystemSizeBytes ?? "0"}`,
      "# HELP ad_wiki_upload_filesystem_inspectable Whether the API can inspect the upload filesystem.",
      "# TYPE ad_wiki_upload_filesystem_inspectable gauge",
      `ad_wiki_upload_filesystem_inspectable ${info.capacity.uploadFilesystemSizeBytes ? 1 : 0}`,
      "# HELP ad_wiki_upload_filesystem_free_bytes Free bytes on the upload filesystem.",
      "# TYPE ad_wiki_upload_filesystem_free_bytes gauge",
      `ad_wiki_upload_filesystem_free_bytes ${info.capacity.uploadFilesystemFreeBytes ?? "0"}`,
      "# HELP ad_wiki_upload_filesystem_free_ratio Free ratio of the upload filesystem.",
      "# TYPE ad_wiki_upload_filesystem_free_ratio gauge",
      `ad_wiki_upload_filesystem_free_ratio ${(info.capacity.uploadFilesystemFreePercent ?? 0) / 100}`,
      "# HELP ad_wiki_smtp_configured Whether an SMTP configuration exists.",
      "# TYPE ad_wiki_smtp_configured gauge",
      `ad_wiki_smtp_configured ${info.smtp.configured ? 1 : 0}`,
      "# HELP ad_wiki_smtp_enabled Whether SMTP delivery is enabled.",
      "# TYPE ad_wiki_smtp_enabled gauge",
      `ad_wiki_smtp_enabled ${info.smtp.enabled ? 1 : 0}`,
      "# HELP ad_wiki_smtp_delivery_attempts_total SMTP delivery attempts by result.",
      "# TYPE ad_wiki_smtp_delivery_attempts_total counter",
      `ad_wiki_smtp_delivery_attempts_total{result="success"} ${info.smtp.successCount}`,
      `ad_wiki_smtp_delivery_attempts_total{result="failure"} ${info.smtp.failureCount}`,
      "# HELP ad_wiki_smtp_last_success_timestamp_seconds Last successful SMTP delivery.",
      "# TYPE ad_wiki_smtp_last_success_timestamp_seconds gauge",
      `ad_wiki_smtp_last_success_timestamp_seconds ${timestampSeconds(info.smtp.lastSuccessAt)}`,
      "# HELP ad_wiki_smtp_latest_failure_open Whether the latest SMTP attempt failed.",
      "# TYPE ad_wiki_smtp_latest_failure_open gauge",
      `ad_wiki_smtp_latest_failure_open ${info.smtp.latestFailureOpen ? 1 : 0}`,
      "# HELP ad_wiki_audit_write_attempts_total Audit write attempts by result.",
      "# TYPE ad_wiki_audit_write_attempts_total counter",
      `ad_wiki_audit_write_attempts_total{result="success"} ${info.audit.successCount}`,
      `ad_wiki_audit_write_attempts_total{result="failure"} ${info.audit.failureCount}`,
      "# HELP ad_wiki_audit_database_readable Whether persisted audit entries can be queried.",
      "# TYPE ad_wiki_audit_database_readable gauge",
      `ad_wiki_audit_database_readable ${info.audit.databaseReadable ? 1 : 0}`,
      "# HELP ad_wiki_audit_entries Persisted audit log entries.",
      "# TYPE ad_wiki_audit_entries gauge",
      `ad_wiki_audit_entries ${info.audit.totalEntries}`,
      "# HELP ad_wiki_audit_last_success_timestamp_seconds Last successful audit log write.",
      "# TYPE ad_wiki_audit_last_success_timestamp_seconds gauge",
      `ad_wiki_audit_last_success_timestamp_seconds ${timestampSeconds(info.audit.lastEntryAt)}`,
      "# HELP ad_wiki_audit_latest_failure_open Whether the latest audit write failed.",
      "# TYPE ad_wiki_audit_latest_failure_open gauge",
      `ad_wiki_audit_latest_failure_open ${info.audit.latestFailureOpen ? 1 : 0}`,
      "# HELP ad_wiki_login_attempts_total Interactive login attempts by result.",
      "# TYPE ad_wiki_login_attempts_total counter",
      `ad_wiki_login_attempts_total{result="success"} ${info.security.loginSuccessCount}`,
      `ad_wiki_login_attempts_total{result="failure"} ${info.security.loginFailureCount}`,
      "# HELP ad_wiki_security_http_responses_total Security-relevant HTTP responses by fixed status code.",
      "# TYPE ad_wiki_security_http_responses_total counter",
      `ad_wiki_security_http_responses_total{status_code="401"} ${info.security.unauthorizedCount}`,
      `ad_wiki_security_http_responses_total{status_code="403"} ${info.security.forbiddenCount}`,
      `ad_wiki_security_http_responses_total{status_code="429"} ${info.security.rateLimitedCount}`,
      "# HELP ad_wiki_api_key_auth_attempts_total API key authentication attempts by result.",
      "# TYPE ad_wiki_api_key_auth_attempts_total counter",
      `ad_wiki_api_key_auth_attempts_total{result="success"} ${info.security.apiKeySuccessCount}`,
      `ad_wiki_api_key_auth_attempts_total{result="failure"} ${info.security.apiKeyFailureCount}`,
      "# HELP ad_wiki_mcp_auth_attempts_total MCP token authentication attempts by result.",
      "# TYPE ad_wiki_mcp_auth_attempts_total counter",
      `ad_wiki_mcp_auth_attempts_total{result="success"} ${info.security.mcpAuthSuccessCount}`,
      `ad_wiki_mcp_auth_attempts_total{result="failure"} ${info.security.mcpAuthFailureCount}`,
      "# HELP ad_wiki_mcp_requests_total MCP requests by coarse, bounded result.",
      "# TYPE ad_wiki_mcp_requests_total counter",
      `ad_wiki_mcp_requests_total{result="success"} ${info.security.mcpRequestSuccessCount}`,
      `ad_wiki_mcp_requests_total{result="failure"} ${info.security.mcpRequestFailureCount}`,
      "# HELP ad_wiki_mcp_request_failures_total Failed MCP requests with bounded result labels.",
      "# TYPE ad_wiki_mcp_request_failures_total counter",
      `ad_wiki_mcp_request_failures_total{result="auth_failure"} ${info.security.mcpAuthFailureCount}`,
      `ad_wiki_mcp_request_failures_total{result="rate_limited"} ${info.security.mcpRateLimitedCount}`,
      `ad_wiki_mcp_request_failures_total{result="other"} ${Math.max(
        0,
        info.security.mcpRequestFailureCount
          - info.security.mcpAuthFailureCount
          - info.security.mcpRateLimitedCount,
      )}`,
    );
    return `${deduplicateHelp(lines).join("\n")}\n`;
  }

  private async databaseStatus(): Promise<SystemDependency> {
    const started = performance.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { id: "database", status: "healthy", latencyMs: elapsedMilliseconds(started), mode: "native" };
    } catch {
      return { id: "database", status: "critical", latencyMs: elapsedMilliseconds(started), mode: "native" };
    }
  }

  private async redisStatus(): Promise<SystemDependency> {
    const started = performance.now();
    const health = await this.coordination.health();
    return {
      id: "redis",
      status: health.available ? "healthy" : "critical",
      latencyMs: elapsedMilliseconds(started),
      mode: health.mode,
    };
  }

  private async backupStatus(staleAfterHours: number): Promise<SystemBackupStatus> {
    try {
      const now = new Date();
      const workerStaleAfterSeconds = positiveNumber(
        process.env.BACKUP_WORKER_STALE_AFTER_SECONDS,
        60,
      );
      const scheduleGraceMinutes = positiveNumber(
        process.env.BACKUP_SCHEDULE_GRACE_MINUTES,
        5,
      );
      const overdueBefore = new Date(now.getTime() - scheduleGraceMinutes * 60 * 1_000);
      const [
        lastSuccess,
        lastFailure,
        failureCount,
        availableArtifacts,
        queuedJobs,
        runningJobs,
        oldestQueued,
        enabledPlans,
        overduePlans,
        workerLastSeen,
      ] =
        await Promise.all([
          this.prisma.backupJob.findFirst({
            where: { operation: BackupJobOperation.BACKUP, status: BackupJobStatus.SUCCEEDED },
            orderBy: { finishedAt: "desc" },
            select: { startedAt: true, finishedAt: true, artifactSize: true },
          }),
          this.prisma.backupJob.findFirst({
            where: { operation: BackupJobOperation.BACKUP, status: BackupJobStatus.FAILED },
            orderBy: { finishedAt: "desc" },
            select: { finishedAt: true, errorCode: true },
          }),
          this.prisma.backupJob.count({
            where: { operation: BackupJobOperation.BACKUP, status: BackupJobStatus.FAILED },
          }),
          this.prisma.backupJob.count({
            where: {
              operation: BackupJobOperation.BACKUP,
              status: BackupJobStatus.SUCCEEDED,
              artifactPath: { not: null },
            },
          }),
          this.prisma.backupJob.count({
            where: { status: BackupJobStatus.QUEUED },
          }),
          this.prisma.backupJob.count({
            where: { status: BackupJobStatus.RUNNING },
          }),
          this.prisma.backupJob.findFirst({
            where: { status: BackupJobStatus.QUEUED },
            orderBy: { createdAt: "asc" },
            select: { createdAt: true },
          }),
          this.prisma.backupPlan.count({ where: { enabled: true } }),
          this.prisma.backupPlan.count({
            where: { enabled: true, nextRunAt: { lt: overdueBefore } },
          }),
          this.coordination.workerHeartbeat(),
        ]);
      const lastSuccessAt = lastSuccess?.finishedAt ?? null;
      const lastFailureAt = lastFailure?.finishedAt ?? null;
      const lastSuccessAgeSeconds = lastSuccessAt
        ? Math.max(0, Math.floor((now.getTime() - lastSuccessAt.getTime()) / 1_000))
        : null;
      const oldestQueuedAgeSeconds = oldestQueued?.createdAt
        ? Math.max(0, Math.floor((now.getTime() - oldestQueued.createdAt.getTime()) / 1_000))
        : null;
      const workerHeartbeatAgeSeconds = workerLastSeen
        ? Math.max(0, Math.floor((now.getTime() - workerLastSeen.getTime()) / 1_000))
        : null;
      const workerAvailable = workerHeartbeatAgeSeconds !== null
        && workerHeartbeatAgeSeconds <= workerStaleAfterSeconds;
      const latestFailureOpen = Boolean(
        lastFailureAt && (!lastSuccessAt || lastFailureAt > lastSuccessAt),
      );
      const stale = lastSuccessAgeSeconds === null
        || lastSuccessAgeSeconds > staleAfterHours * 60 * 60;
      const activeJobs = queuedJobs + runningJobs;
      const operationsWarning = overduePlans > 0
        || (enabledPlans > 0 && !workerAvailable)
        || (oldestQueuedAgeSeconds !== null && oldestQueuedAgeSeconds > 5 * 60);

      return {
        status: latestFailureOpen
          ? "critical"
          : stale || operationsWarning
            ? "warning"
            : "healthy",
        activeJobs,
        queuedJobs,
        runningJobs,
        oldestQueuedAgeSeconds,
        enabledPlans,
        overduePlans,
        availableArtifacts,
        workerAvailable,
        workerLastSeenAt: workerLastSeen?.toISOString() ?? null,
        workerHeartbeatAgeSeconds,
        lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
        lastSuccessAgeSeconds,
        lastDurationSeconds: lastSuccess?.startedAt && lastSuccessAt
          ? Math.max(0, (lastSuccessAt.getTime() - lastSuccess.startedAt.getTime()) / 1_000)
          : null,
        lastSizeBytes: lastSuccess?.artifactSize?.toString() ?? null,
        lastFailureAt: lastFailureAt?.toISOString() ?? null,
        lastFailureCode: lastFailure?.errorCode ?? null,
        latestFailureOpen,
        stale,
        failureCount,
      };
    } catch {
      return {
        status: "unknown",
        activeJobs: 0,
        queuedJobs: 0,
        runningJobs: 0,
        oldestQueuedAgeSeconds: null,
        enabledPlans: 0,
        overduePlans: 0,
        availableArtifacts: 0,
        workerAvailable: false,
        workerLastSeenAt: null,
        workerHeartbeatAgeSeconds: null,
        lastSuccessAt: null,
        lastSuccessAgeSeconds: null,
        lastDurationSeconds: null,
        lastSizeBytes: null,
        lastFailureAt: null,
        lastFailureCode: null,
        latestFailureOpen: false,
        stale: true,
        failureCount: 0,
      };
    }
  }

  private async capacityStatus(): Promise<SystemCapacityStatus> {
    try {
      const [media, filesystem] = await Promise.all([
        this.prisma.media.aggregate({
          _count: { _all: true },
          _sum: { size: true },
        }),
        statfs(UPLOAD_DIR, { bigint: true }).catch(() => null),
      ]);
      if (!filesystem) {
        return {
          status: "unknown",
          mediaCount: media._count._all,
          mediaTotalBytes: String(media._sum.size ?? 0),
          uploadFilesystemSizeBytes: null,
          uploadFilesystemFreeBytes: null,
          uploadFilesystemFreePercent: null,
        };
      }
      const sizeBytes = filesystem.blocks * filesystem.bsize;
      const freeBytes = filesystem.bavail * filesystem.bsize;
      const freePercent = sizeBytes > 0n
        ? Math.round((Number(freeBytes * 1_000n / sizeBytes) / 10) * 10) / 10
        : 0;
      const warningFreePercent = positiveNumber(
        process.env.UPLOAD_DISK_WARNING_FREE_PERCENT,
        15,
      );
      const criticalFreePercent = positiveNumber(
        process.env.UPLOAD_DISK_CRITICAL_FREE_PERCENT,
        8,
      );
      return {
        status: freePercent <= criticalFreePercent
          ? "critical"
          : freePercent <= warningFreePercent
            ? "warning"
            : "healthy",
        mediaCount: media._count._all,
        mediaTotalBytes: String(media._sum.size ?? 0),
        uploadFilesystemSizeBytes: sizeBytes.toString(),
        uploadFilesystemFreeBytes: freeBytes.toString(),
        uploadFilesystemFreePercent: freePercent,
      };
    } catch {
      return {
        status: "unknown",
        mediaCount: 0,
        mediaTotalBytes: "0",
        uploadFilesystemSizeBytes: null,
        uploadFilesystemFreeBytes: null,
        uploadFilesystemFreePercent: null,
      };
    }
  }

  private async smtpStatus(): Promise<SystemSmtpStatus> {
    try {
      const configuration = await this.prisma.smtpConfiguration.findUnique({
        where: { id: "default" },
        select: { isEnabled: true },
      });
      const latestFailureOpen = Boolean(
        this.smtpLastFailureAt
        && (!this.smtpLastSuccessAt || this.smtpLastFailureAt > this.smtpLastSuccessAt),
      );
      return {
        status: !configuration || !configuration.isEnabled
          ? "unknown"
          : latestFailureOpen
            ? "warning"
            : this.smtpLastSuccessAt
              ? "healthy"
              : "unknown",
        configured: configuration !== null,
        enabled: configuration?.isEnabled ?? false,
        successCount: this.smtpSuccessCount,
        failureCount: this.smtpFailureCount,
        lastSuccessAt: this.smtpLastSuccessAt?.toISOString() ?? null,
        lastFailureAt: this.smtpLastFailureAt?.toISOString() ?? null,
        latestFailureOpen,
      };
    } catch {
      return {
        status: "unknown",
        configured: false,
        enabled: false,
        successCount: this.smtpSuccessCount,
        failureCount: this.smtpFailureCount,
        lastSuccessAt: this.smtpLastSuccessAt?.toISOString() ?? null,
        lastFailureAt: this.smtpLastFailureAt?.toISOString() ?? null,
        latestFailureOpen: false,
      };
    }
  }

  private async auditStatus(): Promise<SystemAuditStatus> {
    const latestFailureOpen = Boolean(
      this.auditLastFailureAt
      && (!this.auditLastSuccessAt || this.auditLastFailureAt > this.auditLastSuccessAt),
    );
    try {
      const [totalEntries, lastEntry] = await Promise.all([
        this.prisma.auditLog.count(),
        this.prisma.auditLog.findFirst({
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
      ]);
      return {
        status: latestFailureOpen ? "critical" : "healthy",
        databaseReadable: true,
        totalEntries,
        lastEntryAt: lastEntry?.createdAt.toISOString() ?? null,
        successCount: this.auditSuccessCount,
        failureCount: this.auditFailureCount,
        lastSuccessAt: this.auditLastSuccessAt?.toISOString() ?? null,
        lastFailureAt: this.auditLastFailureAt?.toISOString() ?? null,
        latestFailureOpen,
      };
    } catch {
      return {
        status: latestFailureOpen ? "critical" : "unknown",
        databaseReadable: false,
        totalEntries: 0,
        lastEntryAt: null,
        successCount: this.auditSuccessCount,
        failureCount: this.auditFailureCount,
        lastSuccessAt: this.auditLastSuccessAt?.toISOString() ?? null,
        lastFailureAt: this.auditLastFailureAt?.toISOString() ?? null,
        latestFailureOpen,
      };
    }
  }

  private securityStatus(): SystemSecurityStatus {
    return {
      status: "healthy",
      loginSuccessCount: this.loginSuccessCount,
      loginFailureCount: this.loginFailureCount,
      unauthorizedCount: this.unauthorizedCount,
      forbiddenCount: this.forbiddenCount,
      rateLimitedCount: this.rateLimitedCount,
      apiKeySuccessCount: this.apiKeySuccessCount,
      apiKeyFailureCount: this.apiKeyFailureCount,
      mcpAuthSuccessCount: this.mcpAuthSuccessCount,
      mcpAuthFailureCount: this.mcpAuthFailureCount,
      mcpRequestSuccessCount: this.mcpRequestSuccessCount,
      mcpRequestFailureCount: this.mcpRequestFailureCount,
      mcpRateLimitedCount: this.mcpRateLimitedCount,
      lastEventAt: this.securityLastEventAt?.toISOString() ?? null,
    };
  }

  private async certificateStatus(): Promise<SystemCertificateStatus> {
    const certificatePath = process.env.TLS_CERT_FILE?.trim();
    if (!certificatePath) return emptyCertificate("unknown");
    try {
      const certificate = new X509Certificate(await readFile(certificatePath));
      const validFrom = new Date(certificate.validFrom);
      const validUntil = new Date(certificate.validTo);
      if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime())) {
        return emptyCertificate("critical");
      }
      const daysRemaining = Math.floor((validUntil.getTime() - Date.now()) / DAY_MS);
      return {
        status: daysRemaining <= 7 ? "critical" : daysRemaining <= 30 ? "warning" : "healthy",
        subject: certificate.subject,
        issuer: certificate.issuer,
        validFrom: validFrom.toISOString(),
        validUntil: validUntil.toISOString(),
        daysRemaining,
        fingerprintSha256: certificate.fingerprint256,
        subjectAltName: certificate.subjectAltName ?? null,
        selfSigned: certificate.subject === certificate.issuer,
      };
    } catch {
      return emptyCertificate("critical");
    }
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function emptyCertificate(status: SystemHealthStatus): SystemCertificateStatus {
  return {
    status,
    subject: null,
    issuer: null,
    validFrom: null,
    validUntil: null,
    daysRemaining: null,
    fingerprintSha256: null,
    subjectAltName: null,
    selfSigned: null,
  };
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function elapsedMilliseconds(started: number): number {
  return Math.max(0, Math.round((performance.now() - started) * 10) / 10);
}

function timestampSeconds(value: string | null): number {
  return value ? Math.floor(new Date(value).getTime() / 1_000) : 0;
}

/** Entfernt wiederholte HELP/TYPE-Zeilen bei gelabelten Serien. */
function deduplicateHelp(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    if (!line.startsWith("# HELP ") && !line.startsWith("# TYPE ")) return true;
    if (seen.has(line)) return false;
    seen.add(line);
    return true;
  });
}
