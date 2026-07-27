'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { audit as auditApi } from '@ad-wiki/api-client';
import type { AuditLog } from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';
import { auditTone, TONE_DOT } from '@/lib/audit-format';
import { useAuditFormat } from '@/lib/use-audit-format';

/**
 * Kompaktes Aktivitäts-Widget fürs Dashboard: zeigt die letzten Audit-Einträge
 * mit relativer Zeit. Da das Audit-Log Admin-geschützt ist, wird es nur für
 * Admins geladen; andere sehen einen neutralen Hinweis.
 */
export function DashboardActivity() {
  const t = useTranslations('dashboard');
  const { describeAudit, relativeTime, absoluteTime } = useAuditFormat();
  const { hasPermission, isLoading } = useAuth();
  const canReadAudit = hasPermission('audit_logs', 'read');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isLoading) return;
    if (!canReadAudit) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    auditApi
      .list({ perPage: 8 }, controller.signal)
      .then((res) => setLogs(res.data))
      .catch(() => {
        /* Fehler still behandeln – Widget bleibt leer. */
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canReadAudit, isLoading]);

  if (isLoading || loading) {
    return (
      <div className="flex justify-center px-6 py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  if (!canReadAudit) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <p className="text-sm text-muted">{t('activityAdminsOnly')}</p>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <p className="text-sm text-muted">{t('noActivity')}</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {logs.map((log) => {
        const tone = auditTone(log.action);
        return (
          <li key={log.id} className="flex items-start gap-3 px-5 py-3">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{describeAudit(log)}</p>
              <p className="text-xs text-muted" title={absoluteTime(log.createdAt)}>
                {relativeTime(log.createdAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
