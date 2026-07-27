import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import {
  CategoryScope,
  KnowledgeKind,
  KnowledgeSensitivity,
  NoteSharePermission,
  NoteStatus,
  Prisma,
} from "@prisma/client";
import slugify from "slugify";
import type {
  CreateNoteInput,
  NoteQuery,
  PromoteNoteInput,
  ShareNoteInput,
  UpdateNoteInput,
  ToggleCheckboxInput,
} from "@ad-wiki/shared-types";
import { toggleCheckboxInContent } from "@/common/content/toggle-checkbox";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { PagesService } from "@/modules/pages/pages.service";
import { PrismaService } from "@/prisma/prisma.service";
import {
  DEFAULT_SPACE_ID,
  SpacesService,
} from "@/modules/spaces/spaces.service";
import { ResourceAccessService } from "@/modules/resource-acls/resource-access.service";

const noteInclude = Prisma.validator<Prisma.NoteInclude>()({
  owner: { select: { id: true, displayName: true, email: true } },
  category: { select: { id: true, name: true, slug: true } },
  tags: { include: { tag: { select: { name: true } } } },
  shares: {
    orderBy: { sharedAt: "asc" },
    include: { user: { select: { id: true, displayName: true, email: true } } },
  },
});
type NoteWithRelations = Prisma.NoteGetPayload<{ include: typeof noteInclude }>;

const STATUS_TO_DB = {
  captured: NoteStatus.CAPTURED,
  promoted: NoteStatus.PROMOTED,
  archived: NoteStatus.ARCHIVED,
} as const;
const STATUS_TO_API = {
  CAPTURED: "captured",
  PROMOTED: "promoted",
  ARCHIVED: "archived",
} as const;
const PERMISSION_TO_DB = { view: NoteSharePermission.VIEW, edit: NoteSharePermission.EDIT } as const;
const PERMISSION_TO_API = { VIEW: "view", EDIT: "edit" } as const;
const KIND_TO_API: Record<KnowledgeKind, "note" | "wiki" | "standard"> = {
  NOTE: "note", WIKI: "wiki", STANDARD: "standard",
};
const SENSITIVITY_TO_API: Record<KnowledgeSensitivity, "low" | "medium" | "high"> = {
  LOW: "low", MEDIUM: "medium", HIGH: "high",
};

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pages: PagesService,
    private readonly spaces: SpacesService = new SpacesService(prisma),
    @Optional() private readonly access?: ResourceAccessService,
  ) {}

  async findAll(
    userId: string,
    query: NoteQuery,
    actor?: AuthenticatedUser,
  ) {
    const ownership: Prisma.NoteWhereInput = query.scope === "mine"
      ? { ownerId: userId }
      : query.scope === "shared"
        ? { ownerId: { not: userId }, shares: { some: { userId } } }
        : actor && this.access
          ? {
              OR: [
                {
                  spaceId: null,
                  OR: [
                    { ownerId: userId },
                    { shares: { some: { userId } } },
                  ],
                },
                { spaceId: { not: null } },
              ],
            }
          : { OR: [{ ownerId: userId }, { shares: { some: { userId } } }] };
    const where: Prisma.NoteWhereInput = {
      AND: [
        ownership,
        {
          deletedAt: null,
          ...(query.spaceId ? { spaceId: query.spaceId } : {}),
          ...(query.status ? { status: STATUS_TO_DB[query.status] } : {}),
        },
        ...(query.q
          ? [{
              OR: [
                { title: { contains: query.q, mode: "insensitive" as const } },
                { content: { contains: query.q, mode: "insensitive" as const } },
                { tags: { some: { tag: { name: { contains: query.q, mode: "insensitive" as const } } } } },
              ],
            }]
          : []),
      ],
    };
    if (actor && this.access) {
      const candidates = await this.prisma.note.findMany({
        where,
        select: { id: true },
      });
      const allowedIds = await this.access.allowedTargetIds(actor, {
        resource: "notes",
        action: "read",
        targetType: "note",
        targetIds: candidates.map((note) => note.id),
      });
      where.id = { in: allowedIds };
    }
    const notes = await this.prisma.note.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: noteInclude,
    });
    return notes.map((note) => this.toApi(note, userId));
  }

  async findTrash(userId: string, actor?: AuthenticatedUser) {
    const where: Prisma.NoteWhereInput = {
      ownerId: userId,
      deletedAt: { not: null },
    };
    if (actor && this.access) {
      const candidates = await this.prisma.note.findMany({
        where,
        select: { id: true },
      });
      where.id = {
        in: await this.access.allowedTargetIds(actor, {
          resource: "notes",
          action: "delete",
          targetType: "note",
          targetIds: candidates.map((note) => note.id),
        }),
      };
    }
    const notes = await this.prisma.note.findMany({
      where,
      orderBy: { deletedAt: "desc" },
      include: noteInclude,
    });
    return notes.map((note) => this.toApi(note, userId));
  }

  async findOne(id: string, userId: string, actor?: AuthenticatedUser) {
    const note = await this.prisma.note.findFirst({
      where: { id, deletedAt: null },
      include: noteInclude,
    });
    if (!note) throw new NotFoundException("Notiz wurde nicht gefunden.");
    if (actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "notes",
        action: "read",
        targetType: "note",
        targetId: id,
      }, "Notiz wurde nicht gefunden.");
    } else if (
      note.ownerId !== userId &&
      !note.shares.some((share) => share.userId === userId)
    ) {
      throw new NotFoundException("Notiz wurde nicht gefunden.");
    }
    return this.toApi(note, userId);
  }

  async create(
    input: CreateNoteInput,
    ownerId: string,
    actor?: AuthenticatedUser,
  ) {
    const category = input.categoryId
      ? await this.ensureNoteCategory(input.categoryId)
      : null;
    const spaceId = input.spaceId
      ? await this.spaces.resolveOpenSpace("note", input.spaceId)
      : null;
    if (spaceId && category && category.spaceId !== spaceId) {
      throw new BadRequestException(
        "Notiz und Kategorie müssen demselben Bereich angehören.",
      );
    }
    if (spaceId && actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "notes",
        action: "create",
        targetType: input.categoryId ? "category" : "space",
        targetId: input.categoryId ?? spaceId,
      });
    }
    const note = await this.prisma.note.create({
      data: {
        title: input.title?.trim() || null,
        content: input.content,
        mcpVisible: input.mcpVisible,
        space: spaceId ? { connect: { id: spaceId } } : undefined,
        owner: { connect: { id: ownerId } },
        category: input.categoryId ? { connect: { id: input.categoryId } } : undefined,
        tags: { create: this.tagRelations(input.tags) },
      },
      include: noteInclude,
    });
    return this.toApi(note, ownerId);
  }

  async update(
    id: string,
    input: UpdateNoteInput,
    userId: string,
    actor?: AuthenticatedUser,
  ) {
    const existing = await this.findEditable(id, userId, actor);
    const isOwner = existing.ownerId === userId;
    const categoryId =
      input.categoryId === undefined ? existing.categoryId : input.categoryId;
    const category = categoryId
      ? await this.ensureNoteCategory(categoryId)
      : null;
    const requestedSpaceId =
      input.spaceId === undefined ? existing.spaceId : input.spaceId;
    const spaceId = requestedSpaceId
      ? await this.spaces.resolveOpenSpace("note", requestedSpaceId)
      : null;
    if (spaceId && category && category.spaceId !== spaceId) {
      throw new BadRequestException(
        "Notiz und Kategorie müssen demselben Bereich angehören.",
      );
    }
    const assignmentChanged =
      input.spaceId !== undefined || input.categoryId !== undefined;
    if (assignmentChanged && existing.ownerId !== userId) {
      throw new ForbiddenException(
        "Nur der Besitzer darf eine Notiz in einen anderen Bereich verschieben.",
      );
    }
    if (assignmentChanged && spaceId && actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "notes",
        action: "update",
        targetType: categoryId ? "category" : "space",
        targetId: categoryId ?? spaceId,
      });
    }
    const data: Prisma.NoteUpdateInput = {};
    if (input.spaceId !== undefined) {
      data.space = spaceId
        ? { connect: { id: spaceId } }
        : { disconnect: true };
    }
    if (input.title !== undefined) data.title = input.title?.trim() || null;
    if (input.content !== undefined) data.content = input.content;
    if (input.categoryId !== undefined) {
      data.category = input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true };
    }
    if (input.tags !== undefined) data.tags = { deleteMany: {}, create: this.tagRelations(input.tags) };
    if (isOwner && input.status !== undefined) data.status = STATUS_TO_DB[input.status];
    if (isOwner && input.mcpVisible !== undefined) data.mcpVisible = input.mcpVisible;
    const note = await this.prisma.note.update({ where: { id }, data, include: noteInclude });
    return this.toApi(note, userId);
  }

  /** Schaltet nur eine Checkbox und übernimmt dabei dieselben Eigentümer-/Freigaberegeln wie update. */
  async toggleCheckbox(
    id: string,
    input: ToggleCheckboxInput,
    userId: string,
    actor?: AuthenticatedUser,
  ) {
    const existing = await this.findEditable(id, userId, actor);
    const content = toggleCheckboxInContent(existing.content, input.checkboxIndex, input.checked);
    if (content === null) {
      throw new BadRequestException(`Checkbox mit Index ${input.checkboxIndex} wurde nicht gefunden.`);
    }
    const note = await this.prisma.note.update({
      where: { id },
      data: { content },
      include: noteInclude,
    });
    return this.toApi(note, userId);
  }

  async remove(id: string, userId: string, actor?: AuthenticatedUser) {
    await this.findForAction(id, userId, false, "delete", actor);
    const updated = await this.prisma.note.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: userId },
      include: noteInclude,
    });
    return this.toApi(updated, userId);
  }

  async restore(id: string, userId: string, actor?: AuthenticatedUser) {
    await this.findForAction(id, userId, true, "delete", actor);
    const note = await this.prisma.note.update({ where: { id }, data: { deletedAt: null, deletedById: null }, include: noteInclude });
    return this.toApi(note, userId);
  }

  private async ensureNoteCategory(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: { scope: true, spaceId: true },
    });
    if (!category || category.scope !== CategoryScope.NOTE) {
      throw new BadRequestException("Die gewählte Kategorie gehört nicht zu den Notizen.");
    }
    return category;
  }

  async permanentRemove(id: string, userId: string, actor?: AuthenticatedUser) {
    const note = await this.findForAction(id, userId, true, "delete", actor);
    await this.prisma.note.delete({ where: { id } });
    return { id: note.id, title: note.title };
  }

  async share(
    id: string,
    input: ShareNoteInput,
    userId: string,
    actor?: AuthenticatedUser,
  ) {
    const note = await this.findForAction(id, userId, false, "share", actor);
    if (input.userId === userId) throw new ForbiddenException("Eigene Notizen mÃ¼ssen nicht mit dir selbst geteilt werden.");
    const target = await this.prisma.user.findFirst({ where: { id: input.userId, isActive: true }, select: { id: true } });
    if (!target) throw new NotFoundException("Benutzer wurde nicht gefunden.");
    await this.prisma.noteShare.upsert({
      where: { noteId_userId: { noteId: id, userId: input.userId } },
      update: { permission: PERMISSION_TO_DB[input.permission], sharedById: userId, sharedAt: new Date() },
      create: { noteId: id, userId: input.userId, permission: PERMISSION_TO_DB[input.permission], sharedById: userId },
    });
    return this.findOne(note.id, userId);
  }

  async unshare(
    id: string,
    targetUserId: string,
    userId: string,
    actor?: AuthenticatedUser,
  ) {
    await this.findForAction(id, userId, false, "share", actor);
    await this.prisma.noteShare.deleteMany({ where: { noteId: id, userId: targetUserId } });
    return this.findOne(id, userId);
  }

  async shareCandidates(userId: string) {
    return this.prisma.user.findMany({
      where: { id: { not: userId }, isActive: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true, email: true },
    });
  }

  async promoteToWiki(id: string, input: PromoteNoteInput, user: AuthenticatedUser) {
    const note = await this.findForAction(id, user.id, false, "update", user);
    if (!(await this.hasPermission(user, "pages", "create"))) {
      throw new ForbiddenException("FÃ¼r die Umwandlung fehlt pages:create.");
    }
    const wikiCategory = note.category
      ? await this.prisma.category.findUnique({
          where: {
            spaceId_scope_slug: {
              spaceId: note.spaceId ?? DEFAULT_SPACE_ID,
              scope: CategoryScope.WIKI,
              slug: note.category.slug,
            },
          },
          select: { id: true },
        })
      : null;
    const title = input.title?.trim() || note.title?.trim() || note.content.split(/\r?\n/)[0].slice(0, 200) || "Neue Wiki-Seite";
    const page = await this.pages.create({
      title,
      spaceId: note.spaceId ?? DEFAULT_SPACE_ID,
      type: "page",
      content: note.content,
      excerpt: note.content.replace(/\s+/g, " ").slice(0, 500),
      status: input.status,
      isPublic: false,
      mcpVisible: false,
      categoryId: wikiCategory?.id ?? null,
      parentId: null,
      tags: note.tags.map((entry) => entry.tag.name),
    }, user.id, user);
    await this.prisma.note.update({ where: { id }, data: { status: NoteStatus.PROMOTED, promotedPageId: page.id } });
    return page;
  }

  private async findEditable(
    id: string,
    userId: string,
    actor?: AuthenticatedUser,
  ) {
    if (actor && this.access) {
      const note = await this.prisma.note.findFirst({
        where: { id, deletedAt: null },
        include: noteInclude,
      });
      if (!note) throw new NotFoundException("Notiz wurde nicht gefunden.");
      await this.access.assertAllowed(actor, {
        resource: "notes",
        action: "update",
        targetType: "note",
        targetId: id,
      }, "Notiz wurde nicht gefunden.");
      return note;
    }
    const note = await this.prisma.note.findFirst({
      where: { id, deletedAt: null, OR: [{ ownerId: userId }, { shares: { some: { userId, permission: NoteSharePermission.EDIT } } }] },
      include: noteInclude,
    });
    if (!note) throw new ForbiddenException("Diese Notiz darf nicht bearbeitet werden.");
    return note;
  }

  private async findForAction(
    id: string,
    userId: string,
    deleted: boolean,
    action: "delete" | "share" | "update",
    actor?: AuthenticatedUser,
  ) {
    const note = await this.prisma.note.findFirst({
      where: {
        id,
        ...(actor && this.access ? {} : { ownerId: userId }),
        deletedAt: deleted ? { not: null } : null,
      },
      include: noteInclude,
    });
    if (!note) throw new NotFoundException("Eigene Notiz wurde nicht gefunden.");
    if (actor && this.access) {
      await this.access.assertAllowed(actor, {
        resource: "notes",
        action,
        targetType: "note",
        targetId: id,
      }, "Notiz wurde nicht gefunden.");
    }
    return note;
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
      this.prisma.userPermission.findUnique({ where: { userId_resource_action: { userId: user.id, resource, action } }, select: { allowed: true } }),
      this.prisma.acl.findUnique({
        where: { roleId_resource_action: { roleId: user.roleId, resource, action } },
        select: { allowed: true },
      }),
    ]);
    return override?.allowed ?? acl?.allowed ?? false;
  }

  private tagRelations(tags: string[]) {
    const unique = [...new Map(tags.map((name) => [name.trim().toLocaleLowerCase("de-DE"), name.trim()])).values()].filter(Boolean);
    return unique.map((name) => {
      const generated = slugify(name, { lower: true, strict: true, locale: "de" });
      const slug = generated || `tag-${Array.from(name).map((char) => char.codePointAt(0)?.toString(16)).join("-")}`;
      return { tag: { connectOrCreate: { where: { slug }, create: { name, slug } } } };
    });
  }

  private toApi(note: NoteWithRelations, userId: string) {
    const share = note.shares.find((entry) => entry.userId === userId);
    return {
      id: note.id,
      spaceId: note.spaceId,
      title: note.title,
      content: note.content,
      status: STATUS_TO_API[note.status],
      mcpVisible: note.mcpVisible,
      knowledgeType: "note" as const,
      knowledgePriority: 3 as const,
      ownerId: note.ownerId,
      owner: note.owner,
      categoryId: note.categoryId,
      category: note.category,
      tags: note.tags.map((entry) => entry.tag.name),
      shares: note.shares.map((entry) => ({ user: entry.user, permission: PERMISSION_TO_API[entry.permission], sharedAt: entry.sharedAt.toISOString() })),
      isOwner: note.ownerId === userId,
      sharePermission: share ? PERMISSION_TO_API[share.permission] : null,
      promotedPageId: note.promotedPageId,
      assessment: note.suggestedType && note.classificationConfidence !== null && note.assessedAt ? {
        suggestedType: KIND_TO_API[note.suggestedType],
        confidence: note.classificationConfidence,
        reason: note.classificationReason,
        qualityScore: note.qualityScore,
        maturityScore: note.maturityScore,
        sensitivity: note.sensitivity ? SENSITIVITY_TO_API[note.sensitivity] : null,
        assessedAt: note.assessedAt.toISOString(),
      } : null,
      deletedAt: note.deletedAt?.toISOString() ?? null,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }
}
