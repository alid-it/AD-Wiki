import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import slugify from "slugify";
import { CategoryScope, type Category as PrismaCategory } from "@prisma/client";
import type { CategoryScope as ApiCategoryScope, CreateCategoryInput, UpdateCategoryInput } from "@ad-wiki/shared-types";
import { PrismaService } from "@/prisma/prisma.service";
import {
  DEFAULT_SPACE_ID,
  SpacesService,
} from "@/modules/spaces/spaces.service";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { ResourceAccessService } from "@/modules/resource-acls/resource-access.service";

const SCOPE_TO_DB: Record<ApiCategoryScope, CategoryScope> = {
  wiki: CategoryScope.WIKI,
  note: CategoryScope.NOTE,
  standard: CategoryScope.STANDARD,
};
const SCOPE_TO_API: Record<CategoryScope, ApiCategoryScope> = {
  [CategoryScope.WIKI]: "wiki",
  [CategoryScope.NOTE]: "note",
  [CategoryScope.STANDARD]: "standard",
};

/**
 * Geschäftslogik für Kategorien.
 * Alle Datenbankzugriffe laufen ausschließlich über den PrismaService.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService = new SpacesService(prisma),
    @Optional() private readonly access?: ResourceAccessService,
  ) {}

  /** Liefert alle Kategorien inklusive der Anzahl zugeordneter Seiten. */
  async findAll(
    scope: ApiCategoryScope = "wiki",
    spaceId = DEFAULT_SPACE_ID,
    user?: AuthenticatedUser,
  ) {
    let categories = await this.prisma.category.findMany({
      where: { scope: SCOPE_TO_DB[scope], spaceId },
      orderBy: { sortOrder: "asc" },
      include: {
        _count: { select: { pages: true, notes: true, standards: true } },
      },
    });
    if (user && this.access) {
      const allowedIds = await this.access.allowedTargetIds(user, {
        resource: "categories",
        action: "read",
        targetType: "category",
        targetIds: categories.map((category) => category.id),
      });
      const allowed = new Set(allowedIds);
      categories = categories.filter((category) => allowed.has(category.id));
    }
    const visibleCounts = new Map<
      string,
      { pages: number; notes: number; standards: number }
    >();
    if (user && this.access && categories.length > 0) {
      const categoryIds = categories.map((category) => category.id);
      const [pages, notes, standards] = await Promise.all([
        this.prisma.page.findMany({
          where: { categoryId: { in: categoryIds }, deletedAt: null },
          select: { id: true, categoryId: true },
        }),
        this.prisma.note.findMany({
          where: { categoryId: { in: categoryIds }, deletedAt: null },
          select: { id: true, categoryId: true },
        }),
        this.prisma.standard.findMany({
          where: { categoryId: { in: categoryIds } },
          select: { id: true, categoryId: true },
        }),
      ]);
      const [allowedPages, allowedNotes, allowedStandards] = await Promise.all([
        this.access.allowedTargetIds(user, {
          resource: "pages",
          action: "read",
          targetType: "page",
          targetIds: pages.map((page) => page.id),
        }),
        this.access.allowedTargetIds(user, {
          resource: "notes",
          action: "read",
          targetType: "note",
          targetIds: notes.map((note) => note.id),
        }),
        this.access.allowedTargetIds(user, {
          resource: "standards",
          action: "read",
          targetType: "standard",
          targetIds: standards.map((standard) => standard.id),
        }),
      ]);
      const allowedPageSet = new Set(allowedPages);
      const allowedNoteSet = new Set(allowedNotes);
      const allowedStandardSet = new Set(allowedStandards);
      for (const categoryId of categoryIds) {
        visibleCounts.set(categoryId, {
          pages: pages.filter(
            (page) =>
              page.categoryId === categoryId && allowedPageSet.has(page.id),
          ).length,
          notes: notes.filter(
            (note) =>
              note.categoryId === categoryId && allowedNoteSet.has(note.id),
          ).length,
          standards: standards.filter(
            (standard) =>
              standard.categoryId === categoryId &&
              allowedStandardSet.has(standard.id),
          ).length,
        });
      }
    }

    return categories.map((category) => {
      const counts = visibleCounts.get(category.id) ?? category._count;
      return {
      id: category.id,
      spaceId: category.spaceId,
      name: category.name,
      slug: category.slug,
      scope: SCOPE_TO_API[category.scope],
      description: category.description,
      icon: category.icon,
      sortOrder: category.sortOrder,
      createdAt: category.createdAt.toISOString(),
      pageCount: counts.pages,
      noteCount: counts.notes,
      standardCount: counts.standards,
      contentCount: scope === "note" ? counts.notes : scope === "standard" ? counts.standards : counts.pages,
    };
    });
  }

  /** Liefert eine einzelne Kategorie samt ihrer zugeordneten Seiten. */
  async findBySlug(
    slug: string,
    scope: ApiCategoryScope = "wiki",
    spaceId = DEFAULT_SPACE_ID,
    user?: AuthenticatedUser,
  ) {
    const category = await this.prisma.category.findUnique({
      where: {
        spaceId_scope_slug: {
          spaceId,
          scope: SCOPE_TO_DB[scope],
          slug,
        },
      },
      include: {
        pages: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            title: true,
            slug: true,
            type: true,
            status: true,
            sortOrder: true,
          },
        },
      },
    });

    if (!category) {
      throw new NotFoundException(`Kategorie "${slug}" wurde nicht gefunden.`);
    }
    if (user && this.access) {
      await this.access.assertAllowed(
        user,
        {
          resource: "categories",
          action: "read",
          targetType: "category",
          targetId: category.id,
        },
        `Kategorie "${slug}" wurde nicht gefunden.`,
      );
      const allowedPageIds = await this.access.allowedTargetIds(user, {
        resource: "pages",
        action: "read",
        targetType: "page",
        targetIds: category.pages.map((page) => page.id),
      });
      const allowed = new Set(allowedPageIds);
      category.pages = category.pages.filter((page) => allowed.has(page.id));
    }

    return { ...this.toApi(category), pages: category.pages };
  }

  /** Erstellt eine neue Kategorie mit automatisch generiertem, eindeutigem Slug. */
  async create(input: CreateCategoryInput, actor?: AuthenticatedUser) {
    const scope = input.scope ?? "wiki";
    const spaceId = await this.spaces.resolveOpenSpace(scope, input.spaceId);
    if (actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "categories",
        action: "create",
        targetType: "space",
        targetId: spaceId,
      });
    }
    const slug = await this.generateUniqueSlug(input.name, scope, spaceId);

    const category = await this.prisma.category.create({
      data: {
        name: input.name,
        spaceId,
        slug,
        scope: SCOPE_TO_DB[scope],
        description: input.description,
        icon: input.icon,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return this.toApi(category);
  }

  /** Bearbeitet eine Kategorie; bei Namensänderung wird der Slug neu erzeugt. */
  async update(
    id: string,
    input: UpdateCategoryInput,
    actor?: AuthenticatedUser,
  ) {
    const existing = await this.ensureExists(id);
    if (actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "categories",
        action: "update",
        targetType: "category",
        targetId: id,
      });
    }
    const nextScope = input.scope ?? SCOPE_TO_API[existing.scope];
    const nextSpaceId =
      input.spaceId === undefined
        ? existing.spaceId
        : await this.spaces.resolveOpenSpace(nextScope, input.spaceId);
    if (actor && this.access && nextSpaceId !== existing.spaceId) {
      await this.access.assertAllowed(actor, {
        resource: "categories",
        action: "update",
        targetType: "space",
        targetId: nextSpaceId,
      });
    }
    if (
      (input.scope && input.scope !== SCOPE_TO_API[existing.scope]) ||
      nextSpaceId !== existing.spaceId
    ) {
      const counts = await this.prisma.category.findUnique({
        where: { id },
        select: {
          _count: { select: { pages: true, notes: true, standards: true } },
        },
      });
      if (
        (counts?._count.pages ?? 0) > 0 ||
        (counts?._count.notes ?? 0) > 0 ||
        (counts?._count.standards ?? 0) > 0
      ) {
        throw new BadRequestException("Eine verwendete Kategorie kann nicht in einen anderen Bereich verschoben werden.");
      }
    }

    const slug =
      input.name !== undefined
        ? await this.generateUniqueSlug(
            input.name,
            nextScope,
            nextSpaceId,
            id,
          )
        : undefined;

    const category = await this.prisma.category.update({
      where: { id },
      data: {
        name: input.name,
        spaceId: nextSpaceId,
        slug,
        scope: input.scope ? SCOPE_TO_DB[input.scope] : undefined,
        description: input.description,
        icon: input.icon,
        sortOrder: input.sortOrder,
      },
    });
    return this.toApi(category);
  }

  /**
   * Löscht eine Kategorie. Zugeordnete Seiten verlieren ihre Zuordnung.
   * Gibt Name und Slug der gelöschten Kategorie zurück (für das Audit-Log).
   */
  async remove(id: string, actor?: AuthenticatedUser) {
    const existing = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true, name: true, slug: true },
    });
    if (!existing) {
      throw new NotFoundException(`Kategorie mit ID "${id}" wurde nicht gefunden.`);
    }
    if (actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "categories",
        action: "delete",
        targetType: "category",
        targetId: id,
      });
      const [pages, notes, standards] = await Promise.all([
        this.prisma.page.findMany({ where: { categoryId: id }, select: { id: true } }),
        this.prisma.note.findMany({ where: { categoryId: id }, select: { id: true } }),
        this.prisma.standard.findMany({ where: { categoryId: id }, select: { id: true } }),
      ]);
      const [allowedPages, allowedNotes, allowedStandards] = await Promise.all([
        this.access.allowedTargetIds(actor, {
          resource: "pages",
          action: "update",
          targetType: "page",
          targetIds: pages.map((page) => page.id),
        }),
        this.access.allowedTargetIds(actor, {
          resource: "notes",
          action: "update",
          targetType: "note",
          targetIds: notes.map((note) => note.id),
        }),
        this.access.allowedTargetIds(actor, {
          resource: "standards",
          action: "update",
          targetType: "standard",
          targetIds: standards.map((standard) => standard.id),
        }),
      ]);
      if (
        allowedPages.length !== pages.length ||
        allowedNotes.length !== notes.length ||
        allowedStandards.length !== standards.length
      ) {
        throw new NotFoundException(
          "Kategorie wurde nicht gefunden oder enthÃ¤lt nicht verschiebbare Inhalte.",
        );
      }
    }
    await this.prisma.category.delete({ where: { id } });
    return existing;
  }

  /** Stellt sicher, dass die Kategorie existiert – sonst 404. */
  private async ensureExists(
    id: string,
  ): Promise<Pick<PrismaCategory, "id" | "scope" | "spaceId">> {
    const exists = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true, scope: true, spaceId: true },
    });

    if (!exists) {
      throw new NotFoundException(`Kategorie mit ID "${id}" wurde nicht gefunden.`);
    }
    return exists;
  }

  /**
   * Erzeugt aus dem Namen einen eindeutigen Slug. Existiert der Slug bereits,
   * wird ein Zähler angehängt (z. B. "technik", "technik-2", "technik-3").
   */
  private async generateUniqueSlug(
    name: string,
    scope: ApiCategoryScope,
    spaceId: string,
    excludeId?: string,
  ): Promise<string> {
    const base = slugify(name, { lower: true, strict: true });
    let slug = base;
    let counter = 1;

    while (true) {
      const existing = await this.prisma.category.findUnique({
        where: {
          spaceId_scope_slug: {
            spaceId,
            scope: SCOPE_TO_DB[scope],
            slug,
          },
        },
        select: { id: true },
      });

      if (!existing || existing.id === excludeId) {
        return slug;
      }

      counter += 1;
      slug = `${base}-${counter}`;
    }
  }

  private toApi(category: PrismaCategory) {
    return {
      id: category.id,
      spaceId: category.spaceId,
      name: category.name,
      slug: category.slug,
      scope: SCOPE_TO_API[category.scope],
      description: category.description,
      icon: category.icon,
      sortOrder: category.sortOrder,
      createdAt: category.createdAt.toISOString(),
    };
  }
}
