/**
 * @ad-wiki/api-client – zentraler, typisierter Zugriff auf die AD-Wiki-API.
 *
 * Grundsätze (siehe apps/web/CLAUDE.md):
 * - Frontend ruft NIE direkt `fetch` auf, sondern ausschließlich diese Funktionen.
 * - Antworten werden gegen die Zod-Schemas aus `@ad-wiki/shared-types` validiert.
 * - Token-Handling (localStorage + Auto-Refresh) ist gekapselt und für eine
 *   spätere React-Native-App über {@link setTokenStore} austauschbar.
 *
 * Nutzung:
 *   import { categories, pages, auth } from '@ad-wiki/api-client';
 *   const cats = await categories.list();
 */
import * as categories from './resources/categories';
import * as pages from './resources/pages';
import * as auth from './resources/auth';
import * as media from './resources/media';
import * as search from './resources/search';
import * as users from './resources/users';
import * as acls from './resources/acls';
import * as settings from './resources/settings';
import * as audit from './resources/audit';
import * as notes from './resources/notes';
import * as standards from './resources/standards';
import * as mcpTokens from './resources/mcp-tokens';
import * as integrations from './resources/integrations';
import * as wikiExport from './resources/wiki-export';
import * as apiKeys from './resources/api-keys';
import * as backups from './resources/backups';
import * as groups from './resources/groups';
import * as spaces from './resources/spaces';
import * as resourceAcls from './resources/resource-acls';
import * as identityProviders from './resources/identity-providers';

export { categories, pages, auth, media, search, users, acls, settings, audit, notes, standards, mcpTokens, integrations, wikiExport, apiKeys, backups, groups, spaces, resourceAcls, identityProviders };

// Konfiguration & Erweiterbarkeit
export { configureApiClient } from './config';
export { setTokenStore, getTokenStore, type TokenStore } from './token-store';
export { ApiClientError } from './errors';
export type { DownloadProgress, DownloadResult } from './http';
