'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bell, CheckCheck } from 'lucide-react';
import type { NotificationType } from '@ad-wiki/shared-types';
import { useNotifications } from '@/lib/notifications-context';
import { useAuditFormat } from '@/lib/use-audit-format';

/** Farbpunkt je Notification-Typ. */
const DOT: Record<NotificationType, string> = {
  success: 'bg-success-500',
  info: 'bg-accent-500',
  warning: 'bg-warning-500',
  error: 'bg-danger-500',
};

/** Glocke in der Navbar mit Ungelesen-Badge und Dropdown der letzten 10 Einträge. */
export function NotificationBell() {
  const router = useRouter();
  const t = useTranslations('notifications');
  const { relativeTime, absoluteTime } = useAuditFormat();
  const { notifications, unreadCount, markAllRead, hrefFor } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Klick außerhalb / Escape schließt das Dropdown.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    // Beim Öffnen als gelesen markieren (Badge verschwindet).
    if (next && unreadCount > 0) markAllRead();
  }

  const recent = notifications.slice(0, 10);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unreadCount > 0 ? t('ariaLabelUnread', { count: unreadCount }) : t('ariaLabel')}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-soft-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">{t('title')}</p>
            {recent.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <CheckCheck className="h-3.5 w-3.5" /> {t('read')}
              </span>
            )}
          </div>

          {recent.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
              <Bell className="h-7 w-7 text-muted" />
              <p className="text-sm text-muted">{t('none')}</p>
            </div>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {recent.map((n) => {
                const target = hrefFor(n);
                const clickable = target !== null;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => {
                        if (target) {
                          router.push(target);
                          setOpen(false);
                        }
                      }}
                      className={`flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 ${
                        clickable
                          ? 'transition-colors hover:bg-background cursor-pointer'
                          : 'cursor-default'
                      }`}
                    >
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[n.type]}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-foreground">{n.message}</span>
                        <span
                          className="block text-xs text-muted"
                          title={absoluteTime(n.createdAt)}
                        >
                          {relativeTime(n.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
