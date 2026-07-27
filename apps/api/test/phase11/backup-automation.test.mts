import assert from "node:assert/strict";
import test from "node:test";
import { BackupDestinationType } from "@prisma/client";
import { BackupCoordinationService } from "../../dist/modules/backups/backup-coordination.service.js";
import { expiredBackupJobIds } from "../../dist/modules/backups/backup-retention.js";
import { nextScheduledRun } from "../../dist/modules/backups/backup-schedule.js";
import { BackupSchedulerService } from "../../dist/modules/backups/backup-scheduler.service.js";

const PLAN_ID = "10000000-0000-4000-8000-000000000001";
const DESTINATION_ID = "20000000-0000-4000-8000-000000000002";

test("DST-Sommerluecke wird uebersprungen und die doppelte Herbstminute nur einmal geplant", () => {
  const schedule = { hour: 2, minute: 30, timezone: "Europe/Berlin", weekdays: [7] };
  assert.equal(
    nextScheduledRun(schedule, new Date("2026-03-28T00:00:00.000Z")).toISOString(),
    "2026-04-05T00:30:00.000Z",
  );

  const firstAutumnRun = nextScheduledRun(schedule, new Date("2026-10-24T00:00:00.000Z"));
  assert.equal(firstAutumnRun.toISOString(), "2026-10-25T00:30:00.000Z");
  assert.equal(
    nextScheduledRun(schedule, firstAutumnRun).toISOString(),
    "2026-11-01T01:30:00.000Z",
  );
});

test("mehrere Scheduler-Instanzen erzeugen fuer denselben Faelligkeitstermin nur einen Job", async () => {
  const dueAt = new Date("2026-07-22T08:00:00.000Z");
  const now = new Date("2026-07-22T08:00:05.000Z");
  let claimed = false;
  let jobs = 0;
  const plan = {
    id: PLAN_ID,
    enabled: true,
    scheduleHour: 10,
    scheduleMinute: 0,
    timezone: "Europe/Berlin",
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    nextRunAt: dueAt,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    destination: { id: DESTINATION_ID, isEnabled: true, type: BackupDestinationType.LOCAL },
  };
  const transaction = {
    backupPlan: {
      updateMany: async () => {
        if (claimed) return { count: 0 };
        claimed = true;
        return { count: 1 };
      },
    },
    backupJob: {
      create: async () => {
        jobs += 1;
        return { id: "30000000-0000-4000-8000-000000000003" };
      },
    },
    auditLog: { create: async () => ({}) },
  };
  const prisma = {
    backupPlan: { findMany: async () => [plan] },
    $transaction: async (callback: (client: typeof transaction) => Promise<boolean>) => callback(transaction),
  };
  const service = new BackupSchedulerService(
    prisma as unknown as ConstructorParameters<typeof BackupSchedulerService>[0],
    {} as ConstructorParameters<typeof BackupSchedulerService>[1],
    {} as ConstructorParameters<typeof BackupSchedulerService>[2],
  );

  const results = await Promise.all([service.scheduleDuePlans(now), service.scheduleDuePlans(now)]);
  assert.equal(results.reduce((sum, value) => sum + value, 0), 1);
  assert.equal(jobs, 1);
});

test("Aufbewahrung behaelt die Vereinigung aus Tages-, Wochen- und Monatsstaenden", () => {
  const jobs = [
    ["1", "2026-07-22T08:00:00.000Z"],
    ["2", "2026-07-21T08:00:00.000Z"],
    ["3", "2026-07-15T08:00:00.000Z"],
    ["4", "2026-06-15T08:00:00.000Z"],
    ["5", "2026-05-15T08:00:00.000Z"],
  ].map(([id, createdAt]) => ({ id, createdAt: new Date(createdAt) }));
  const expired = expiredBackupJobIds(jobs, { daily: 2, weekly: 1, monthly: 2 }, "Europe/Berlin");
  assert.deepEqual(expired, ["3", "5"]);
});

test("Schreibschutz wird nach Freigabe nicht dauerhaft zurueckgelassen", async () => {
  const coordination = new BackupCoordinationService();
  const barrier = await coordination.acquireWriteBarrier(60_000);
  assert.notEqual(barrier, null);
  assert.equal(await coordination.enterWrite(), false);
  await coordination.releaseWriteBarrier(String(barrier));
  assert.equal(await coordination.enterWrite(), true);
  await coordination.leaveWrite();
});
