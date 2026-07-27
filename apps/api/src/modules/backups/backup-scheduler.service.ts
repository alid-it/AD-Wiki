import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import {
  BackupJobOperation,
  BackupJobStatus,
  BackupJobTrigger,
  Prisma,
} from "@prisma/client";
import type { BackupSchedule } from "@ad-wiki/shared-types";
import { PrismaService } from "@/prisma/prisma.service";
import { BackupCoordinationService } from "@/modules/backups/backup-coordination.service";
import { nextScheduledRun } from "@/modules/backups/backup-schedule";
import { NotificationService } from "@/modules/websocket/notification.service";

const SCHEDULER_INTERVAL_MS = 30_000;
const SCHEDULER_LOCK_MS = 25_000;

/** Plant faellige Backup-Auftraege genau einmal und meldet neue Fehler an Admins. */
@Injectable()
export class BackupSchedulerService {
  private readonly logger = new Logger(BackupSchedulerService.name);
  private readonly startedAt = new Date();
  private readonly notifiedFailures = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly coordination: BackupCoordinationService,
    private readonly notifications: NotificationService,
  ) {}

  @Interval(SCHEDULER_INTERVAL_MS)
  async runCycle(): Promise<void> {
    await this.notifyNewFailures();
    const lock = await this.coordination.acquireLock("scheduler", SCHEDULER_LOCK_MS);
    if (!lock) return;
    try {
      await this.scheduleDuePlans(new Date());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Backup-Zeitplaene konnten nicht verarbeitet werden: ${message}`);
    } finally {
      await this.coordination.releaseLock("scheduler", lock);
    }
  }

  async scheduleDuePlans(now: Date): Promise<number> {
    const plans = await this.prisma.backupPlan.findMany({
      where: { enabled: true },
      include: { destination: { select: { id: true, isEnabled: true } } },
      orderBy: { createdAt: "asc" },
    });
    let scheduled = 0;
    for (const plan of plans) {
      const schedule = this.scheduleOf(plan);
      if (!plan.nextRunAt) {
        await this.prisma.backupPlan.updateMany({
          where: { id: plan.id, enabled: true, nextRunAt: null },
          data: { nextRunAt: nextScheduledRun(schedule, now) },
        });
        continue;
      }
      if (plan.nextRunAt.getTime() > now.getTime()) continue;

      const dueAt = plan.nextRunAt;
      const nextRunAt = nextScheduledRun(schedule, now);
      try {
        const created = await this.prisma.$transaction(async (transaction) => {
          const claimed = await transaction.backupPlan.updateMany({
            where: { id: plan.id, enabled: true, nextRunAt: dueAt },
            data: { nextRunAt, lastRunAt: now },
          });
          if (claimed.count !== 1) return false;
          const job = await transaction.backupJob.create({
            data: {
              operation: BackupJobOperation.BACKUP,
              trigger: BackupJobTrigger.SCHEDULED,
              status: BackupJobStatus.QUEUED,
              planId: plan.id,
              destinationId: plan.destination.id,
              scheduledFor: dueAt,
            },
          });
          await transaction.auditLog.create({
            data: {
              action: "backup_job.started",
              resource: "backup_job",
              resourceId: job.id,
              details: {
                planId: plan.id,
                destinationId: plan.destination.id,
                trigger: "scheduled",
                scheduledFor: dueAt.toISOString(),
              } satisfies Prisma.InputJsonObject,
            },
          });
          return true;
        });
        if (created) scheduled += 1;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
          throw error;
        }
      }
    }
    return scheduled;
  }

  private async notifyNewFailures(): Promise<void> {
    const failures = await this.prisma.backupJob.findMany({
      where: { status: BackupJobStatus.FAILED, finishedAt: { gte: this.startedAt } },
      select: { id: true, errorCode: true },
      orderBy: { finishedAt: "asc" },
      take: 100,
    });
    for (const failure of failures) {
      if (this.notifiedFailures.has(failure.id)) continue;
      this.notifiedFailures.add(failure.id);
      this.notifications.notifyBackupFailed(failure.id, failure.errorCode);
    }
  }

  private scheduleOf(plan: {
    scheduleHour: number;
    scheduleMinute: number;
    timezone: string;
    weekdays: number[];
  }): BackupSchedule {
    return {
      hour: plan.scheduleHour,
      minute: plan.scheduleMinute,
      timezone: plan.timezone,
      weekdays: plan.weekdays,
    };
  }
}
