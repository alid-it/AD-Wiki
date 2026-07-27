import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import slugify from "slugify";
import { CategoryScope, Prisma, PageStatus, PageType, type Page as PrismaPage } from "@prisma/client";
import type {
  CreatePageInput,
  ImportMarkdownInput,
  PageQuery,
  PageStatus as ApiPageStatus,
  PageType as ApiPageType,
  SavePageDraftInput,
  UpdatePageInput,
  ToggleCheckboxInput,
} from "@ad-wiki/shared-types";
import { toggleCheckboxInContent } from "@/common/content/toggle-checkbox";
import { PrismaService } from "@/prisma/prisma.service";
import { UPLOAD_DIR } from "@/modules/media/media.config";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import {
  DEFAULT_SPACE_ID,
  SpacesService,
} from "@/modules/spaces/spaces.service";
import { ResourceAccessService } from "@/modules/resource-acls/resource-access.service";

// ── Enum-Mapping: API nutzt Kleinbuchstaben, Prisma Großbuchstaben ──
const STATUS_TO_DB: Record<ApiPageStatus, PageStatus> = {
  draft: PageStatus.DRAFT,
  published: PageStatus.PUBLISHED,
  archived: PageStatus.ARCHIVED,
};
const STATUS_TO_API: Record<PageStatus, ApiPageStatus> = {
  [PageStatus.DRAFT]: "draft",
  [PageStatus.PUBLISHED]: "published",
  [PageStatus.ARCHIVED]: "archived",
};
const TYPE_TO_DB: Record<ApiPageType, PageType> = {
  folder: PageType.FOLDER,
  page: PageType.PAGE,
};
const TYPE_TO_API: Record<PageType, ApiPageType> = {
  [PageType.FOLDER]: "folder",
  [PageType.PAGE]: "page",
};

export interface PageUpdateOptions {
  expectedVersion?: number;
  editorId?: string;
  actor?: AuthenticatedUser;
}

interface RelatedPageRow {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  shared_tags: string[];
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
}

/**
 * Geschäftslogik für Seiten und Ordner.
 * Zuständig für Slug-Erzeugung, automatische Versionierung und die
 * verschachtelte Baumstruktur für die Sidebar.
 */
@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService = new SpacesService(prisma),
    @Optional() private readonly access?: ResourceAccessService,
  ) {}

  /** Paginierte Seitenliste, optional gefiltert nach Status und Kategorie-Slug. */
  async findAll(query: PageQuery, user?: AuthenticatedUser) {
    const where: Prisma.PageWhereInput = { deletedAt: null };
    if (query.spaceId) {
      where.spaceId = query.spaceId;
    }
    if (query.status) {
      where.status = STATUS_TO_DB[query.status];
    }
    if (query.type) {
      where.type = TYPE_TO_DB[query.type];
    }
    if (query.category) {
      where.category = { slug: query.category };
    }
    if (user && this.access) {
      const candidates = await this.prisma.page.findMany({
        where,
        select: { id: true },
      });
      const allowedIds = await this.access.allowedTargetIds(user, {
        resource: "pages",
        action: "read",
        targetType: "page",
        targetIds: candidates.map((page) => page.id),
      });
      where.id = { in: allowedIds };
    }

    const [total, pages] = await this.prisma.$transaction([
      this.prisma.page.count({ where }),
      this.prisma.page.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
    ]);

    return {
      data: pages.map((page) => this.toApiPage(page)),
      meta: { total, page: query.page, perPage: query.perPage },
    };
  }

  /**
   * Lädt eine einzelne Seite anhand ihres Slugs – angereichert um Autor und
   * Kategorie, damit die Artikelansicht Namen statt nur IDs zeigen kann.
   */
  async findBySlug(slug: string, user?: AuthenticatedUser) {
    if (user && this.access) {
      const target = await this.prisma.page.findUnique({
        where: { slug, deletedAt: null },
        select: { id: true },
      });
      if (!target) {
        throw new NotFoundException(`Seite "${slug}" wurde nicht gefunden.`);
      }
      await this.access.assertAllowed(
        user,
        {
          resource: "pages",
          action: "read",
          targetType: "page",
          targetId: target.id,
        },
        `Seite "${slug}" wurde nicht gefunden.`,
      );
    }
    const page = await this.prisma.page.findUnique({
      where: { slug, deletedAt: null },
      include: {
        author: { select: { id: true, displayName: true } },
        category: { select: { id: true, name: true, slug: true } },
        tags: { include: { tag: { select: { name: true } } } },
      },
    });
    if (!page) {
      throw new NotFoundException(`Seite "${slug}" wurde nicht gefunden.`);
    }
    let ancestors = await this.findAncestors(page.parentId);
    let category = page.category;
    if (user && this.access) {
      const allowedAncestorIds = await this.access.allowedTargetIds(user, {
        resource: "pages",
        action: "read",
        targetType: "page",
        targetIds: ancestors.map((ancestor) => ancestor.id),
      });
      const allowedAncestors = new Set(allowedAncestorIds);
      ancestors = ancestors.filter((ancestor) =>
        allowedAncestors.has(ancestor.id),
      );
      if (category) {
        const allowedCategories = await this.access.allowedTargetIds(user, {
          resource: "categories",
          action: "read",
          targetType: "category",
          targetIds: [category.id],
        });
        if (allowedCategories.length === 0) category = null;
      }
    }
    return {
      ...this.toApiPage(page),
      content: await this.normalizeMediaUrls(page.content),
      author: page.author,
      category: category
        ? { id: category.id, name: category.name, slug: category.slug }
        : null,
      ancestors,
    };
  }

  /**
   * Löst die Elternkette von der Wurzel bis zum direkten Elternobjekt auf.
   * Die Begrenzung und die ID-Menge schützen auch bei fehlerhaften Bestandsdaten
   * vor Endlosschleifen durch zyklische parentId-Verknüpfungen.
   */
  private async findAncestors(parentId: string | null): Promise<Array<{
    id: string;
    title: string;
    slug: string;
    type: ApiPageType;
  }>> {
    const ancestors: Array<{ id: string; title: string; slug: string; type: ApiPageType }> = [];
    const visited = new Set<string>();
    let currentId = parentId;

    while (currentId && ancestors.length < 20 && !visited.has(currentId)) {
      visited.add(currentId);
      const parent = await this.prisma.page.findFirst({
        where: { id: currentId, deletedAt: null },
        select: { id: true, title: true, slug: true, type: true, parentId: true },
      });
      if (!parent) break;
      ancestors.unshift({
        id: parent.id,
        title: parent.title,
        slug: parent.slug,
        type: TYPE_TO_API[parent.type],
      });
      currentId = parent.parentId;
    }

    return ancestors;
  }

  /**
   * Ermittelt verwandte Inhaltsseiten. Gemeinsame Tags sind stärker als die
   * gemeinsame Kategorie; bei mehreren Tag-Treffern entscheidet deren Anzahl.
   */
  async findRelated(id: string, limit: number, user?: AuthenticatedUser) {
    const source = await this.prisma.page.findFirst({
      where: { id, type: PageType.PAGE, deletedAt: null },
      select: { id: true },
    });
    if (!source) throw new NotFoundException("Seite wurde nicht gefunden.");
    if (user && this.access) {
      await this.access.assertAllowed(user, {
        resource: "pages",
        action: "read",
        targetType: "page",
        targetId: id,
      });
    }
    const allowedIds =
      user && this.access ? await this.allowedPageIds(user, "read") : null;
    if (allowedIds && allowedIds.length === 0) return [];
    const accessCondition = allowedIds
      ? Prisma.sql`AND p.id IN (${Prisma.join(allowedIds)})`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<RelatedPageRow[]>(Prisma.sql`
      WITH source AS (
        SELECT category_id
        FROM pages
        WHERE id = ${id} AND type::text = 'PAGE' AND deleted_at IS NULL
      ), source_tags AS (
        SELECT tag_id
        FROM tags_on_pages
        WHERE page_id = ${id}
      )
      SELECT
        p.id,
        p.title,
        p.slug,
        p.excerpt,
        COALESCE(
          array_agg(DISTINCT t.name ORDER BY t.name) FILTER (WHERE t.name IS NOT NULL),
          ARRAY[]::text[]
        ) AS shared_tags,
        c.id AS category_id,
        c.name AS category_name,
        c.slug AS category_slug
      FROM pages p
      CROSS JOIN source s
      LEFT JOIN tags_on_pages candidate_tags ON candidate_tags.page_id = p.id
      LEFT JOIN source_tags shared ON shared.tag_id = candidate_tags.tag_id
      LEFT JOIN tags t ON t.id = shared.tag_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id <> ${id}
        ${accessCondition}
        AND p.type::text = 'PAGE'
        AND p.deleted_at IS NULL
        AND (
          shared.tag_id IS NOT NULL
          OR (s.category_id IS NOT NULL AND p.category_id = s.category_id)
        )
      GROUP BY p.id, p.title, p.slug, p.excerpt, p.updated_at,
        c.id, c.name, c.slug, s.category_id, p.category_id
      ORDER BY
        COUNT(DISTINCT shared.tag_id) DESC,
        (s.category_id IS NOT NULL AND p.category_id = s.category_id) DESC,
        p.updated_at DESC,
        p.title ASC
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt,
      sharedTags: row.shared_tags,
      category: row.category_id
        ? { id: row.category_id, name: row.category_name!, slug: row.category_slug! }
        : null,
    }));
  }

  /** Anonym lesbar sind nur explizit öffentliche, veröffentlichte Inhaltsseiten. */
  async findPublicBySlug(slug: string) {
    const page = await this.prisma.page.findFirst({
      where: { slug, isPublic: true, status: PageStatus.PUBLISHED, type: PageType.PAGE, deletedAt: null },
      select: { title: true, slug: true, content: true, updatedAt: true },
    });
    if (!page) throw new NotFoundException(`Öffentliche Seite "${slug}" wurde nicht gefunden.`);
    return {
      ...page,
      content: await this.normalizeMediaUrls(page.content),
      updatedAt: page.updatedAt.toISOString(),
    };
  }

  /**
   * Erstellt eine neue Seite oder einen Ordner mit eindeutigem Slug.
   * Der Autor (`authorId`) stammt aus dem authentifizierten User (JWT),
   * niemals aus dem Request-Body – siehe PagesController.
   */
  async create(
    input: CreatePageInput,
    authorId: string,
    actor?: AuthenticatedUser,
  ) {
    const spaceId = await this.resolvePageSpace(input);
    await this.assertPageDestination(actor, input, spaceId, "create");
    const slug = await this.generateUniqueSlug(input.title);

    const page = await this.prisma.page.create({
      data: {
        title: input.title,
        space: { connect: { id: spaceId } },
        slug,
        type: TYPE_TO_DB[input.type],
        content: input.content,
        excerpt: input.excerpt,
        status: STATUS_TO_DB[input.status],
        isPublic: input.isPublic,
        mcpVisible: input.mcpVisible,
        author: { connect: { id: authorId } },
        category: input.categoryId
          ? { connect: { id: input.categoryId } }
          : undefined,
        parent: input.parentId
          ? { connect: { id: input.parentId } }
          : undefined,
        tags: { create: this.tagRelations(input.tags) },
      },
      include: { tags: { include: { tag: { select: { name: true } } } } },
    });

    await Promise.all([
      this.syncLinks(page.id, page.content),
      this.syncMediaReferences(page.id, page.content),
    ]);
    return this.toApiPage(page);
  }

  /**
   * Importiert eine bereits hochgeladene Markdown-Datei als neue Wiki-Seite.
   * Der Inhalt wird von der Festplatte gelesen (niemals aus dem Request), und
   * das Medium wird der erzeugten Seite als Anhang zugeordnet.
   */
  async importMarkdownFromMedia(
    input: ImportMarkdownInput,
    authorId: string,
    actor?: AuthenticatedUser,
  ) {
    const media = await this.prisma.media.findUnique({ where: { id: input.mediaId } });
    if (!media) {
      throw new NotFoundException(`Medium mit ID "${input.mediaId}" wurde nicht gefunden.`);
    }
    const isMarkdown =
      /\.(md|markdown)$/i.test(media.filename) ||
      media.mimetype === "text/markdown" ||
      media.mimetype === "text/x-markdown";
    if (!isMarkdown) {
      throw new BadRequestException(
        "Nur Markdown-Dateien können als Wiki-Seite importiert werden.",
      );
    }

    const absolutePath = join(UPLOAD_DIR, media.filepath.replace(/^uploads[/\\]/, ""));
    let content: string;
    try {
      content = await readFile(absolutePath, "utf8");
    } catch {
      throw new BadRequestException("Die Markdown-Datei konnte nicht gelesen werden.");
    }

    const page = await this.create(
      {
        title: input.title,
        spaceId: input.spaceId,
        type: "page",
        content,
        status: input.status,
        isPublic: false,
        mcpVisible: false,
        categoryId: input.categoryId ?? null,
        parentId: null,
        tags: [],
      },
      authorId,
      actor,
    );

    // Das Quell-Medium der neuen Seite als Anhang zuordnen (Duplikat ignorieren).
    await this.prisma.pageMedia
      .create({ data: { pageId: page.id, mediaId: media.id } })
      .catch(() => undefined);

    return page;
  }

  /**
   * Bearbeitet eine Seite. Vor dem Überschreiben wird der aktuelle Zustand
   * automatisch als PageVersion gesichert und die Versionsnummer erhöht.
   * Der Slug bleibt als stabiler Permalink unverändert.
   */
  async update(id: string, input: UpdatePageInput, options: PageUpdateOptions = {}) {
    const existing = await this.prisma.page.findFirst({ where: { id, deletedAt: null } });
    if (!existing) {
      throw new NotFoundException(`Seite mit ID "${id}" wurde nicht gefunden.`);
    }
    if (options.actor && this.access) {
      await this.access.assertAllowed(options.actor, {
        resource: "pages",
        action: "update",
        targetType: "page",
        targetId: id,
      });
    }
    if (options.expectedVersion !== undefined && existing.version !== options.expectedVersion) {
      throw new ConflictException(
        `Versionskonflikt: erwartet ${options.expectedVersion}, aktuell ${existing.version}.`,
      );
    }
    const assignmentChanged =
      input.spaceId !== undefined ||
      input.categoryId !== undefined ||
      input.parentId !== undefined;
    const spaceId = assignmentChanged
      ? await this.resolvePageSpace(input, existing)
      : existing.spaceId;
    if (assignmentChanged) {
      await this.assertPageDestination(
        options.actor,
        input,
        spaceId,
        "update",
        existing,
      );
    }
    if (spaceId && spaceId !== existing.spaceId) {
      const childCount = await this.prisma.page.count({
        where: { parentId: id, deletedAt: null },
      });
      if (childCount > 0) {
        throw new BadRequestException(
          "Ein Ordner mit untergeordneten Inhalten kann nicht in einen anderen Bereich verschoben werden.",
        );
      }
    }

    const data: Prisma.PageUpdateInput = {
      version: existing.version + 1,
      ...(spaceId ? { space: { connect: { id: spaceId } } } : {}),
    };
    if (input.title !== undefined) data.title = input.title;
    if (input.content !== undefined) data.content = input.content;
    if (input.excerpt !== undefined) data.excerpt = input.excerpt;
    if (input.status !== undefined) data.status = STATUS_TO_DB[input.status];
    if (input.isPublic !== undefined) data.isPublic = input.isPublic;
    if (input.mcpVisible !== undefined) data.mcpVisible = input.mcpVisible;
    if (input.type !== undefined) data.type = TYPE_TO_DB[input.type];
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.categoryId !== undefined) {
      data.category = input.categoryId
        ? { connect: { id: input.categoryId } }
        : { disconnect: true };
    }
    if (input.parentId !== undefined) {
      data.parent = input.parentId
        ? { connect: { id: input.parentId } }
        : { disconnect: true };
    }
    if (input.tags !== undefined) {
      data.tags = {
        deleteMany: {},
        create: this.tagRelations(input.tags),
      };
    }

    const updated = await this.prisma.$transaction([
      // Snapshot des bisherigen Zustands. Bei MCP-Updates wird der tatsächliche
      // Tokenbenutzer als Bearbeiter gespeichert, sonst bleibt das REST-Verhalten erhalten.
      this.prisma.pageVersion.create({
        data: {
          title: existing.title,
          content: existing.content,
          version: existing.version,
          changeMessage: input.changeMessage,
          page: { connect: { id: existing.id } },
          author: { connect: { id: options.editorId ?? existing.authorId } },
        },
      }),
      this.prisma.page.update({
        where: {
          id,
          deletedAt: null,
          ...(options.expectedVersion === undefined
            ? {}
            : { version: options.expectedVersion }),
        },
        data,
        include: { tags: { include: { tag: { select: { name: true } } } } },
      }),
    ]).then(([, page]) => page).catch((error: unknown) => {
      if (
        options.expectedVersion !== undefined
        && error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2025"
      ) {
        throw new ConflictException(
          `Versionskonflikt: Die Seite wurde zwischenzeitlich geändert.`,
        );
      }
      throw error;
    });

    await Promise.all([
      this.syncLinks(updated.id, updated.content),
      this.syncMediaReferences(updated.id, updated.content),
    ]);
    return this.toApiPage(updated);
  }

  /** Schaltet eine Checkliste ohne Versionssnapshot oder Änderung der fachlichen Versionsnummer. */
  async toggleCheckbox(
    id: string,
    input: ToggleCheckboxInput,
    actor?: AuthenticatedUser,
  ) {
    const existing = await this.prisma.page.findFirst({
      where: { id, type: PageType.PAGE, deletedAt: null },
      select: { id: true, content: true },
    });
    if (!existing) throw new NotFoundException(`Seite mit ID "${id}" wurde nicht gefunden.`);
    if (actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "pages",
        action: "update",
        targetType: "page",
        targetId: id,
      });
    }

    const content = toggleCheckboxInContent(existing.content, input.checkboxIndex, input.checked);
    if (content === null) {
      throw new BadRequestException(`Checkbox mit Index ${input.checkboxIndex} wurde nicht gefunden.`);
    }

    const updated = await this.prisma.page.update({
      where: { id, deletedAt: null },
      data: { content },
      include: { tags: { include: { tag: { select: { name: true } } } } },
    });
    return this.toApiPage(updated);
  }

  /** Liefert nur den Zustand, der vor einem geschützten MCP-Update benötigt wird. */
  async findUpdateState(id: string, actor?: AuthenticatedUser) {
    const page = await this.prisma.page.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, type: true, status: true, version: true },
    });
    if (!page) {
      throw new NotFoundException(`Seite mit ID "${id}" wurde nicht gefunden.`);
    }
    if (actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "pages",
        action: "update",
        targetType: "page",
        targetId: id,
      });
    }
    return page;
  }

  /**
   * Löscht eine Seite; zugehörige Versionen werden per Cascade entfernt.
   * Gibt Titel und Slug der gelöschten Seite zurück (für das Audit-Log).
   */
  async remove(
    id: string,
    deletedById: string,
    actor?: AuthenticatedUser,
  ) {
    const existing = await this.prisma.page.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, title: true, slug: true, type: true },
    });
    if (!existing) {
      throw new NotFoundException(`Seite mit ID "${id}" wurde nicht gefunden.`);
    }
    if (actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "pages",
        action: "delete",
        targetType: "page",
        targetId: id,
      });
      if (existing.type === PageType.FOLDER) {
        const children = await this.prisma.page.findMany({
          where: { parentId: id, deletedAt: null },
          select: { id: true },
        });
        const allowedChildren = await this.access.allowedTargetIds(actor, {
          resource: "pages",
          action: "update",
          targetType: "page",
          targetIds: children.map((child) => child.id),
        });
        if (allowedChildren.length !== children.length) {
          throw new NotFoundException(
            "Ordner wurde nicht gefunden oder enthÃ¤lt nicht verschiebbare Inhalte.",
          );
        }
      }
    }
    await this.prisma.$transaction(async (tx) => {
      // Beim Löschen eines Ordners bleiben dessen Inhaltsseiten erhalten und
      // werden auf die Kategorieebene verschoben, wie bei gelöschten Kategorien.
      if (existing.type === PageType.FOLDER) {
        await tx.page.updateMany({
          where: { parentId: id, deletedAt: null },
          data: { parentId: null },
        });
      }
      await tx.page.update({ where: { id }, data: { deletedAt: new Date(), deletedById } });
    });
    return existing;
  }

  /** Returns soft-deleted pages. Retention cleanup can permanently remove records older than 30 days. */
  async findTrash(user?: AuthenticatedUser) {
    const allowedIds =
      user && this.access
        ? await this.allowedPageIds(user, "update", {
            deletedAt: { not: null },
          })
        : null;
    const pages = await this.prisma.page.findMany({
      where: {
        deletedAt: { not: null },
        ...(allowedIds ? { id: { in: allowedIds } } : {}),
      },
      orderBy: { deletedAt: "desc" },
      include: { deletedBy: { select: { id: true, displayName: true } } },
    });
    return pages.map((page) => ({ ...this.toApiPage(page), deletedAt: page.deletedAt!.toISOString(), deletedBy: page.deletedBy }));
  }

  async restore(id: string, actor?: AuthenticatedUser) {
    const page = await this.prisma.page.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!page) throw new NotFoundException(`Gelöschte Seite mit ID "${id}" wurde nicht gefunden.`);
    if (actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "pages",
        action: "update",
        targetType: "page",
        targetId: id,
      });
    }
    return this.toApiPage(await this.prisma.page.update({ where: { id }, data: { deletedAt: null, deletedById: null } }));
  }

  async permanentRemove(id: string, actor?: AuthenticatedUser) {
    const page = await this.prisma.page.findFirst({ where: { id, deletedAt: { not: null } }, select: { id: true, title: true, slug: true } });
    if (!page) throw new NotFoundException(`Gelöschte Seite mit ID "${id}" wurde nicht gefunden.`);
    if (actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "pages",
        action: "purge",
        targetType: "page",
        targetId: id,
      });
    }
    await this.prisma.page.delete({ where: { id } });
    return page;
  }

  /** Permanently removes all soft-deleted pages; only the admin controller route may call this. */
  async emptyTrash(actor?: AuthenticatedUser) {
    const allowedIds =
      actor && this.access
        ? await this.allowedPageIds(actor, "purge", {
            deletedAt: { not: null },
          })
        : null;
    const result = await this.prisma.page.deleteMany({
      where: {
        deletedAt: { not: null },
        ...(allowedIds ? { id: { in: allowedIds } } : {}),
      },
    });
    return result.count;
  }

  /** Liefert die Versionshistorie einer Seite (neueste zuerst). */
  async findVersions(id: string, user?: AuthenticatedUser) {
    const exists = await this.prisma.page.findUnique({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`Seite mit ID "${id}" wurde nicht gefunden.`);
    }
    if (user && this.access) {
      await this.access.assertAllowed(user, {
        resource: "pages",
        action: "read",
        targetType: "page",
        targetId: id,
      });
    }

    const versions = await this.prisma.pageVersion.findMany({
      where: { pageId: id },
      orderBy: { version: "desc" },
      include: { author: { select: { id: true, displayName: true } } },
    });

    return versions.map((version) => ({
      id: version.id,
      title: version.title,
      content: version.content,
      version: version.version,
      changeMessage: version.changeMessage,
      authorId: version.authorId,
      author: version.author,
      createdAt: version.createdAt.toISOString(),
    }));
  }

  /**
   * Aktuellen Autosave-Entwurf einer Seite für den angegebenen Benutzer laden.
   * Gibt `null` zurück, wenn (noch) kein Entwurf existiert.
   */
  async findDraft(pageId: string, userId: string, actor?: AuthenticatedUser) {
    await this.ensurePageExists(pageId);
    if (actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "pages",
        action: "update",
        targetType: "page",
        targetId: pageId,
      });
    }
    const draft = await this.prisma.pageDraft.findUnique({
      where: { pageId_userId: { pageId, userId } },
    });
    return draft ? this.toApiDraft(draft) : null;
  }

  /**
   * Entwurf speichern (Upsert). Pro (Seite, Benutzer) existiert genau einer –
   * ein erneuter Aufruf überschreibt den vorherigen Stand.
   */
  async saveDraft(
    pageId: string,
    userId: string,
    input: SavePageDraftInput,
    actor?: AuthenticatedUser,
  ) {
    await this.ensurePageExists(pageId);
    if (actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "pages",
        action: "update",
        targetType: "page",
        targetId: pageId,
      });
    }
    const data = {
      title: input.title,
      content: input.content,
      status: STATUS_TO_DB[input.status],
      isPublic: input.isPublic,
      mcpVisible: input.mcpVisible,
      tags: input.tags,
    };
    const draft = await this.prisma.pageDraft.upsert({
      where: { pageId_userId: { pageId, userId } },
      create: { pageId, userId, ...data },
      update: data,
    });
    return this.toApiDraft(draft);
  }

  /** Entwurf verwerfen (nach echtem Speichern oder auf Wunsch des Benutzers). */
  async deleteDraft(
    pageId: string,
    userId: string,
    actor?: AuthenticatedUser,
  ): Promise<void> {
    await this.ensurePageExists(pageId);
    if (actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "pages",
        action: "update",
        targetType: "page",
        targetId: pageId,
      });
    }
    await this.prisma.pageDraft.deleteMany({ where: { pageId, userId } });
  }

  /** Wirft 404, wenn die Seite nicht existiert oder im Papierkorb liegt. */
  private async ensurePageExists(id: string): Promise<void> {
    const exists = await this.prisma.page.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`Seite mit ID "${id}" wurde nicht gefunden.`);
    }
  }

  /** DB-Entwurf in das API-Format überführen (Enum-Mapping, ISO-Datum). */
  private toApiDraft(draft: Prisma.PageDraftGetPayload<object>) {
    return {
      title: draft.title,
      content: draft.content,
      status: STATUS_TO_API[draft.status],
      isPublic: draft.isPublic,
      mcpVisible: draft.mcpVisible,
      tags: draft.tags,
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  /** Alle bekannten Tags alphabetisch, für Vorschläge im Editor. */
  async findTags(user?: AuthenticatedUser): Promise<string[]> {
    const allowedIds =
      user && this.access ? await this.allowedPageIds(user, "read") : null;
    const tags = await this.prisma.tag.findMany({
      where: allowedIds
        ? { pages: { some: { pageId: { in: allowedIds } } } }
        : undefined,
      orderBy: { name: "asc" },
      select: { name: true },
    });
    return tags.map((tag) => tag.name);
  }

  /**
   * Baumstruktur einer Kategorie für die Sidebar:
   * Kategorie → Ordner (type=FOLDER) → Seiten (type=PAGE).
   * Seiten ohne Ordner-Zuordnung werden separat als `pages` ausgegeben.
   */
  async buildTree(
    categorySlug: string,
    spaceId = DEFAULT_SPACE_ID,
    user?: AuthenticatedUser,
  ) {
    const category = await this.prisma.category.findUnique({
      where: {
        spaceId_scope_slug: {
          spaceId,
          scope: CategoryScope.WIKI,
          slug: categorySlug,
        },
      },
    });
    if (!category) {
      throw new NotFoundException(
        `Kategorie "${categorySlug}" wurde nicht gefunden.`,
      );
    }
    if (user && this.access) {
      await this.access.assertAllowed(user, {
        resource: "pages",
        action: "read",
        targetType: "category",
        targetId: category.id,
      });
    }
    const allowedIds =
      user && this.access
        ? await this.allowedPageIds(user, "read", {
            categoryId: category.id,
            deletedAt: null,
          })
        : null;

    const folders = await this.prisma.page.findMany({
      where: {
        categoryId: category.id,
        type: PageType.FOLDER,
        deletedAt: null,
        ...(allowedIds ? { id: { in: allowedIds } } : {}),
      },
      orderBy: { sortOrder: "asc" },
      include: {
        children: {
          where: {
            type: PageType.PAGE,
            deletedAt: null,
            ...(allowedIds ? { id: { in: allowedIds } } : {}),
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    const rootPages = await this.prisma.page.findMany({
      where: {
        categoryId: category.id,
        type: PageType.PAGE,
        parentId: null,
        deletedAt: null,
        ...(allowedIds ? { id: { in: allowedIds } } : {}),
      },
      orderBy: { sortOrder: "asc" },
    });

    return {
      category: {
        id: category.id,
        name: category.name,
        slug: category.slug,
        icon: category.icon,
        description: category.description,
      },
      folders: folders.map((folder) => ({
        ...this.toApiPage(folder),
        pages: folder.children.map((child) => this.toApiPage(child)),
      })),
      pages: rootPages.map((page) => this.toApiPage(page)),
    };
  }

  /**
   * Baumstruktur der Seiten OHNE Kategorie (categoryId = null), gleiche Form
   * wie {@link buildTree}, damit die Sidebar sie als „Unkategorisiert"-Bereich
   * anzeigen kann. Ordner und Seiten ohne Ordner-Zuordnung werden getrennt.
   */
  async buildUncategorizedTree(
    spaceId = DEFAULT_SPACE_ID,
    user?: AuthenticatedUser,
  ) {
    if (user && this.access) {
      await this.access.assertAllowed(user, {
        resource: "pages",
        action: "read",
        targetType: "space",
        targetId: spaceId,
      });
    }
    const allowedIds =
      user && this.access
        ? await this.allowedPageIds(user, "read", {
            spaceId,
            categoryId: null,
            deletedAt: null,
          })
        : null;
    const folders = await this.prisma.page.findMany({
      where: {
        spaceId,
        categoryId: null,
        type: PageType.FOLDER,
        deletedAt: null,
        ...(allowedIds ? { id: { in: allowedIds } } : {}),
      },
      orderBy: { sortOrder: "asc" },
      include: {
        children: {
          where: {
            type: PageType.PAGE,
            deletedAt: null,
            ...(allowedIds ? { id: { in: allowedIds } } : {}),
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    const rootPages = await this.prisma.page.findMany({
      where: {
        spaceId,
        categoryId: null,
        type: PageType.PAGE,
        parentId: null,
        deletedAt: null,
        ...(allowedIds ? { id: { in: allowedIds } } : {}),
      },
      orderBy: { sortOrder: "asc" },
    });

    return {
      folders: folders.map((folder) => ({
        ...this.toApiPage(folder),
        pages: folder.children.map((child) => this.toApiPage(child)),
      })),
      pages: rootPages.map((page) => this.toApiPage(page)),
    };
  }

  /** Synchronisiert `[[slug]]` bzw. `[[Seitentitel]]` als gerichtete Link-Kanten. */
  private async syncLinks(sourceId: string, content: string) {
    const labels = [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)]
      .map((match) => match[1].trim())
      .filter(Boolean);
    const slugs = [...new Set(labels.map((label) => slugify(label, { lower: true, strict: true })))]
      .filter(Boolean);
    const targets = slugs.length
      ? await this.prisma.page.findMany({ where: { slug: { in: slugs }, id: { not: sourceId }, deletedAt: null }, select: { id: true } })
      : [];
    await this.prisma.$transaction([
      this.prisma.pageLink.deleteMany({ where: { sourceId } }),
      ...(targets.length ? [this.prisma.pageLink.createMany({ data: targets.map((target) => ({ sourceId, targetId: target.id })), skipDuplicates: true })] : []),
    ]);
  }

  /** Verknuepft im Inhalt referenzierte API-Medien mit der Seite. */
  private async syncMediaReferences(pageId: string, content: string): Promise<void> {
    const mediaIds = [...new Set(
      [...content.matchAll(/\/api\/v1\/media\/([0-9a-f-]{36})\/file(?:[?#][^\s"')<]*)?/gi)]
        .map((match) => match[1]),
    )];
    if (mediaIds.length === 0) return;
    const existing = await this.prisma.media.findMany({
      where: { id: { in: mediaIds } },
      select: { id: true },
    });
    if (existing.length > 0) {
      await this.prisma.pageMedia.createMany({
        data: existing.map((media) => ({ pageId, mediaId: media.id })),
        skipDuplicates: true,
      });
    }
  }

  /** Migriert alte /uploads-Referenzen beim Lesen auf den geschuetzten API-Pfad. */
  private async normalizeMediaUrls(content: string): Promise<string> {
    const paths = [...new Set(
      [...content.matchAll(/\/uploads\/([^\s"')<]+)/g)].map((match) => `uploads/${match[1]}`),
    )];
    if (paths.length === 0) return content;
    const media = await this.prisma.media.findMany({
      where: { filepath: { in: paths } },
      select: { id: true, filepath: true },
    });
    return media.reduce(
      (current, item) => current.replaceAll(
        `/${item.filepath}`,
        `/api/v1/media/${item.id}/file`,
      ),
      content,
    );
  }

  async findBacklinks(slug: string, user?: AuthenticatedUser) {
    const page = await this.prisma.page.findFirst({ where: { slug, deletedAt: null }, select: { id: true } });
    if (!page) throw new NotFoundException(`Seite "${slug}" wurde nicht gefunden.`);
    if (user && this.access) {
      await this.access.assertAllowed(user, {
        resource: "pages",
        action: "read",
        targetType: "page",
        targetId: page.id,
      });
    }
    const allowedIds =
      user && this.access ? await this.allowedPageIds(user, "read") : null;
    const links = await this.prisma.pageLink.findMany({
      where: {
        targetId: page.id,
        source: {
          deletedAt: null,
          ...(allowedIds ? { id: { in: allowedIds } } : {}),
        },
      },
      orderBy: { createdAt: "desc" },
      select: { source: { select: { id: true, title: true, slug: true } } },
    });
    return links.map((link) => link.source);
  }

  async findStandardBacklinks(slug: string, user: AuthenticatedUser) {
    if (!(await this.hasPermission(user, "standards", "read"))) return [];
    const page = await this.prisma.page.findFirst({ where: { slug, deletedAt: null }, select: { id: true } });
    if (!page) throw new NotFoundException(`Seite "${slug}" wurde nicht gefunden.`);
    if (this.access) {
      await this.access.assertAllowed(user, {
        resource: "pages",
        action: "read",
        targetType: "page",
        targetId: page.id,
      });
    }
    const standardIds = await this.prisma.standardPageLink.findMany({
      where: { pageId: page.id },
      select: { standardId: true },
    });
    const allowedStandardIds = this.access
      ? await this.access.allowedTargetIds(user, {
          resource: "standards",
          action: "read",
          targetType: "standard",
          targetIds: standardIds.map((link) => link.standardId),
        })
      : standardIds.map((link) => link.standardId);
    const links = await this.prisma.standardPageLink.findMany({
      where: { pageId: page.id, standardId: { in: allowedStandardIds } },
      orderBy: { standard: { title: "asc" } },
      select: { standard: { select: { id: true, title: true, slug: true, status: true } } },
    });
    return links.map((link) => ({ ...link.standard, status: link.standard.status.toLowerCase() }));
  }

  async findGraph(user: AuthenticatedUser, mcpOnly = false) {
    let [pages, categories] = await Promise.all([
      this.prisma.page.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
        select: {
          id: true,
          title: true,
          slug: true,
          type: true,
          mcpVisible: true,
          categoryId: true,
          parentId: true,
        },
      }),
      this.prisma.category.findMany({
        where: { scope: CategoryScope.WIKI },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, slug: true },
      }),
    ]);
    if (this.access) {
      const [allowedPageIds, allowedCategoryIds] = await Promise.all([
        this.access.allowedTargetIds(user, {
          resource: "pages",
          action: "read",
          targetType: "page",
          targetIds: pages.map((page) => page.id),
        }),
        this.access.allowedTargetIds(user, {
          resource: "categories",
          action: "read",
          targetType: "category",
          targetIds: categories.map((category) => category.id),
        }),
      ]);
      const allowedPages = new Set(allowedPageIds);
      const allowedCategories = new Set(allowedCategoryIds);
      pages = pages.filter((page) => allowedPages.has(page.id));
      categories = categories.filter((category) => allowedCategories.has(category.id));
    }
    const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

    const canReadNotes = await this.hasPermission(user, "notes", "read");
    let notes = canReadNotes
      ? await this.prisma.note.findMany({
          where: {
            deletedAt: null,
            ...(mcpOnly ? { mcpVisible: true } : {}),
            OR: [
              {
                spaceId: null,
                OR: [{ ownerId: user.id }, { shares: { some: { userId: user.id } } }],
              },
              { spaceId: { not: null } },
            ],
          },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            title: true,
            content: true,
            mcpVisible: true,
            categoryId: true,
          },
        })
      : [];
    if (this.access) {
      const allowedNoteIds = await this.access.allowedTargetIds(user, {
        resource: "notes",
        action: "read",
        targetType: "note",
        targetIds: notes.map((note) => note.id),
      });
      const allowed = new Set(allowedNoteIds);
      notes = notes.filter((note) => allowed.has(note.id));
    }
    let allNoteCategories = canReadNotes
      ? await this.prisma.category.findMany({
          where: { scope: CategoryScope.NOTE },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: { id: true, name: true, slug: true },
        })
      : [];
    if (this.access) {
      const allowedCategoryIds = await this.access.allowedTargetIds(user, {
        resource: "categories",
        action: "read",
        targetType: "category",
        targetIds: allNoteCategories.map((category) => category.id),
      });
      const allowed = new Set(allowedCategoryIds);
      allNoteCategories = allNoteCategories.filter((category) => allowed.has(category.id));
    }
    const relevantNoteCategoryIds = new Set(
      notes.map((note) => note.categoryId).filter((id): id is string => Boolean(id)),
    );
    const noteCategories = mcpOnly
      ? allNoteCategories.filter((category) => relevantNoteCategoryIds.has(category.id))
      : allNoteCategories;
    const noteCategoryIds = new Set(noteCategories.map((category) => category.id));
    const noteCategoryNames = new Map(noteCategories.map((category) => [category.id, category.name]));
    const includeNotesBranch = canReadNotes && (!mcpOnly || notes.length > 0);

    const canReadStandards = await this.hasPermission(user, "standards", "read");
    let standards = canReadStandards
      ? await this.prisma.standard.findMany({
          where: mcpOnly ? { status: "ACTIVE", mcpVisible: true } : {},
          orderBy: { title: "asc" },
          select: { id: true, title: true, slug: true, mcpVisible: true, categoryId: true, pages: { select: { pageId: true } } },
        })
      : [];
    if (this.access) {
      const allowedStandardIds = await this.access.allowedTargetIds(user, {
        resource: "standards",
        action: "read",
        targetType: "standard",
        targetIds: standards.map((standard) => standard.id),
      });
      const allowed = new Set(allowedStandardIds);
      standards = standards.filter((standard) => allowed.has(standard.id));
    }
    let allStandardCategories = canReadStandards
      ? await this.prisma.category.findMany({ where: { scope: CategoryScope.STANDARD }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, slug: true } })
      : [];
    if (this.access) {
      const allowedCategoryIds = await this.access.allowedTargetIds(user, {
        resource: "categories",
        action: "read",
        targetType: "category",
        targetIds: allStandardCategories.map((category) => category.id),
      });
      const allowed = new Set(allowedCategoryIds);
      allStandardCategories = allStandardCategories.filter((category) => allowed.has(category.id));
    }
    const relevantStandardCategoryIds = new Set(standards.map((standard) => standard.categoryId).filter((id): id is string => Boolean(id)));
    const standardCategories = mcpOnly ? allStandardCategories.filter((category) => relevantStandardCategoryIds.has(category.id)) : allStandardCategories;
    const standardCategoryIds = new Set(standardCategories.map((category) => category.id));
    const standardCategoryNames = new Map(standardCategories.map((category) => [category.id, category.name]));
    const includeStandardsBranch = canReadStandards && (!mcpOnly || standards.length > 0);

    const contentPages = pages.filter(
      (page) => page.type === PageType.PAGE && (!mcpOnly || page.mcpVisible),
    );
    const contentIds = contentPages.map((page) => page.id);
    const wikiLinks = contentIds.length
      ? await this.prisma.pageLink.findMany({
          where: {
            sourceId: { in: contentIds },
            targetId: { in: contentIds },
          },
          select: { sourceId: true, targetId: true },
        })
      : [];

    const relevantFolderIds = new Set<string>();
    if (mcpOnly) {
      contentPages.forEach((page) => {
        if (page.parentId) relevantFolderIds.add(page.parentId);
      });
      // Auch verschachtelte Ordner als Kontext mitnehmen, falls sie später
      // über Konnektoren oder eine tiefere Wiki-Struktur verwendet werden.
      let addedParent = true;
      while (addedParent) {
        addedParent = false;
        pages.forEach((page) => {
          if (page.type === PageType.FOLDER && relevantFolderIds.has(page.id) && page.parentId && !relevantFolderIds.has(page.parentId)) {
            relevantFolderIds.add(page.parentId);
            addedParent = true;
          }
        });
      }
    }

    const relevantPages = mcpOnly
      ? pages.filter((page) => contentIds.includes(page.id) || relevantFolderIds.has(page.id))
      : pages;
    const relevantCategoryIds = new Set(relevantPages.map((page) => page.categoryId).filter((id): id is string => Boolean(id)));
    const relevantCategories = mcpOnly
      ? categories.filter((category) => relevantCategoryIds.has(category.id))
      : categories;
    const pageIds = new Set(relevantPages.map((page) => page.id));
    const categoryIds = new Set(relevantCategories.map((category) => category.id));
    const structureLinks = relevantPages.map((page) => {
      const parentExists = page.parentId && pageIds.has(page.parentId);
      const categoryExists = page.categoryId && categoryIds.has(page.categoryId);
      return {
        sourceId: parentExists
          ? page.parentId!
          : categoryExists
            ? page.categoryId!
            : "wiki-root",
        targetId: page.id,
        kind: "structure" as const,
      };
    });

    return {
      nodes: [
        {
          id: "knowledge-root",
          title: "AD-Wiki Knowledge",
          slug: "",
          type: "root" as const,
          mcpVisible: false,
          group: "Knowledge",
        },
        {
          id: "wiki-root",
          title: "Wiki",
          slug: "",
          type: "wiki" as const,
          mcpVisible: false,
          group: "Wiki",
        },
        ...(includeNotesBranch ? [{
          id: "notes-root",
          title: "Notizen",
          slug: "",
          type: "note-root" as const,
          mcpVisible: false,
          group: "Notizen",
        }] : []),
        ...(includeStandardsBranch ? [{
          id: "standards-root",
          title: "Richtlinien",
          slug: "",
          type: "standard-root" as const,
          mcpVisible: false,
          group: "Richtlinien",
        }] : []),
        ...relevantCategories.map((category) => ({
          id: category.id,
          title: category.name,
          slug: category.slug,
          type: "category" as const,
          mcpVisible: false,
          group: category.name,
        })),
        ...relevantPages.map((page) => ({
          id: page.id,
          title: page.title,
          slug: page.slug,
          type: page.type === PageType.FOLDER ? "folder" as const : "page" as const,
          mcpVisible: page.mcpVisible,
          group: page.categoryId ? categoryNames.get(page.categoryId) ?? "Uncategorized" : "Uncategorized",
        })),
        ...noteCategories.map((category) => ({
          id: category.id,
          title: category.name,
          slug: category.slug,
          type: "note-category" as const,
          mcpVisible: false,
          group: category.name,
        })),
        ...notes.map((note) => ({
          id: note.id,
          title: note.title?.trim() || note.content.split(/\r?\n/)[0].slice(0, 80) || "Unbenannte Notiz",
          slug: note.id,
          type: "note" as const,
          mcpVisible: note.mcpVisible,
          group: note.categoryId ? noteCategoryNames.get(note.categoryId) ?? "Notizen" : "Notizen",
        })),
        ...standardCategories.map((category) => ({
          id: category.id, title: category.name, slug: category.slug,
          type: "standard-category" as const, mcpVisible: false, group: category.name,
        })),
        ...standards.map((standard) => ({
          id: standard.id, title: standard.title, slug: standard.slug,
          type: "standard" as const, mcpVisible: standard.mcpVisible,
          group: standard.categoryId ? standardCategoryNames.get(standard.categoryId) ?? "Richtlinien" : "Richtlinien",
        })),
      ],
      links: [
        {
          sourceId: "knowledge-root",
          targetId: "wiki-root",
          kind: "structure" as const,
        },
        ...(includeNotesBranch ? [{
          sourceId: "knowledge-root",
          targetId: "notes-root",
          kind: "structure" as const,
        }] : []),
        ...(includeStandardsBranch ? [{
          sourceId: "knowledge-root", targetId: "standards-root", kind: "structure" as const,
        }] : []),
        ...relevantCategories.map((category) => ({
          sourceId: "wiki-root",
          targetId: category.id,
          kind: "structure" as const,
        })),
        ...structureLinks,
        ...noteCategories.map((category) => ({
          sourceId: "notes-root",
          targetId: category.id,
          kind: "structure" as const,
        })),
        ...notes.map((note) => ({
          sourceId: note.categoryId && noteCategoryIds.has(note.categoryId)
            ? note.categoryId
            : "notes-root",
          targetId: note.id,
          kind: "structure" as const,
        })),
        ...standardCategories.map((category) => ({ sourceId: "standards-root", targetId: category.id, kind: "structure" as const })),
        ...standards.map((standard) => ({
          sourceId: standard.categoryId && standardCategoryIds.has(standard.categoryId) ? standard.categoryId : "standards-root",
          targetId: standard.id, kind: "structure" as const,
        })),
        ...standards.flatMap((standard) => standard.pages
          .filter((link) => pageIds.has(link.pageId))
          .map((link) => ({ sourceId: standard.id, targetId: link.pageId, kind: "standard" as const }))),
        ...wikiLinks.map((link) => ({ ...link, kind: "wiki" as const })),
      ],
    };
  }

  /** Wandelt einen Prisma-Datensatz in das API-Format (Kleinbuchstaben-Enums, ISO-Daten) um. */
  private async allowedPageIds(
    user: AuthenticatedUser,
    action: "read" | "update" | "delete" | "purge",
    where: Prisma.PageWhereInput = { deletedAt: null },
  ): Promise<string[]> {
    if (!this.access) return [];
    const pages = await this.prisma.page.findMany({
      where,
      select: { id: true },
    });
    return this.access.allowedTargetIds(user, {
      resource: "pages",
      action,
      targetType: "page",
      targetIds: pages.map((page) => page.id),
    });
  }

  private async hasPermission(user: AuthenticatedUser, resource: string, action: string) {
    if (user.isProtected && user.authenticationMethod !== "apiKey") return true;
    if (
      user.apiKeyPermissions !== undefined &&
      user.apiKeyPermissions !== null &&
      !user.apiKeyPermissions.some(
        (permission) =>
          permission.resource === resource && permission.action === action,
      )
    ) {
      return false;
    }
    const [override, acl] = await Promise.all([
      this.prisma.userPermission.findUnique({
        where: { userId_resource_action: { userId: user.id, resource, action } },
        select: { allowed: true },
      }),
      this.prisma.acl.findUnique({
        where: { roleId_resource_action: { roleId: user.roleId, resource, action } },
        select: { allowed: true },
      }),
    ]);
    return override?.allowed ?? acl?.allowed ?? false;
  }

  private async assertPageDestination(
    actor: AuthenticatedUser | undefined,
    input: Pick<
      CreatePageInput | UpdatePageInput,
      "categoryId" | "parentId"
    >,
    spaceId: string,
    action: "create" | "update",
    existing?: Pick<PrismaPage, "categoryId" | "parentId">,
  ): Promise<void> {
    if (!actor || !this.access) return;
    const parentId =
      input.parentId === undefined ? existing?.parentId : input.parentId;
    const categoryId =
      input.categoryId === undefined ? existing?.categoryId : input.categoryId;
    await this.access.assertAllowed(actor, {
      resource: "pages",
      action,
      targetType: parentId ? "page" : categoryId ? "category" : "space",
      targetId: parentId ?? categoryId ?? spaceId,
    });
  }

  private async resolvePageSpace(
    input: Pick<
      CreatePageInput | UpdatePageInput,
      "spaceId" | "categoryId" | "parentId"
    >,
    existing?: Pick<
      PrismaPage,
      "id" | "spaceId" | "categoryId" | "parentId"
    >,
  ): Promise<string> {
    const categoryId =
      input.categoryId === undefined
        ? existing?.categoryId ?? null
        : input.categoryId;
    const parentId =
      input.parentId === undefined
        ? existing?.parentId ?? null
        : input.parentId;

    if (parentId && parentId === existing?.id) {
      throw new BadRequestException(
        "Eine Wiki-Seite kann nicht ihr eigener Elternordner sein.",
      );
    }

    const [category, parent] = await Promise.all([
      categoryId
        ? this.prisma.category.findUnique({
            where: { id: categoryId },
            select: { scope: true, spaceId: true },
          })
        : null,
      parentId
        ? this.prisma.page.findFirst({
            where: { id: parentId, deletedAt: null },
            select: { type: true, spaceId: true, categoryId: true },
          })
        : null,
    ]);
    if (categoryId) {
      await this.ensureCategoryScope(categoryId, CategoryScope.WIKI);
    }
    if (categoryId && (!category || category.scope !== CategoryScope.WIKI)) {
      throw new BadRequestException(
        "Die gewählte Kategorie gehört nicht zum Wiki.",
      );
    }
    if (parentId && (!parent || parent.type !== PageType.FOLDER)) {
      throw new BadRequestException(
        "Der gewählte Elternknoten ist kein Wiki-Ordner.",
      );
    }

    const candidate =
      input.spaceId ??
      category?.spaceId ??
      parent?.spaceId ??
      existing?.spaceId;
    const spaceId = await this.spaces.resolveOpenSpace("wiki", candidate);
    if (
      (category && category.spaceId !== spaceId) ||
      (parent && parent.spaceId !== spaceId) ||
      (parent && parent.categoryId !== categoryId)
    ) {
      throw new BadRequestException(
        "Bereich, Kategorie und Elternordner müssen übereinstimmen.",
      );
    }
    return spaceId;
  }

  private async ensureCategoryScope(id: string, scope: CategoryScope) {
    const category = await this.prisma.category.findUnique({ where: { id }, select: { scope: true } });
    if (!category || category.scope !== scope) {
      throw new BadRequestException("Die gewählte Kategorie gehört nicht zum Wiki.");
    }
  }

  private toApiPage(page: PrismaPage & { tags?: Array<{ tag: { name: string } }> }) {
    return {
      id: page.id,
      spaceId: page.spaceId,
      title: page.title,
      slug: page.slug,
      type: TYPE_TO_API[page.type],
      content: page.content,
      excerpt: page.excerpt,
      status: STATUS_TO_API[page.status],
      isPublic: page.isPublic,
      mcpVisible: page.mcpVisible,
      knowledgeType: "wiki" as const,
      knowledgePriority: 2 as const,
      authorId: page.authorId,
      categoryId: page.categoryId,
      parentId: page.parentId,
      tags: page.tags?.map((entry) => entry.tag.name) ?? [],
      version: page.version,
      sortOrder: page.sortOrder,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
    };
  }

  /** Normalisiert Tags und baut die Nested-Create-Daten für die Join-Tabelle. */
  private tagRelations(tags: string[]) {
    const unique = new Map<string, string>();
    for (const raw of tags) {
      const name = raw.trim();
      if (name) unique.set(name.toLocaleLowerCase("de-DE"), name);
    }
    return [...unique.values()].map((name) => {
      const generated = slugify(name, { lower: true, strict: true, locale: "de" });
      const fallback = Array.from(name)
        .map((character) => character.codePointAt(0)?.toString(16))
        .join("-");
      const slug = generated || `tag-${fallback}`;
      return {
        tag: {
          connectOrCreate: {
            where: { slug },
            create: { name, slug },
          },
        },
      };
    });
  }

  /**
   * Erzeugt aus dem Titel einen eindeutigen Slug. Bei Kollision wird ein
   * Zähler angehängt (z. B. "erste-seite", "erste-seite-2").
   */
  private async generateUniqueSlug(title: string): Promise<string> {
    const base = slugify(title, { lower: true, strict: true });
    let slug = base;
    let counter = 1;

    while (true) {
      const existing = await this.prisma.page.findUnique({
        where: { slug },
        select: { id: true },
      });

      if (!existing) {
        return slug;
      }

      counter += 1;
      slug = `${base}-${counter}`;
    }
  }
}
