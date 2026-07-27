'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SOCKET_EVENTS, type PageUpdatedEvent } from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useSocketEvent } from '@/lib/socket-context';
import { useToast } from '@/components/ui/toast';

/**
 * Lädt den Inhalt der aktuell betrachteten Seite automatisch neu (weicher
 * Refresh via `router.refresh`, kein harter Reload), sobald ein anderer Benutzer
 * die Seite speichert. Zeigt dazu einen dezenten Hinweis-Toast mit einer
 * „Neu laden"-Aktion als manuelle Alternative.
 *
 * Setzt voraus, dass die Seite dem Socket-Raum beigetreten ist (über
 * {@link PagePresence}), da „page:updated" nur an Raum-Mitglieder gesendet wird.
 */
export function PageLiveRefresh({ pageId }: { pageId: string }) {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations('live');
  const { user } = useAuth();

  useSocketEvent<PageUpdatedEvent>(SOCKET_EVENTS.pageUpdated, (event) => {
    if (event.pageId !== pageId) return;
    // Eigene Speicherung nicht doppelt neu laden.
    if (event.actor && user && event.actor.id === user.id) return;

    router.refresh();
    toast.info(t('pageUpdated'), {
      action: { label: t('reload'), onClick: () => window.location.reload() },
    });
  });

  return null;
}
