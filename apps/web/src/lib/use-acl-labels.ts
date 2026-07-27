'use client';

import { useTranslations } from 'next-intl';
import type { Action, Resource } from '@ad-wiki/shared-types';

/**
 * Übersetzte Beschriftungen für die Rechte-Matrix (Ressourcen, Aktionen, Rollen).
 * Ersetzt die früheren statischen Maps in `acl-labels.ts` durch Übersetzungs-Keys.
 */
export function useAclLabels() {
  const t = useTranslations('settings');

  return {
    resourceLabel: (resource: Resource): string => t(`resources.${resource}`),
    actionLabel: (action: Action): string => t(`actions.${action}`),
    roleLabel: (role: string): string => {
      const key = `roleLabels.${role}`;
      return t.has(key) ? t(key) : role;
    },
  };
}
