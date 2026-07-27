import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, ResourceAclEffect } from "@prisma/client";
import type {
  CreateResourceAclEntryInput,
  ResourceAclBoundary,
  ResourceAclEntry,
  ResourceAclListQuery,
  ResourceAclRecipientType,
  ResourceAclTargetRef,
  ResourceAclTargetType,
  SetResourceAclBoundaryInput,
  UpdateResourceAclEntryInput,
} from "@ad-wiki/shared-types";
import { PrismaService } from "@/prisma/prisma.service";
import { ResourceTargetService } from "@/modules/resource-acls/resource-target.service";

const entryInclude = {
  user: { select: { id: true, displayName: true } },
  group: { select: { id: true, name: true } },
  space: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  page: { select: { id: true, title: true } },
  note: { select: { id: true, title: true } },
  standard: { select: { id: true, title: true } },
} satisfies Prisma.ResourceAclEntryInclude;

const boundaryInclude = {
  space: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  page: { select: { id: true, title: true } },
  note: { select: { id: true, title: true } },
  standard: { select: { id: true, title: true } },
} satisfies Prisma.ResourceAclBoundaryInclude;

type EntryWithRelations = Prisma.ResourceAclEntryGetPayload<{
  include: typeof entryInclude;
}>;
type BoundaryWithRelations = Prisma.ResourceAclBoundaryGetPayload<{
  include: typeof boundaryInclude;
}>;

/** Verwaltung expliziter Ressourcen-ACLs und aktionsbezogener Vererbungsgrenzen. */
@Injectable()
export class ResourceAclService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly targets: ResourceTargetService,
  ) {}

  async findAll(query: ResourceAclListQuery): Promise<ResourceAclEntry[]> {
    const targetKey = await this.resolveOptionalTargetKey(query);
    const entries = await this.prisma.resourceAclEntry.findMany({
      where: targetKey ? { targetKey } : undefined,
      orderBy: [
        { targetKey: "asc" },
        { action: "asc" },
        { recipientKey: "asc" },
      ],
      include: entryInclude,
    });
    return entries.map((entry) => this.toEntry(entry));
  }

  async findBoundaries(
    query: ResourceAclListQuery,
  ): Promise<ResourceAclBoundary[]> {
    const targetKey = await this.resolveOptionalTargetKey(query);
    const boundaries = await this.prisma.resourceAclBoundary.findMany({
      where: targetKey ? { targetKey } : undefined,
      orderBy: [{ targetKey: "asc" }, { action: "asc" }],
      include: boundaryInclude,
    });
    return boundaries.map((boundary) => this.toBoundary(boundary));
  }

  async create(
    input: CreateResourceAclEntryInput,
  ): Promise<ResourceAclEntry> {
    await this.assertRecipient(input.recipientType, input.recipientId);
    const target = await this.targets.resolve(input.targetType, input.targetId);
    this.targets.assertActionSupported(target, input.action);

    try {
      const entry = await this.prisma.resourceAclEntry.create({
        data: {
          recipientKey: this.recipientKey(
            input.recipientType,
            input.recipientId,
          ),
          targetKey: target.key,
          action: input.action,
          effect:
            input.effect === "allow"
              ? ResourceAclEffect.ALLOW
              : ResourceAclEffect.DENY,
          inheritToChildren: input.inheritToChildren ?? true,
          ...this.recipientIds(input.recipientType, input.recipientId),
          ...this.targetIds(input.targetType, input.targetId),
        },
        include: entryInclude,
      });
      return this.toEntry(entry);
    } catch (error) {
      this.rethrowWriteConflict(error);
    }
  }

  async update(
    id: string,
    input: UpdateResourceAclEntryInput,
  ): Promise<ResourceAclEntry> {
    await this.findEntry(id);
    const entry = await this.prisma.resourceAclEntry.update({
      where: { id },
      data: {
        effect:
          input.effect === undefined
            ? undefined
            : input.effect === "allow"
              ? ResourceAclEffect.ALLOW
              : ResourceAclEffect.DENY,
        inheritToChildren: input.inheritToChildren,
      },
      include: entryInclude,
    });
    return this.toEntry(entry);
  }

  async remove(id: string): Promise<ResourceAclEntry> {
    const existing = await this.findEntry(id);
    await this.prisma.resourceAclEntry.delete({ where: { id } });
    return this.toEntry(existing);
  }

  async setBoundary(
    input: SetResourceAclBoundaryInput,
  ): Promise<ResourceAclBoundary> {
    const target = await this.targets.resolve(input.targetType, input.targetId);
    this.targets.assertActionSupported(target, input.action);
    const boundary = await this.prisma.resourceAclBoundary.upsert({
      where: {
        targetKey_action: {
          targetKey: target.key,
          action: input.action,
        },
      },
      create: {
        targetKey: target.key,
        action: input.action,
        ...this.targetIds(input.targetType, input.targetId),
      },
      update: {},
      include: boundaryInclude,
    });
    return this.toBoundary(boundary);
  }

  async removeBoundary(
    input: SetResourceAclBoundaryInput,
  ): Promise<ResourceAclBoundary> {
    const target = await this.targets.resolve(input.targetType, input.targetId);
    this.targets.assertActionSupported(target, input.action);
    const existing = await this.prisma.resourceAclBoundary.findUnique({
      where: {
        targetKey_action: {
          targetKey: target.key,
          action: input.action,
        },
      },
      include: boundaryInclude,
    });
    if (!existing) {
      throw new NotFoundException("Vererbungsgrenze wurde nicht gefunden.");
    }
    await this.prisma.resourceAclBoundary.delete({ where: { id: existing.id } });
    return this.toBoundary(existing);
  }

  private async findEntry(id: string): Promise<EntryWithRelations> {
    const entry = await this.prisma.resourceAclEntry.findUnique({
      where: { id },
      include: entryInclude,
    });
    if (!entry) {
      throw new NotFoundException("Ressourcen-ACL wurde nicht gefunden.");
    }
    return entry;
  }

  private async resolveOptionalTargetKey(
    query: ResourceAclListQuery,
  ): Promise<string | undefined> {
    if (!query.targetType || !query.targetId) return undefined;
    return (await this.targets.resolve(query.targetType, query.targetId)).key;
  }

  private async assertRecipient(
    type: ResourceAclRecipientType,
    id: string,
  ): Promise<void> {
    if (type === "user") {
      const user = await this.prisma.user.findUnique({
        where: { id },
        select: { isActive: true },
      });
      if (!user) throw new NotFoundException("Benutzer wurde nicht gefunden.");
      if (!user.isActive) {
        throw new ConflictException(
          "Für deaktivierte Benutzer kann keine Ressourcen-ACL angelegt werden.",
        );
      }
      return;
    }
    const group = await this.prisma.group.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!group) throw new NotFoundException("Gruppe wurde nicht gefunden.");
  }

  private recipientKey(type: ResourceAclRecipientType, id: string): string {
    return `${type}:${id}`;
  }

  private recipientIds(
    type: ResourceAclRecipientType,
    id: string,
  ): Pick<
    Prisma.ResourceAclEntryUncheckedCreateInput,
    "userId" | "groupId"
  > {
    return type === "user"
      ? { userId: id, groupId: null }
      : { userId: null, groupId: id };
  }

  private targetIds(
    type: ResourceAclTargetType,
    id: string,
  ): Pick<
    Prisma.ResourceAclEntryUncheckedCreateInput,
    "spaceId" | "categoryId" | "pageId" | "noteId" | "standardId"
  > {
    return {
      spaceId: type === "space" ? id : null,
      categoryId: type === "category" ? id : null,
      pageId: type === "page" ? id : null,
      noteId: type === "note" ? id : null,
      standardId: type === "standard" ? id : null,
    };
  }

  private toEntry(entry: EntryWithRelations): ResourceAclEntry {
    const recipient =
      entry.user !== null
        ? {
            type: "user" as const,
            id: entry.user.id,
            label: entry.user.displayName,
          }
        : entry.group !== null
          ? {
              type: "group" as const,
              id: entry.group.id,
              label: entry.group.name,
            }
          : this.invalidDatabaseState("ACL-Empfänger");
    return {
      id: entry.id,
      recipient,
      target: this.targetRef(entry),
      action: entry.action as ResourceAclEntry["action"],
      effect:
        entry.effect === ResourceAclEffect.ALLOW
          ? ("allow" as const)
          : ("deny" as const),
      inheritToChildren: entry.inheritToChildren,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    };
  }

  private toBoundary(boundary: BoundaryWithRelations): ResourceAclBoundary {
    return {
      id: boundary.id,
      target: this.targetRef(boundary),
      action: boundary.action as ResourceAclBoundary["action"],
      createdAt: boundary.createdAt.toISOString(),
      updatedAt: boundary.updatedAt.toISOString(),
    };
  }

  private targetRef(
    value: BoundaryWithRelations | EntryWithRelations,
  ): ResourceAclTargetRef {
    if (value.space) {
      return { type: "space", id: value.space.id, label: value.space.name };
    }
    if (value.category) {
      return {
        type: "category",
        id: value.category.id,
        label: value.category.name,
      };
    }
    if (value.page) {
      return { type: "page", id: value.page.id, label: value.page.title };
    }
    if (value.note) {
      return {
        type: "note",
        id: value.note.id,
        label: value.note.title ?? "Unbenannte Notiz",
      };
    }
    if (value.standard) {
      return {
        type: "standard",
        id: value.standard.id,
        label: value.standard.title,
      };
    }
    return this.invalidDatabaseState("ACL-Ziel");
  }

  private invalidDatabaseState(label: string): never {
    throw new Error(`${label} ist im Datenbankeintrag nicht eindeutig gesetzt.`);
  }

  private rethrowWriteConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ConflictException(
        "Für diesen Empfänger, dieses Ziel und diese Aktion existiert bereits eine ACL.",
      );
    }
    throw error;
  }
}
