import { z } from 'zod';
import {
  BackupDestinationSchema,
  BackupJobSchema,
  BackupOverviewSchema,
  BackupPlanSchema,
  RestoreRunbookSchema,
  type BackupDestination,
  type BackupJob,
  type BackupOverview,
  type BackupPlan,
  type RestoreRunbook,
  type CreateBackupDestinationInput,
  type CreateBackupPlanInput,
  type StartBackupJobInput,
  type UpdateBackupDestinationInput,
  type UpdateBackupPlanInput,
} from '@ad-wiki/shared-types';
import { requestData } from '../http';

const BASE = '/backups';

export function listDestinations(signal?: AbortSignal): Promise<BackupDestination[]> {
  return requestData(z.array(BackupDestinationSchema), `${BASE}/destinations`, { auth: true, signal });
}

export function createDestination(input: CreateBackupDestinationInput): Promise<BackupDestination> {
  return requestData(BackupDestinationSchema, `${BASE}/destinations`, {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export function updateDestination(id: string, input: UpdateBackupDestinationInput): Promise<BackupDestination> {
  return requestData(BackupDestinationSchema, `${BASE}/destinations/${id}`, {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}

export function deleteDestination(id: string): Promise<BackupDestination> {
  return requestData(BackupDestinationSchema, `${BASE}/destinations/${id}`, {
    method: 'DELETE',
    auth: true,
  });
}

export function testDestination(id: string): Promise<BackupJob> {
  return requestData(BackupJobSchema, `${BASE}/destinations/${id}/test`, {
    method: 'POST',
    auth: true,
  });
}

export function listPlans(signal?: AbortSignal): Promise<BackupPlan[]> {
  return requestData(z.array(BackupPlanSchema), `${BASE}/plans`, { auth: true, signal });
}

export function createPlan(input: CreateBackupPlanInput): Promise<BackupPlan> {
  return requestData(BackupPlanSchema, `${BASE}/plans`, {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export function updatePlan(id: string, input: UpdateBackupPlanInput): Promise<BackupPlan> {
  return requestData(BackupPlanSchema, `${BASE}/plans/${id}`, {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}

export function deletePlan(id: string): Promise<BackupPlan> {
  return requestData(BackupPlanSchema, `${BASE}/plans/${id}`, {
    method: 'DELETE',
    auth: true,
  });
}

export function listJobs(signal?: AbortSignal): Promise<BackupJob[]> {
  return requestData(z.array(BackupJobSchema), `${BASE}/jobs`, { auth: true, signal });
}

export function overview(signal?: AbortSignal): Promise<BackupOverview> {
  return requestData(BackupOverviewSchema, `${BASE}/overview`, { auth: true, signal });
}

export function getJob(id: string, signal?: AbortSignal): Promise<BackupJob> {
  return requestData(BackupJobSchema, `${BASE}/jobs/${id}`, { auth: true, signal });
}

export function startBackup(input: StartBackupJobInput): Promise<BackupJob> {
  return requestData(BackupJobSchema, `${BASE}/jobs`, {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export function prepareRestore(jobId: string): Promise<BackupJob> {
  return requestData(BackupJobSchema, `${BASE}/jobs/${jobId}/restore-preflight`, {
    method: 'POST',
    auth: true,
  });
}

export function getRestoreRunbook(preflightJobId: string): Promise<RestoreRunbook> {
  return requestData(RestoreRunbookSchema, `${BASE}/jobs/${preflightJobId}/restore-runbook`, {
    auth: true,
  });
}
