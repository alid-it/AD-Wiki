import { categories, pages } from '@ad-wiki/api-client';

/**
 * Sentinel-ID der synthetischen „Unkategorisiert"-Kategorie. Container mit
 * dieser Kategorie-ID werden beim Speichern auf `categoryId: null` abgebildet.
 */
export const UNCATEGORIZED_ID = '__uncategorized__';

/** Eine Seite (oder Ordner-Kindseite) in der Sidebar-Baumstruktur. */
export interface SidebarPage {
  id: string;
  title: string;
  slug: string;
  sortOrder: number;
  parentId: string | null;
  categoryId: string | null;
}

/** Ein Ordner mit den darin enthaltenen Seiten. */
export interface SidebarFolder {
  id: string;
  title: string;
  slug: string;
  sortOrder: number;
  categoryId: string | null;
  pages: SidebarPage[];
}

/** Eine Kategorie mit ihren Ordnern und direkt zugeordneten Seiten. */
export interface SidebarCategory {
  id: string;
  name: string;
  slug: string;
  folders: SidebarFolder[];
  pages: SidebarPage[];
}

/** Ergebnis des Sidebar-Ladens inklusive Fehlerkennzeichnung. */
export interface SidebarData {
  categories: SidebarCategory[];
  /** True, wenn die API nicht erreichbar war oder ungültig antwortete. */
  failed: boolean;
}

/**
 * Lädt alle Kategorien und ihre Baumstruktur (Ordner → Seiten) für die Sidebar.
 * Enthält bewusst `id`, `sortOrder`, `parentId` und `categoryId`, damit die
 * Sidebar per Drag-and-Drop umsortieren und `PATCH /pages/:id` aufrufen kann.
 */
export async function loadSidebarCategories(): Promise<SidebarData> {
  try {
    const cats = await categories.list();
    const [trees, uncat] = await Promise.all([
      Promise.all(cats.map((cat) => pages.tree(cat.slug))),
      pages.uncategorized(),
    ]);

    const result: SidebarCategory[] = trees.map((tree) => ({
      id: tree.category.id,
      name: tree.category.name,
      slug: tree.category.slug,
      folders: tree.folders.map((folder) => ({
        id: folder.id,
        title: folder.title,
        slug: folder.slug,
        sortOrder: folder.sortOrder,
        categoryId: folder.categoryId ?? tree.category.id,
        pages: folder.pages.map(toSidebarPage),
      })),
      pages: tree.pages.map(toSidebarPage),
    }));

    // Seiten/Ordner ohne Kategorie als eigenen Bereich anhängen (nur wenn vorhanden).
    if (uncat.folders.length > 0 || uncat.pages.length > 0) {
      result.push({
        id: UNCATEGORIZED_ID,
        name: 'Unkategorisiert',
        slug: '',
        folders: uncat.folders.map((folder) => ({
          id: folder.id,
          title: folder.title,
          slug: folder.slug,
          sortOrder: folder.sortOrder,
          categoryId: null,
          pages: folder.pages.map(toSidebarPage),
        })),
        pages: uncat.pages.map(toSidebarPage),
      });
    }

    return { categories: result, failed: false };
  } catch {
    return { categories: [], failed: true };
  }
}

/** Reduziert ein API-Page-Objekt auf die für die Sidebar nötigen Felder. */
function toSidebarPage(page: {
  id: string;
  title: string;
  slug: string;
  sortOrder: number;
  parentId?: string | null;
  categoryId?: string | null;
}): SidebarPage {
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    sortOrder: page.sortOrder,
    parentId: page.parentId ?? null,
    categoryId: page.categoryId ?? null,
  };
}
