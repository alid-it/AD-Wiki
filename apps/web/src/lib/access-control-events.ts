import type { AccessControlChangedEvent } from '@ad-wiki/shared-types';

export const ACCESS_CONTROL_UPDATED_EVENT = 'ad-wiki:access-control-updated';

/** Verteilt Socket- und lokale ACL-Änderungen an bereits geöffnete Clientansichten. */
export function dispatchAccessControlUpdated(
  detail: AccessControlChangedEvent,
): void {
  window.dispatchEvent(
    new CustomEvent<AccessControlChangedEvent>(ACCESS_CONTROL_UPDATED_EVENT, {
      detail,
    }),
  );
}
