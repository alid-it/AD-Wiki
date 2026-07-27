import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import {
  KnowledgeKind,
  Prisma,
  SpaceVisibility,
} from "@prisma/client";
import slugify from "slugify";
import type {
  CreateKnowledgeSpaceInput,
  KnowledgeKind as ApiKnowledgeKind,
  UpdateKnowledgeSpaceInput,
} from "@ad-wiki/shared-types";
import { PrismaService } from "@/prisma/prisma.service";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { ResourceAccessService } from "@/modules/resource-acls/resource-access.service";

export const DEFAULT_SPACE_ID = "00000000-0000-4000-8000-000000000014";

const KIND_TO_DB: Record<ApiKnowledgeKind, KnowledgeKind> = {
  note: KnowledgeKind.NOTE,
  wiki: KnowledgeKind.WIKI,
  standard: KnowledgeKind.STANDARD,
};
const KIND_TO_API: Record<KnowledgeKind, ApiKnowledgeKind> = {
  [KnowledgeKind.NOTE]: "note",
  [KnowledgeKind.WIKI]: "wiki",
  [KnowledgeKind.STANDARD]: "standard",
};

const spaceInclude = {
  responsibleGroup: { select: { id: true, name: true, slug: true } },
  _count: {
    select: {
      categories: true,
      pages: true,
      notes: true,
      standards: true,
      resourceAclEntries: true,
      aclBoundaries: true,
    },
  },
} satisfies Prisma.KnowledgeSpaceInclude;

type SpaceWithRelations = Prisma.KnowledgeSpaceGetPayload<{
  include: typeof spaceInclude;
}>;

@Injectable()
export class SpacesService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly access?: ResourceAccessService,
  ) {}

  async findAll(user?: AuthenticatedUser) {
    let spaces = await this.prisma.knowledgeSpace.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      include: spaceInclude,
    });
    if (user && this.access) {
      const allowedIds = await this.access.allowedTargetIds(user, {
        resource: "spaces",
        action: "read",
        targetType: "space",
        targetIds: spaces.map((space) => space.id),
      });
      const allowed = new Set(allowedIds);
      spaces = spaces.filter((space) => allowed.has(space.id));
    }
    return spaces.map((space) => this.toApi(space));
  }

  async findById(id: string, user?: AuthenticatedUser) {
    if (user && this.access) {
      await this.access.assertAllowed(user, {
        resource: "spaces",
        action: "read",
        targetType: "space",
        targetId: id,
      }, "Wissensbereich wurde nicht gefunden.");
    }
    return this.toApi(await this.findSpace(id));
  }

  async create(
    input: CreateKnowledgeSpaceInput,
    actor?: AuthenticatedUser,
  ) {
    if (input.visibility === "restricted" && !actor) {
      throw new BadRequestException(
        "Zum Erstellen eines eingeschrÃ¤nkten Bereichs wird ein authentifizierter Akteur benÃ¶tigt.",
      );
    }
    await this.assertNameAvailable(input.name);
    await this.assertResponsibleGroup(input.responsibleGroupId);
    const slug = await this.generateUniqueSlug(input.name);

    try {
      const visibility =
        input.visibility === "restricted"
          ? SpaceVisibility.RESTRICTED
          : SpaceVisibility.OPEN;
      const createSpace = (client: Prisma.TransactionClient | PrismaService) =>
        client.knowledgeSpace.create({
          data: {
            name: input.name,
            slug,
            description: input.description || null,
            visibility,
            enabledKinds: (input.enabledKinds ?? ["wiki"]).map(
              (kind) => KIND_TO_DB[kind],
            ),
            responsibleGroupId: input.responsibleGroupId || null,
          },
          include: spaceInclude,
        });
      const space =
        visibility === SpaceVisibility.RESTRICTED
          ? await this.prisma.$transaction(async (transaction) => {
              const created = await createSpace(transaction);
              await this.createOwnerRules(created.id, actor!.id, transaction);
              return created;
            })
          : await createSpace(this.prisma);
      return this.toApi(space);
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  async update(
    id: string,
    input: UpdateKnowledgeSpaceInput,
    actor?: AuthenticatedUser,
  ) {
    if (actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "spaces",
        action: "update",
        targetType: "space",
        targetId: id,
      }, "Wissensbereich wurde nicht gefunden.");
    }
    const existing = await this.findSpace(id);
    if (
      existing.isSystem &&
      input.name !== undefined &&
      input.name !== existing.name
    ) {
      throw new ForbiddenException(
        "Der Name des Systembereichs kann nicht geändert werden.",
      );
    }
    if (input.name !== undefined && input.name !== existing.name) {
      await this.assertNameAvailable(input.name, id);
    }
    await this.assertResponsibleGroup(input.responsibleGroupId);
    if (input.enabledKinds !== undefined) {
      await this.assertKindsMayBeDisabled(id, input.enabledKinds);
    }

    const slug =
      input.name !== undefined && input.name !== existing.name
        ? await this.generateUniqueSlug(input.name, id)
        : undefined;
    try {
      if (
        input.visibility === "restricted" &&
        existing.visibility !== SpaceVisibility.RESTRICTED
      ) {
        if (!actor) {
          throw new BadRequestException(
            "Zum EinschrÃ¤nken eines Bereichs wird ein authentifizierter Akteur benÃ¶tigt.",
          );
        }
        const space = await this.prisma.$transaction(async (transaction) => {
          await this.createOwnerRules(id, actor.id, transaction);
          return transaction.knowledgeSpace.update({
            where: { id },
            data: {
              name: input.name,
              slug,
              description:
                input.description === undefined
                  ? undefined
                  : input.description || null,
              visibility: SpaceVisibility.RESTRICTED,
              enabledKinds: input.enabledKinds?.map((kind) => KIND_TO_DB[kind]),
              responsibleGroupId:
                input.responsibleGroupId === undefined
                  ? undefined
                  : input.responsibleGroupId || null,
            },
            include: spaceInclude,
          });
        });
        return this.toApi(space);
      }
      const space = await this.prisma.knowledgeSpace.update({
        where: { id },
        data: {
          name: input.name,
          slug,
          description:
            input.description === undefined
              ? undefined
              : input.description || null,
          visibility:
            input.visibility === undefined
              ? undefined
              : input.visibility === "restricted"
                ? SpaceVisibility.RESTRICTED
                : SpaceVisibility.OPEN,
          enabledKinds: input.enabledKinds?.map((kind) => KIND_TO_DB[kind]),
          responsibleGroupId:
            input.responsibleGroupId === undefined
              ? undefined
              : input.responsibleGroupId || null,
        },
        include: spaceInclude,
      });
      return this.toApi(space);
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  async remove(id: string, actor?: AuthenticatedUser) {
    if (actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "spaces",
        action: "delete",
        targetType: "space",
        targetId: id,
      }, "Wissensbereich wurde nicht gefunden.");
    }
    const space = await this.findSpace(id);
    if (space.isSystem) {
      throw new ForbiddenException("Systembereiche können nicht gelöscht werden.");
    }
    if (this.contentCount(space) > 0) {
      throw new ConflictException(
        "Der Bereich enthält noch Kategorien oder Inhalte und kann nicht gelöscht werden.",
      );
    }

    if (
      space._count.resourceAclEntries > 0 ||
      space._count.aclBoundaries > 0
    ) {
      throw new ConflictException(
        "Der Bereich wird noch von Ressourcen-ACLs verwendet und kann nicht gelöscht werden.",
      );
    }

    const deleted = await this.prisma.knowledgeSpace.deleteMany({
      where: {
        id,
        isSystem: false,
        categories: { none: {} },
        pages: { none: {} },
        notes: { none: {} },
        standards: { none: {} },
        resourceAclEntries: { none: {} },
        aclBoundaries: { none: {} },
      },
    });
    if (deleted.count !== 1) {
      throw new ConflictException(
        "Der Bereich wurde zwischenzeitlich belegt und kann nicht gelöscht werden.",
      );
    }
    return this.toApi(space);
  }

  /**
   * Löst einen vorhandenen Bereich für neue Inhalte auf und prüft,
   * ob der angeforderte Inhaltstyp dort aktiviert ist.
   */
  async resolveOpenSpace(
    kind: ApiKnowledgeKind,
    requestedSpaceId?: string,
  ): Promise<string> {
    const id = requestedSpaceId ?? DEFAULT_SPACE_ID;
    const space = await this.prisma.knowledgeSpace.findUnique({
      where: { id },
      select: { id: true, visibility: true, enabledKinds: true },
    });
    if (!space) {
      throw new NotFoundException("Wissensbereich wurde nicht gefunden.");
    }
    if (!space.enabledKinds.includes(KIND_TO_DB[kind])) {
      throw new BadRequestException(
        `Der Inhaltstyp "${kind}" ist in diesem Bereich nicht aktiviert.`,
      );
    }
    return space.id;
  }

  private async findSpace(id: string): Promise<SpaceWithRelations> {
    const space = await this.prisma.knowledgeSpace.findUnique({
      where: { id },
      include: spaceInclude,
    });
    if (!space) {
      throw new NotFoundException("Wissensbereich wurde nicht gefunden.");
    }
    return space;
  }

  private async createOwnerRules(
    spaceId: string,
    userId: string,
    client: Pick<Prisma.TransactionClient, "resourceAclEntry"> = this.prisma,
  ): Promise<void> {
    const actions = [
      "read",
      "create",
      "update",
      "delete",
      "share",
      "approve",
      "purge",
    ];
    await client.resourceAclEntry.createMany({
      data: actions.map((action) => ({
        recipientKey: `user:${userId}`,
        targetKey: `space:${spaceId}`,
        action,
        effect: "ALLOW" as const,
        inheritToChildren: true,
        userId,
        spaceId,
      })),
      skipDuplicates: true,
    });
  }

  private async assertResponsibleGroup(
    groupId: string | null | undefined,
  ): Promise<void> {
    if (!groupId) return;
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true },
    });
    if (!group) {
      throw new NotFoundException("Verantwortliche Gruppe wurde nicht gefunden.");
    }
  }

  private async assertKindsMayBeDisabled(
    spaceId: string,
    enabledKinds: ApiKnowledgeKind[],
  ): Promise<void> {
    const enabled = new Set(enabledKinds);
    const [
      wikiCount,
      wikiCategoryCount,
      noteCount,
      noteCategoryCount,
      standardCount,
      standardCategoryCount,
    ] = await Promise.all([
      enabled.has("wiki")
        ? 0
        : this.prisma.page.count({ where: { spaceId } }),
      enabled.has("wiki")
        ? 0
        : this.prisma.category.count({ where: { spaceId, scope: "WIKI" } }),
      enabled.has("note")
        ? 0
        : this.prisma.note.count({ where: { spaceId } }),
      enabled.has("note")
        ? 0
        : this.prisma.category.count({ where: { spaceId, scope: "NOTE" } }),
      enabled.has("standard")
        ? 0
        : this.prisma.standard.count({ where: { spaceId } }),
      enabled.has("standard")
        ? 0
        : this.prisma.category.count({ where: { spaceId, scope: "STANDARD" } }),
    ]);
    if (
      wikiCount > 0 ||
      wikiCategoryCount > 0 ||
      noteCount > 0 ||
      noteCategoryCount > 0 ||
      standardCount > 0 ||
      standardCategoryCount > 0
    ) {
      throw new ConflictException(
        "Ein Inhaltstyp mit vorhandenen Inhalten kann nicht deaktiviert werden.",
      );
    }
  }

  private async assertNameAvailable(
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.knowledgeSpace.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        id: excludeId ? { not: excludeId } : undefined,
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        "Ein Wissensbereich mit diesem Namen existiert bereits.",
      );
    }
  }

  private async generateUniqueSlug(
    name: string,
    excludeId?: string,
  ): Promise<string> {
    const base = slugify(name, { lower: true, strict: true, locale: "de" }) || "bereich";
    let slug = base;
    let suffix = 1;
    while (true) {
      const existing = await this.prisma.knowledgeSpace.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!existing || existing.id === excludeId) return slug;
      suffix += 1;
      slug = `${base}-${suffix}`;
    }
  }

  private rethrowUniqueConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ConflictException(
        "Name oder Slug des Wissensbereichs ist bereits vergeben.",
      );
    }
    throw error;
  }

  private contentCount(space: SpaceWithRelations): number {
    return (
      space._count.categories +
      space._count.pages +
      space._count.notes +
      space._count.standards
    );
  }

  private toApi(space: SpaceWithRelations) {
    return {
      id: space.id,
      name: space.name,
      slug: space.slug,
      description: space.description,
      visibility:
        space.visibility === SpaceVisibility.OPEN
          ? ("open" as const)
          : ("restricted" as const),
      enabledKinds: space.enabledKinds.map((kind) => KIND_TO_API[kind]),
      isSystem: space.isSystem,
      responsibleGroupId: space.responsibleGroupId,
      responsibleGroup: space.responsibleGroup,
      categoryCount: space._count.categories,
      pageCount: space._count.pages,
      noteCount: space._count.notes,
      standardCount: space._count.standards,
      contentCount: this.contentCount(space),
      createdAt: space.createdAt.toISOString(),
      updatedAt: space.updatedAt.toISOString(),
    };
  }
}
