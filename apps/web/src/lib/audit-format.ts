import type { AuditLog } from '@ad-wiki/shared-types';

/** Bekannte Audit-Aktionen (für die Filter-Reihenfolge und Übersetzungs-Keys). */

/** Farbton einer Aktion für die visuelle Markierung. */
export type AuditTone = 'green' | 'blue' | 'red' | 'gray';

/**
 * Ordnet einer Aktion einen Farbton zu, abgeleitet aus dem Verb hinter dem Punkt:
 * Grün = neu/positiv, Blau = geändert, Rot = gelöscht/gesperrt, Grau = neutral.
 */
export function auditTone(action: string): AuditTone {
  const verb = action.split('.')[1] ?? '';
  if (['created', 'registered', 'login', 'uploaded', 'activated'].includes(verb)) return 'green';
  if (['updated', 'restored', 'role_changed'].includes(verb)) return 'blue';
  if (['deleted', 'deactivated'].includes(verb)) return 'red';
  return 'gray';
}

/** Tailwind-Klassen für einen Aktions-Badge je Farbton. */
export const TONE_BADGE: Record<AuditTone, string> = {
  green: 'bg-success-50 text-success-600',
  blue: 'bg-accent-50 text-accent-700',
  red: 'bg-danger-50 text-danger-600',
  gray: 'bg-background text-muted',
};

/** Tailwind-Klasse für einen kleinen Farbpunkt je Farbton (kompakte Ansicht). */
export const TONE_DOT: Record<AuditTone, string> = {
  green: 'bg-success-500',
  blue: 'bg-accent-500',
  red: 'bg-danger-500',
  gray: 'bg-muted',
};

/**
 * Relative Zeitangabe (z. B. „vor 2 Stunden"), basierend auf
 * `Intl.RelativeTimeFormat`. Für die Anzeige mit Tooltip gedacht.
 */
export function relativeTime(iso: string, locale = 'de'): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diffSec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(Math.round(diffSec), 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 604800) return rtf.format(Math.round(diffSec / 86400), 'day');
  if (abs < 2629800) return rtf.format(Math.round(diffSec / 604800), 'week');
  if (abs < 31557600) return rtf.format(Math.round(diffSec / 2629800), 'month');
  return rtf.format(Math.round(diffSec / 31557600), 'year');
}

/** Exaktes Datum inkl. Uhrzeit für Tooltips/Titel. */
export function absoluteTime(iso: string, locale = 'de'): string {
  return new Date(iso).toLocaleString(locale === 'de' ? 'de-DE' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Ermittelt aus `details` einen sprechenden Titel des betroffenen Objekts. */
export function auditSubject(log: AuditLog): string | null {
  const d = log.details;
  if (!d || typeof d !== 'object') return null;
  const record = d as Record<string, unknown>;
  for (const key of ['title', 'name', 'filename', 'key', 'displayName', 'email']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}
