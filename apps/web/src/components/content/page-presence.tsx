'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle, Pencil } from 'lucide-react';
import type { PresenceUser } from '@ad-wiki/shared-types';
import { usePagePresence } from '@/lib/use-page-presence';

/** Bildet aus einem Anzeigenamen bis zu zwei Initialen. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2);
  return letters.toUpperCase();
}

/** Kleiner Avatar-Kreis mit Initialen und Tooltip. */
function Avatar({ user }: { user: PresenceUser }) {
  return (
    <span
      title={user.displayName}
      className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-brand-100 text-[10px] font-semibold text-brand-700"
    >
      {initialsOf(user.displayName)}
    </span>
  );
}

/** Gestapelte Avatare der anwesenden Betrachter (max. 5, Rest als „+N"). */
function AvatarStack({ users }: { users: PresenceUser[] }) {
  const t = useTranslations('presence');
  if (users.length === 0) return null;

  const visible = users.slice(0, 5);
  const overflow = users.length - visible.length;

  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-2">
        {visible.map((u) => (
          <Avatar key={u.id} user={u} />
        ))}
        {overflow > 0 && (
          <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-background text-[10px] font-semibold text-muted">
            +{overflow}
          </span>
        )}
      </div>
      <span className="text-xs text-muted">
        {users.length === 1 ? t('onePersonOnline') : t('morePeopleOnline', { count: users.length })}
      </span>
    </div>
  );
}

/**
 * Zeigt die Live-Presence einer Seite: Avatare der anwesenden Betrachter und –
 * falls jemand im Editor ist – einen dezenten „bearbeitet gerade"-Hinweis.
 *
 * Rendert nichts, solange man allein auf der Seite ist.
 */
export function PagePresence({
  pageId,
  announceEditing = false,
}: {
  pageId: string;
  announceEditing?: boolean;
}) {
  const t = useTranslations('presence');
  const { others, editingOthers } = usePagePresence(pageId, announceEditing);

  if (others.length === 0 && editingOthers.length === 0) return null;

  const editingLabel =
    editingOthers.length === 1
      ? t('editingOne', { name: editingOthers[0].displayName })
      : t('editingMany', { count: editingOthers.length });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <AvatarStack users={others} />

      {editingOthers.length > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-50 px-2.5 py-1 text-xs font-medium text-warning-600">
          <Pencil className="h-3 w-3 animate-pulse" />
          {editingLabel}
        </span>
      )}
    </div>
  );
}

/**
 * Presence-Anzeige für die Editor-Ansicht: meldet „bearbeitet gerade" an andere
 * Betrachter und warnt mit einem gut sichtbaren gelben Banner, falls ein anderer
 * Benutzer dieselbe Seite gleichzeitig bearbeitet (Soft-Lock, keine Blockierung).
 *
 * Der Banner verschwindet automatisch, sobald der andere Benutzer den Editor
 * verlässt.
 */
export function EditorPresence({ pageId }: { pageId: string }) {
  const t = useTranslations('presence');
  const { others, editingOthers } = usePagePresence(pageId, true);

  const names = editingOthers.map((u) => u.displayName).join(', ');
  const warningLabel =
    editingOthers.length === 1 ? t('warnOne', { names }) : t('warnMany', { names });

  if (editingOthers.length === 0 && others.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {editingOthers.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-warning-500/40 bg-warning-50 p-3.5"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-600" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-warning-700">{warningLabel}</p>
            <p className="text-warning-600">{t('warnHint')}</p>
          </div>
        </div>
      )}

      <AvatarStack users={others} />
    </div>
  );
}
