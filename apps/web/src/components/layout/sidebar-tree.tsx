'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronRight, FolderIcon, FileTextIcon, GripVertical, Inbox, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { pages as pagesApi } from '@ad-wiki/api-client';
import type { SidebarCategory } from '@/lib/wiki-data';
import { UNCATEGORIZED_ID } from '@/lib/wiki-data';

// ── Container-Schlüssel ──
const catFolders = (catId: string) => `catfolders:${catId}`;
const catPages = (catId: string) => `catpages:${catId}`;
const folderBox = (folderId: string) => `fld:${folderId}`;

type ItemType = 'folder' | 'page';
interface ItemMeta {
  type: ItemType;
  title: string;
  slug: string;
}
interface ServerFields {
  sortOrder: number;
  parentId: string | null;
  categoryId: string | null;
}

interface BuiltState {
  items: Record<string, string[]>;
  meta: Record<string, ItemMeta>;
  server: Record<string, ServerFields>;
}

/** Baut die flache DnD-Repräsentation aus der verschachtelten Kategorie-Struktur. */
function buildState(cats: SidebarCategory[]): BuiltState {
  const items: Record<string, string[]> = {};
  const meta: Record<string, ItemMeta> = {};
  const server: Record<string, ServerFields> = {};

  for (const cat of cats) {
    items[catFolders(cat.id)] = cat.folders.map((f) => f.id);
    items[catPages(cat.id)] = cat.pages.map((p) => p.id);

    for (const folder of cat.folders) {
      meta[folder.id] = { type: 'folder', title: folder.title, slug: folder.slug };
      server[folder.id] = { sortOrder: folder.sortOrder, parentId: null, categoryId: folder.categoryId };
      items[folderBox(folder.id)] = folder.pages.map((p) => p.id);
      for (const page of folder.pages) {
        meta[page.id] = { type: 'page', title: page.title, slug: page.slug };
        server[page.id] = { sortOrder: page.sortOrder, parentId: page.parentId, categoryId: page.categoryId };
      }
    }
    for (const page of cat.pages) {
      meta[page.id] = { type: 'page', title: page.title, slug: page.slug };
      server[page.id] = { sortOrder: page.sortOrder, parentId: page.parentId, categoryId: page.categoryId };
    }
  }
  return { items, meta, server };
}

/** Signatur der Reihenfolge – erkennt, ob die Server-Daten sich geändert haben. */
function signatureOf(cats: SidebarCategory[]): string {
  return JSON.stringify(
    cats.map((c) => ({
      c: c.id,
      f: c.folders.map((f) => [f.id, f.sortOrder, f.pages.map((p) => [p.id, p.sortOrder])]),
      p: c.pages.map((p) => [p.id, p.sortOrder]),
    })),
  );
}

const EXPANDED_KEY = 'ad-wiki.sidebar.expanded.v2';
const catKey = (id: string) => `cat:${id}`;

function defaultExpanded(cats: SidebarCategory[]): Set<string> {
  return new Set([
    ...cats.map((c) => catKey(c.id)),
    ...cats.flatMap((c) => c.folders.map((f) => folderBox(f.id))),
  ]);
}

/** Kombiniert pointer-basierte und rect-basierte Kollisionserkennung (nested-freundlich). */
const collision: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  return pointer.length > 0 ? pointer : rectIntersection(args);
};

interface SidebarTreeProps {
  categories: SidebarCategory[];
  /** Drag-and-Drop nur für eingeloggte Nutzer. */
  canEdit: boolean;
  onNavigate: () => void;
}

/**
 * Wiki-Baum mit Drag-and-Drop (dnd-kit). Pages und Folders lassen sich per
 * Griff umsortieren und zwischen Ordnern/Kategorien verschieben. Änderungen
 * werden optimistisch angewandt und via PATCH /pages/:id persistiert; schlägt
 * ein Call fehl, wird der vorherige Zustand wiederhergestellt.
 */
export function SidebarTree({ categories, canEdit, onNavigate }: SidebarTreeProps) {
  const pathname = usePathname();
  const t = useTranslations('sidebar');
  const activeSlug = pathname.split('/')[2] ?? '';

  const [state, setState] = useState<BuiltState>(() => buildState(categories));
  const serverRef = useRef<Record<string, ServerFields>>(state.server);
  const snapshotRef = useRef<Record<string, string[]> | null>(null);
  const sigRef = useRef<string>(signatureOf(categories));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { items, meta } = state;

  // Server-Daten neu übernehmen, wenn sie sich (z. B. nach router.refresh) ändern.
  useEffect(() => {
    const sig = signatureOf(categories);
    if (sig !== sigRef.current && activeId === null) {
      sigRef.current = sig;
      const built = buildState(categories);
      serverRef.current = built.server;
      setState(built);
    }
  }, [categories, activeId]);

  // ── Expand/Collapse mit localStorage-Persistenz ──
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(categories));
  const bootstrapped = useRef(false);

  const applyExpanded = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    setExpanded((prev) => {
      const next = updater(prev);
      try {
        window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        // ignorieren
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let base: Set<string>;
    const raw = window.localStorage.getItem(EXPANDED_KEY);
    if (raw) {
      try {
        base = new Set(JSON.parse(raw) as string[]);
      } catch {
        base = defaultExpanded(categories);
      }
    } else {
      base = defaultExpanded(categories);
    }
    bootstrapped.current = true;
    applyExpanded(() => base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vorfahren der aktiven Seite automatisch aufklappen.
  useEffect(() => {
    if (!bootstrapped.current || !activeSlug) return;
    const pageId = Object.keys(meta).find(
      (id) => meta[id].type === 'page' && meta[id].slug === activeSlug,
    );
    if (!pageId) return;
    const container = findContainer(pageId, items);
    if (!container) return;
    const keys: string[] = [];
    if (container.startsWith('fld:')) {
      const fId = container.slice(4);
      keys.push(folderBox(fId));
      const catContainer = findContainer(fId, items);
      if (catContainer?.startsWith('catfolders:')) keys.push(catKey(catContainer.slice('catfolders:'.length)));
    } else if (container.startsWith('catpages:')) {
      keys.push(catKey(container.slice('catpages:'.length)));
    }
    if (keys.length) applyExpanded((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlug]);

  const toggle = (key: string) =>
    applyExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ── DnD ──
  const sensors = useSensors(
    // Ein kurzer Halt verhindert, dass ein normaler Klick auf die Sidebar
    // versehentlich eine Verschiebeaktion auslöst (besonders auf Touch-Geräten).
    useSensor(PointerSensor, { activationConstraint: { delay: 140, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const draggingType = activeId ? meta[activeId]?.type : undefined;

  // Auto-Open eines Ordners nach 500 ms Hover.
  const autoOpenRef = useRef<{ key: string; timer: number } | null>(null);
  const clearAutoOpen = useCallback(() => {
    if (autoOpenRef.current) {
      window.clearTimeout(autoOpenRef.current.timer);
      autoOpenRef.current = null;
    }
  }, []);

  function scheduleAutoOpen(overContainer: string, overId: string) {
    let fId: string | undefined;
    if (overContainer.startsWith('fld:')) fId = overContainer.slice(4);
    else if (meta[overId]?.type === 'folder') fId = overId;
    if (!fId) {
      clearAutoOpen();
      return;
    }
    const key = folderBox(fId);
    if (expanded.has(key) || autoOpenRef.current?.key === key) return;
    clearAutoOpen();
    const timer = window.setTimeout(() => {
      applyExpanded((prev) => new Set(prev).add(key));
      autoOpenRef.current = null;
    }, 500);
    autoOpenRef.current = { key, timer };
  }

  function isValidTarget(type: ItemType | undefined, containerId: string): boolean {
    const prefix = containerId.split(':')[0];
    if (type === 'folder') return prefix === 'catfolders';
    if (type === 'page') return prefix === 'catpages' || prefix === 'fld';
    return false;
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
    setError(null);
    snapshotRef.current = structuredClone(items);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeItem = active.id as string;
    const overId = over.id as string;
    const activeContainer = findContainer(activeItem, items);
    const overContainer = findContainer(overId, items);
    if (!activeContainer || !overContainer) return;

    const type = meta[activeItem]?.type;
    if (!isValidTarget(type, overContainer)) return;

    scheduleAutoOpen(overContainer, overId);
    if (activeContainer === overContainer) return;

    setState((prev) => {
      const activeItems = prev.items[activeContainer];
      const overItems = prev.items[overContainer];
      const overIndex = overItems.indexOf(overId);

      let newIndex: number;
      if (overId in prev.items) {
        newIndex = overItems.length;
      } else {
        const isBelow =
          over.rect && active.rect.current.translated
            ? active.rect.current.translated.top > over.rect.top + over.rect.height / 2
            : false;
        newIndex = overIndex >= 0 ? overIndex + (isBelow ? 1 : 0) : overItems.length;
      }

      return {
        ...prev,
        items: {
          ...prev.items,
          [activeContainer]: activeItems.filter((id) => id !== activeItem),
          [overContainer]: [
            ...overItems.slice(0, newIndex),
            activeItem,
            ...overItems.slice(newIndex),
          ],
        },
      };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    clearAutoOpen();
    const { active, over } = event;
    const activeItem = active.id as string;
    setActiveId(null);

    if (!over) {
      if (snapshotRef.current) setState((p) => ({ ...p, items: snapshotRef.current! }));
      return;
    }

    const overId = over.id as string;
    const overContainer = findContainer(overId, items);
    const activeContainer = findContainer(activeItem, items);
    const type = meta[activeItem]?.type;

    if (!overContainer || !activeContainer || !isValidTarget(type, overContainer)) {
      if (snapshotRef.current) setState((p) => ({ ...p, items: snapshotRef.current! }));
      return;
    }

    // Reihenfolge innerhalb des Zielcontainers final festlegen.
    let finalItems = items;
    if (activeContainer === overContainer) {
      const list = items[overContainer];
      const oldIndex = list.indexOf(activeItem);
      const newIndex = overId in items ? list.length - 1 : list.indexOf(overId);
      if (oldIndex !== newIndex && newIndex >= 0) {
        finalItems = { ...items, [overContainer]: arrayMove(list, oldIndex, newIndex) };
        setState((p) => ({ ...p, items: finalItems }));
      }
    }

    void persist(finalItems);
  }

  /** Ermittelt die Kategorie eines Ordners aus dem aktuellen Layout. */
  function categoryOfFolder(folderId: string, itemsMap: Record<string, string[]>): string | null {
    const container = findContainer(folderId, itemsMap);
    if (!container?.startsWith('catfolders:')) return null;
    const id = container.slice('catfolders:'.length);
    return id === UNCATEGORIZED_ID ? null : id;
  }

  /** Soll-Attribute (parentId/categoryId) für ein Item in einem Container. */
  function containerAttrs(
    containerId: string,
    itemsMap: Record<string, string[]>,
  ): { parentId: string | null; categoryId: string | null } {
    const [prefix, id] = [containerId.split(':')[0], containerId.slice(containerId.indexOf(':') + 1)];
    if (prefix === 'fld') return { parentId: id, categoryId: categoryOfFolder(id, itemsMap) };
    // catfolders / catpages – Sentinel der Unkategorisiert-Gruppe → echtes null.
    return { parentId: null, categoryId: id === UNCATEGORIZED_ID ? null : id };
  }

  /** Berechnet Änderungen gegenüber dem Server-Stand und persistiert sie. */
  async function persist(finalItems: Record<string, string[]>) {
    const patches: { id: string; data: ServerFields }[] = [];
    for (const containerId of Object.keys(finalItems)) {
      const attrs = containerAttrs(containerId, finalItems);
      finalItems[containerId].forEach((itemId, index) => {
        const server = serverRef.current[itemId];
        const desired: ServerFields = {
          sortOrder: index,
          parentId: attrs.parentId,
          categoryId: attrs.categoryId,
        };
        if (
          !server ||
          server.sortOrder !== desired.sortOrder ||
          server.parentId !== desired.parentId ||
          server.categoryId !== desired.categoryId
        ) {
          patches.push({ id: itemId, data: desired });
        }
      });
    }

    if (patches.length === 0) return;

    try {
      await Promise.all(
        patches.map((p) =>
          pagesApi.update(p.id, {
            sortOrder: p.data.sortOrder,
            parentId: p.data.parentId,
            categoryId: p.data.categoryId,
          }),
        ),
      );
      patches.forEach((p) => {
        serverRef.current[p.id] = { ...p.data };
      });
    } catch {
      if (snapshotRef.current) setState((p) => ({ ...p, items: snapshotRef.current! }));
      setError(t('saveFailed'));
    }
  }

  const categoryOrder = useMemo(
    () => categories.map((c) => ({ id: c.id, name: c.name })),
    [categories],
  );
  const allKeys = useMemo(() => [
    ...categories.map((category) => catKey(category.id)),
    ...categories.flatMap((category) => category.folders.map((folder) => folderBox(folder.id))),
  ], [categories]);
  const allExpanded = allKeys.length > 0 && allKeys.every((key) => expanded.has(key));

  const renderPage = (id: string, indent: string) => (
    <PageRow
      key={id}
      id={id}
      title={meta[id]?.title ?? ''}
      slug={meta[id]?.slug ?? ''}
      indent={indent}
      active={activeSlug === meta[id]?.slug}
      canEdit={canEdit}
      onNavigate={onNavigate}
    />
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        clearAutoOpen();
        setActiveId(null);
        if (snapshotRef.current) setState((p) => ({ ...p, items: snapshotRef.current! }));
      }}
    >
      <nav className="p-3">
        <div className="mb-3 flex items-center justify-between px-2"><p className="text-xs font-semibold uppercase tracking-wider text-muted">{t('wikiPages')}</p><button type="button" onClick={() => applyExpanded(() => allExpanded ? new Set() : new Set(allKeys))} aria-label={allExpanded ? t('collapseAll') : t('expandAll')} title={allExpanded ? t('collapseAll') : t('expandAll')} className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-all duration-200 hover:bg-accent-50 hover:text-foreground cursor-pointer"><span className={`transition-transform duration-200 ${allExpanded ? 'rotate-180' : 'rotate-0'}`}>{allExpanded ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}</span></button></div>

        {error && (
          <p className="mb-2 rounded-md bg-danger-50 px-2 py-1.5 text-xs text-danger-600">{error}</p>
        )}

        {categoryOrder.map((cat) => {
          const isOpen = expanded.has(catKey(cat.id));
          const folderIds = items[catFolders(cat.id)] ?? [];
          const rootPageIds = items[catPages(cat.id)] ?? [];
          const isEmpty = folderIds.length === 0 && rootPageIds.length === 0;
          return (
            <div key={cat.id} className="mb-1">
              <button
                type="button"
                onClick={() => toggle(catKey(cat.id))}
                aria-expanded={isOpen}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent-50 cursor-pointer"
              >
                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-muted transition-transform duration-200 ${
                    isOpen ? 'rotate-90' : ''
                  }`}
                />
                <FolderIcon className="h-4 w-4 shrink-0 text-brand-500" />
                <span className="truncate">{cat.name}</span>
              </button>

              <div
                className={`grid transition-all duration-200 ${
                  isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
              >
                <div className="overflow-hidden">
                  {isEmpty && <p className="ml-6 px-2 py-2 text-xs text-muted">{t('noPagesShort')}</p>}

                  {/* Ordner */}
                  <SortableContext items={folderIds} strategy={verticalListSortingStrategy}>
                    {folderIds.map((fid) => (
                      <FolderRow
                        key={fid}
                        id={fid}
                        title={meta[fid]?.title ?? ''}
                        pageIds={items[folderBox(fid)] ?? []}
                        expanded={expanded.has(folderBox(fid))}
                        onToggle={() => toggle(folderBox(fid))}
                        canEdit={canEdit}
                        dragActivePage={draggingType === 'page'}
                        renderPage={renderPage}
                      />
                    ))}
                  </SortableContext>
                  {draggingType === 'folder' && <DropStrip id={catFolders(cat.id)} />}

                  {/* Root-Seiten */}
                  <SortableContext items={rootPageIds} strategy={verticalListSortingStrategy}>
                    {rootPageIds.map((pid) => renderPage(pid, 'ml-4'))}
                  </SortableContext>
                  {draggingType === 'page' && <DropStrip id={catPages(cat.id)} indent="ml-4" />}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      <DragOverlay>
        {activeId ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-2 text-sm text-foreground shadow-soft-lg">
            {meta[activeId]?.type === 'folder' ? (
              <FolderIcon className="h-4 w-4 text-muted" />
            ) : (
              <FileTextIcon className="h-4 w-4 text-muted" />
            )}
            <span className="truncate">{meta[activeId]?.title}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Findet den Container, der `id` enthält – oder `id` selbst, wenn es ein Container ist. */
function findContainer(id: string, items: Record<string, string[]>): string | undefined {
  if (id in items) return id;
  return Object.keys(items).find((key) => items[key].includes(id));
}

// ── Zeilen-Komponenten ──

interface PageRowProps {
  id: string;
  title: string;
  slug: string;
  indent: string;
  active: boolean;
  canEdit: boolean;
  onNavigate: () => void;
}

function PageRow({ id, title, slug, indent, active, canEdit, onNavigate }: PageRowProps) {
  const t = useTranslations('sidebar');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !canEdit,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group/item relative ${indent} ${isDragging ? 'opacity-50' : ''}`}
    >
      {canEdit && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={t('move')}
          title={t('move')}
          className="absolute left-0 top-1/2 flex h-8 w-6 -translate-y-1/2 touch-none cursor-grab items-center justify-center text-muted opacity-50 transition-opacity group-hover/item:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <Link
        href={`/wiki/${slug}`}
        onClick={onNavigate}
        className={`flex min-h-11 items-center gap-2 rounded-lg py-2 pl-5 pr-2 text-sm transition-colors cursor-pointer ${
          active
            ? 'bg-accent-50 font-medium text-accent-700'
            : 'text-muted hover:bg-accent-50/60 hover:text-foreground'
        }`}
      >
        <FileTextIcon className="h-4 w-4 shrink-0" />
        <span className="truncate">{title}</span>
      </Link>
    </div>
  );
}

interface FolderRowProps {
  id: string;
  title: string;
  pageIds: string[];
  expanded: boolean;
  onToggle: () => void;
  canEdit: boolean;
  dragActivePage: boolean;
  renderPage: (id: string, indent: string) => React.ReactNode;
}

function FolderRow({
  id,
  title,
  pageIds,
  expanded,
  onToggle,
  canEdit,
  dragActivePage,
  renderPage,
}: FolderRowProps) {
  const t = useTranslations('sidebar');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !canEdit,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const droppable = useDroppable({ id: folderBox(id) });

  return (
    <div ref={setNodeRef} style={style} className={`ml-4 ${isDragging ? 'opacity-50' : ''}`}>
      <div className="group/item relative">
        {canEdit && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={t('moveFolder')}
            title={t('moveFolder')}
            className="absolute left-0 top-1/2 flex h-8 w-6 -translate-y-1/2 touch-none cursor-grab items-center justify-center text-muted opacity-50 transition-opacity group-hover/item:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-h-11 w-full items-center gap-2 rounded-lg py-2 pl-5 pr-2 text-sm text-foreground transition-colors hover:bg-accent-50 cursor-pointer"
        >
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-muted transition-transform duration-200 ${
              expanded ? 'rotate-90' : ''
            }`}
          />
          <FolderIcon className="h-4 w-4 shrink-0 text-muted" />
          <span className="truncate">{title}</span>
        </button>
      </div>

      <div
        ref={droppable.setNodeRef}
        className={`grid transition-all duration-200 ${
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        } ${droppable.isOver ? 'rounded-lg bg-accent-50/60' : ''}`}
      >
        <div className="overflow-hidden">
          <SortableContext items={pageIds} strategy={verticalListSortingStrategy}>
            {pageIds.map((pid) => renderPage(pid, 'ml-8'))}
          </SortableContext>
          {/* Beim Ziehen einer Seite: dünne Ablagezone, auch wenn der Ordner leer ist. */}
          {(dragActivePage || pageIds.length === 0) && expanded && (
            <div className="ml-8 flex items-center gap-1 px-2 py-1 text-[11px] text-muted">
              <Inbox className="h-3 w-3" /> {t('dragHere')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Sichtbare Ablagezone am Ende einer Liste (nur während eines Drags). */
function DropStrip({ id, indent = '' }: { id: string; indent?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`${indent} mx-2 my-0.5 h-6 rounded-md border border-dashed transition-colors ${
        isOver ? 'border-accent-600 bg-accent-50' : 'border-border'
      }`}
    />
  );
}
