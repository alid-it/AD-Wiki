'use client';

import { useTranslations } from 'next-intl';
import type { AuditLog } from '@ad-wiki/shared-types';
import { useLocaleSwitcher } from '@/lib/i18n-context';
import { auditSubject, relativeTime, absoluteTime } from '@/lib/audit-format';

/**
 * Übersetzte Beschriftungen und locale-abhängige Zeitformatierung für das
 * Audit-Log. Kapselt `useTranslations('audit')` samt der aktuellen Sprache,
 * damit Komponenten (Audit-Tabelle, Aktivitäts-Widget) nur diesen Hook nutzen.
 */
export function useAuditFormat() {
  const t = useTranslations('audit');
  const { locale } = useLocaleSwitcher();

  /** Menschlich lesbare Beschriftung einer Aktion (mit Fallback auf den Rohwert). */
  const actionLabel = (action: string): string => {
    // Aktions-Codes nutzen Punkte (z. B. "page.updated"); Übersetzungs-Keys
    // dürfen keine Punkte enthalten (Nesting) → auf "_" normalisieren.
    const key = `actions.${action.replace(/\./g, '_')}`;
    return t.has(key) ? t(key) : action;
  };

  /** Menschlich lesbare Beschriftung einer Ressource (mit Fallback). */
  const resourceLabel = (resource: string): string => {
    const key = `resources.${resource}`;
    return t.has(key) ? t(key) : resource;
  };

  /** Kompakter Satz für die Dashboard-Aktivität. */
  const describeAudit = (log: AuditLog): string => {
    const actor = log.user?.displayName ?? t('system');
    const label = actionLabel(log.action);
    const subject = auditSubject(log);
    return subject
      ? t('describeWithSubject', { actor, subject, label: label.toLowerCase() })
      : t('describeWithoutSubject', { actor, label });
  };

  return {
    actionLabel,
    resourceLabel,
    describeAudit,
    relativeTime: (iso: string) => relativeTime(iso, locale),
    absoluteTime: (iso: string) => absoluteTime(iso, locale),
  };
}
