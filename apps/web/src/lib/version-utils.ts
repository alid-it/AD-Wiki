import { pages as pagesApi } from '@ad-wiki/api-client';
import type { PageDetail, PageVersion } from '@ad-wiki/shared-types';

/**
 * Einheitliche Sicht auf eine Version – vereint die aktuelle Seite (deren
 * Inhalt NICHT in der Historie liegt) mit den gespeicherten PageVersions.
 */
export interface CombinedVersion {
  version: number;
  title: string;
  content: string;
  changeMessage: string | null;
  authorName: string;
  createdAt: string;
  /** True für die aktuell aktive Version (= Inhalt der Seite selbst). */
  isCurrent: boolean;
}

/**
 * Führt die aktuelle Seite und ihre Versionshistorie zu einer absteigend
 * sortierten Liste zusammen (neueste zuerst). Die aktuelle Version steht nicht
 * in der `/versions`-Antwort, daher wird sie hier ergänzt.
 */
export function buildVersionList(page: PageDetail, history: PageVersion[]): CombinedVersion[] {
  const current: CombinedVersion = {
    version: page.version,
    title: page.title,
    content: page.content,
    changeMessage: null,
    authorName: page.author.displayName,
    createdAt: page.updatedAt,
    isCurrent: true,
  };

  const past: CombinedVersion[] = history.map((v) => ({
    version: v.version,
    title: v.title,
    content: v.content,
    changeMessage: v.changeMessage,
    authorName: v.author.displayName,
    createdAt: v.createdAt,
    isCurrent: false,
  }));

  return [current, ...past].sort((a, b) => b.version - a.version);
}

/** Lädt Seite + Historie und liefert die zusammengeführte Versionsliste. */
export async function loadVersions(
  slug: string,
  signal?: AbortSignal,
): Promise<{ page: PageDetail; versions: CombinedVersion[] }> {
  const page = await pagesApi.bySlug(slug, signal);
  const history = await pagesApi.versions(page.id, signal);
  return { page, versions: buildVersionList(page, history) };
}
