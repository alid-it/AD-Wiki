import { z } from 'zod';
import {
  AuditLogSchema,
  AuditLogPageMetaSchema,
  type AuditLog,
  type AuditLogPageMeta,
  type AuditLogQuery,
} from '@ad-wiki/shared-types';
import { requestList } from '../http';

/** Ergebnis der Audit-Log-Abfrage inkl. Cursor-Pagination-Meta. */
export interface AuditLogListResult {
  data: AuditLog[];
  meta: AuditLogPageMeta;
}

/**
 * Cursor-basierte, filterbare Audit-Log-Liste (`GET /audit-logs`, nur Admin).
 * Leere Filter werden weggelassen. Für die nächste Seite `meta.nextCursor` als
 * `cursor` übergeben.
 */
export function list(
  query: Partial<AuditLogQuery> = {},
  signal?: AbortSignal,
): Promise<AuditLogListResult> {
  return requestList(
    z.array(AuditLogSchema),
    '/audit-logs',
    {
      query: {
        resource: query.resource,
        action: query.action,
        userId: query.userId,
        from: query.from,
        to: query.to,
        cursor: query.cursor,
        perPage: query.perPage,
      },
      auth: true,
      signal,
    },
    AuditLogPageMetaSchema,
  );
}
