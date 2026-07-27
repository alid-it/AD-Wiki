import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import {
  CategoryScope, KnowledgeSensitivity, Prisma, StandardExceptionStatus,
  StandardPriority, StandardRuleType, StandardStatus,
} from "@prisma/client";
import slugify from "slugify";
import type {
  CreateStandardInput, CreateStandardRuleInput, DecideStandardExceptionInput,
  RequestStandardExceptionInput, StandardQuery, UpdateStandardInput, UpdateStandardRuleInput,
} from "@ad-wiki/shared-types";
import { PrismaService } from "@/prisma/prisma.service";
import { SpacesService } from "@/modules/spaces/spaces.service";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { ResourceAccessService } from "@/modules/resource-acls/resource-access.service";

const include = Prisma.validator<Prisma.StandardInclude>()({
  createdBy: { select: { id: true, displayName: true, email: true } },
  responsible: { select: { id: true, displayName: true, email: true } },
  category: { select: { id: true, name: true, slug: true } },
  rules: { orderBy: { sortOrder: "asc" } },
  pages: { include: { page: { select: { id: true, title: true, slug: true } } } },
  exceptions: {
    orderBy: { createdAt: "desc" },
    include: {
      requestedBy: { select: { id: true, displayName: true, email: true } },
      responsible: { select: { id: true, displayName: true, email: true } },
      decidedBy: { select: { id: true, displayName: true, email: true } },
    },
  },
});
type FullStandard = Prisma.StandardGetPayload<{ include: typeof include }>;

const STATUS_DB = { draft: StandardStatus.DRAFT, review: StandardStatus.REVIEW, active: StandardStatus.ACTIVE, deprecated: StandardStatus.DEPRECATED } as const;
const STATUS_API = { DRAFT: "draft", REVIEW: "review", ACTIVE: "active", DEPRECATED: "deprecated" } as const;
const PRIORITY_DB = { low: StandardPriority.LOW, medium: StandardPriority.MEDIUM, high: StandardPriority.HIGH, critical: StandardPriority.CRITICAL } as const;
const PRIORITY_API = { LOW: "low", MEDIUM: "medium", HIGH: "high", CRITICAL: "critical" } as const;
const RULE_DB = { must: StandardRuleType.MUST, should: StandardRuleType.SHOULD, may: StandardRuleType.MAY, must_not: StandardRuleType.MUST_NOT } as const;
const RULE_API = { MUST: "must", SHOULD: "should", MAY: "may", MUST_NOT: "must_not" } as const;
const EXCEPTION_API = { REQUESTED: "requested", APPROVED: "approved", REJECTED: "rejected", EXPIRED: "expired" } as const;
const SENSITIVITY_API: Record<KnowledgeSensitivity, "low" | "medium" | "high"> = { LOW: "low", MEDIUM: "medium", HIGH: "high" };

@Injectable()
export class StandardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService = new SpacesService(prisma),
    @Optional() private readonly access?: ResourceAccessService,
  ) {}

  async findAll(query: StandardQuery, user?: AuthenticatedUser) {
    const where: Prisma.StandardWhereInput = {
      ...(query.spaceId ? { spaceId: query.spaceId } : {}),
      ...(query.status ? { status: STATUS_DB[query.status] } : {}),
      ...(query.priority ? { priority: PRIORITY_DB[query.priority] } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.q ? { OR: [
        { title: { contains: query.q, mode: "insensitive" } },
        { description: { contains: query.q, mode: "insensitive" } },
        { rules: { some: { title: { contains: query.q, mode: "insensitive" } } } },
      ] } : {}),
    };
    if (user && this.access) {
      const candidates = await this.prisma.standard.findMany({
        where,
        select: { id: true },
      });
      where.id = {
        in: await this.access.allowedTargetIds(user, {
          resource: "standards",
          action: "read",
          targetType: "standard",
          targetIds: candidates.map((standard) => standard.id),
        }),
      };
    }
    const standards = await this.prisma.standard.findMany({
      where,
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }], include,
    });
    return this.toApiMany(standards, user);
  }

  async findOne(id: string, user?: AuthenticatedUser) {
    const standard = await this.prisma.standard.findUnique({ where: { id }, include });
    if (!standard) throw new NotFoundException("Richtlinie wurde nicht gefunden.");
    if (user && this.access) {
      await this.access.assertAllowed(user, {
        resource: "standards",
        action: "read",
        targetType: "standard",
        targetId: id,
      }, "Richtlinie wurde nicht gefunden.");
    }
    const [result] = await this.toApiMany([standard], user);
    return result;
  }

  async options(user?: AuthenticatedUser) {
    let [users, categories, pages] = await Promise.all([
      this.prisma.user.findMany({ where: { isActive: true }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, email: true } }),
      this.prisma.category.findMany({ where: { scope: CategoryScope.STANDARD }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, slug: true } }),
      this.prisma.page.findMany({ where: { deletedAt: null, type: "PAGE" }, orderBy: { title: "asc" }, select: { id: true, title: true, slug: true } }),
    ]);
    if (user && this.access) {
      const [allowedCategories, allowedPages] = await Promise.all([
        this.access.allowedTargetIds(user, {
          resource: "categories",
          action: "read",
          targetType: "category",
          targetIds: categories.map((category) => category.id),
        }),
        this.access.allowedTargetIds(user, {
          resource: "pages",
          action: "read",
          targetType: "page",
          targetIds: pages.map((page) => page.id),
        }),
      ]);
      const categorySet = new Set(allowedCategories);
      const pageSet = new Set(allowedPages);
      categories = categories.filter((category) => categorySet.has(category.id));
      pages = pages.filter((page) => pageSet.has(page.id));
    }
    return { users, categories, pages };
  }

  async create(
    input: CreateStandardInput,
    userId: string,
    actor?: AuthenticatedUser,
  ) {
    const spaceId = await this.resolveStandardSpace(
      input.spaceId,
      input.categoryId,
      input.pageIds ?? [],
    );
    await this.assertStandardDestination(
      actor,
      spaceId,
      input.categoryId,
      "create",
    );
    await this.assertLinkedPagesReadable(actor, input.pageIds ?? []);
    await this.validateRelations(input.categoryId, input.responsibleId, input.pageIds ?? []);
    await this.assertStandardSpaceRelations(
      spaceId,
      input.categoryId,
      input.pageIds ?? [],
    );
    const slug = await this.uniqueSlug(input.title);
    const standard = await this.prisma.standard.create({
      data: {
        title: input.title, slug, description: input.description, justification: input.justification,
        spaceId,
        priority: PRIORITY_DB[input.priority ?? "medium"], mcpVisible: false,
        validFrom: input.validFrom ? new Date(input.validFrom) : null,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        createdById: userId, responsibleId: input.responsibleId, categoryId: input.categoryId ?? null,
        pages: { create: (input.pageIds ?? []).map((pageId) => ({ pageId })) },
        rules: { create: (input.rules ?? []).map((rule) => this.ruleCreateData(rule)) },
      }, include,
    });
    return this.toApi(standard);
  }

  async update(
    id: string,
    input: UpdateStandardInput,
    userId: string,
    actor?: AuthenticatedUser,
  ) {
    await this.assertStandardAccess(actor, id, "update");
    const existing = await this.full(id);
    if (existing.status === StandardStatus.DEPRECATED) throw new BadRequestException("Veraltete Richtlinien können nicht bearbeitet werden.");
    if (input.mcpVisible && existing.status !== StandardStatus.ACTIVE) throw new BadRequestException("Nur aktive Richtlinien dürfen für MCP freigegeben werden.");
    const contentChange = Object.keys(input).some((key) => key !== "mcpVisible");
    if (!contentChange && input.mcpVisible !== undefined) {
      return this.toApi(await this.prisma.standard.update({ where: { id }, data: { mcpVisible: input.mcpVisible }, include }));
    }
    const spaceId = await this.resolveStandardSpace(
      input.spaceId,
      input.categoryId === undefined ? existing.categoryId : input.categoryId,
      existing.pages.map((link) => link.pageId),
      existing.spaceId,
    );
    if (input.spaceId !== undefined || input.categoryId !== undefined) {
      await this.assertStandardDestination(
        actor,
        spaceId,
        input.categoryId === undefined ? existing.categoryId : input.categoryId,
        "update",
      );
    }
    await this.assertStandardSpaceRelations(
      spaceId,
      input.categoryId === undefined ? existing.categoryId : input.categoryId,
      existing.pages.map((link) => link.pageId),
    );
    if (input.categoryId !== undefined || input.responsibleId || input.validFrom || input.validUntil) {
      await this.validateRelations(input.categoryId, input.responsibleId ?? existing.responsibleId, []);
    }
    await this.snapshot(existing, userId);
    const standard = await this.prisma.standard.update({ where: { id }, data: {
      title: input.title, description: input.description, justification: input.justification,
      spaceId,
      priority: input.priority ? PRIORITY_DB[input.priority] : undefined,
      categoryId: input.categoryId, responsibleId: input.responsibleId,
      validFrom: input.validFrom === undefined ? undefined : input.validFrom ? new Date(input.validFrom) : null,
      validUntil: input.validUntil === undefined ? undefined : input.validUntil ? new Date(input.validUntil) : null,
      mcpVisible: input.mcpVisible, version: { increment: 1 },
      ...(existing.status === StandardStatus.ACTIVE && contentChange ? { status: StandardStatus.REVIEW, mcpVisible: false } : {}),
    }, include });
    return this.toApi(standard);
  }

  async remove(id: string, actor?: AuthenticatedUser) { await this.assertStandardAccess(actor, id, "delete"); const existing = await this.full(id); await this.prisma.standard.delete({ where: { id } }); return { id, title: existing.title }; }
  async submit(id: string, actor?: AuthenticatedUser) { await this.assertStandardAccess(actor, id, "update"); await this.full(id); return this.toApi(await this.prisma.standard.update({ where: { id }, data: { status: StandardStatus.REVIEW, mcpVisible: false }, include })); }
  async approve(id: string, actor?: AuthenticatedUser) { await this.assertStandardAccess(actor, id, "approve"); const current = await this.full(id); if (current.status !== StandardStatus.REVIEW) throw new BadRequestException("Nur Richtlinien in Prüfung können aktiviert werden."); return this.toApi(await this.prisma.standard.update({ where: { id }, data: { status: StandardStatus.ACTIVE }, include })); }
  async deprecate(id: string, actor?: AuthenticatedUser) { await this.assertStandardAccess(actor, id, "approve"); await this.full(id); return this.toApi(await this.prisma.standard.update({ where: { id }, data: { status: StandardStatus.DEPRECATED, mcpVisible: false }, include })); }

  async addRule(id: string, input: CreateStandardRuleInput, userId: string, actor?: AuthenticatedUser) { await this.assertStandardAccess(actor, id, "update"); const standard = await this.full(id); await this.snapshot(standard, userId); await this.prisma.$transaction([this.prisma.standardRule.create({ data: { standardId: id, ...this.ruleCreateData(input) } }), this.prisma.standard.update({ where: { id }, data: { version: { increment: 1 }, ...(standard.status === StandardStatus.ACTIVE ? { status: StandardStatus.REVIEW, mcpVisible: false } : {}) } })]); return this.findOne(id, actor); }
  async updateRule(id: string, ruleId: string, input: UpdateStandardRuleInput, userId: string, actor?: AuthenticatedUser) { await this.assertStandardAccess(actor, id, "update"); const standard = await this.full(id); await this.ensureRule(id, ruleId); await this.snapshot(standard, userId); await this.prisma.$transaction([this.prisma.standardRule.update({ where: { id: ruleId }, data: this.ruleUpdateData(input) }), this.prisma.standard.update({ where: { id }, data: { version: { increment: 1 }, ...(standard.status === StandardStatus.ACTIVE ? { status: StandardStatus.REVIEW, mcpVisible: false } : {}) } })]); return this.findOne(id, actor); }
  async removeRule(id: string, ruleId: string, userId: string, actor?: AuthenticatedUser) { await this.assertStandardAccess(actor, id, "update"); const standard = await this.full(id); await this.ensureRule(id, ruleId); await this.snapshot(standard, userId); await this.prisma.$transaction([this.prisma.standardRule.delete({ where: { id: ruleId } }), this.prisma.standard.update({ where: { id }, data: { version: { increment: 1 }, ...(standard.status === StandardStatus.ACTIVE ? { status: StandardStatus.REVIEW, mcpVisible: false } : {}) } })]); return this.findOne(id, actor); }

  async linkPage(
    id: string,
    pageId: string,
    actor?: AuthenticatedUser,
  ) {
    await this.assertStandardAccess(actor, id, "update");
    await this.assertLinkedPagesReadable(actor, [pageId]);
    const standard = await this.full(id);
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, deletedAt: null },
      select: { id: true, spaceId: true },
    });
    if (!page) throw new NotFoundException("Wiki-Seite wurde nicht gefunden.");
    if (page.spaceId !== standard.spaceId) {
      throw new BadRequestException(
        "Richtlinie und verknüpfte Wiki-Seite müssen demselben Bereich angehören.",
      );
    }
    await this.prisma.standardPageLink.upsert({
      where: { standardId_pageId: { standardId: id, pageId } },
      update: {},
      create: { standardId: id, pageId },
    });
    return this.findOne(id, actor);
  }
  async unlinkPage(id: string, pageId: string, actor?: AuthenticatedUser) { await this.assertStandardAccess(actor, id, "update"); await this.prisma.standardPageLink.deleteMany({ where: { standardId: id, pageId } }); return this.findOne(id, actor); }

  async requestException(id: string, input: RequestStandardExceptionInput, userId: string, actor?: AuthenticatedUser) { await this.assertStandardAccess(actor, id, "read"); await this.full(id); await this.ensureUser(input.responsibleId); await this.prisma.standardException.create({ data: { standardId: id, reason: input.reason, requestedById: userId, responsibleId: input.responsibleId, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } }); return this.findOne(id, actor); }
  async decideException(id: string, exceptionId: string, input: DecideStandardExceptionInput, userId: string, actor?: AuthenticatedUser) { await this.assertStandardAccess(actor, id, "approve"); const exception = await this.prisma.standardException.findFirst({ where: { id: exceptionId, standardId: id } }); if (!exception) throw new NotFoundException("Ausnahme wurde nicht gefunden."); await this.prisma.standardException.update({ where: { id: exceptionId }, data: { status: input.status === "approved" ? StandardExceptionStatus.APPROVED : StandardExceptionStatus.REJECTED, decisionNote: input.decisionNote, decidedById: userId } }); return this.findOne(id, actor); }

  async versions(id: string, user?: AuthenticatedUser) { if (user) await this.findOne(id, user); else await this.full(id); const versions = await this.prisma.standardVersion.findMany({ where: { standardId: id }, orderBy: { version: "desc" }, include: { author: { select: { id: true, displayName: true, email: true } } } }); return versions.map((v) => ({ id: v.id, version: v.version, snapshot: v.snapshot, author: v.author, createdAt: v.createdAt.toISOString() })); }

  private async full(id: string) { const value = await this.prisma.standard.findUnique({ where: { id }, include }); if (!value) throw new NotFoundException("Richtlinie wurde nicht gefunden."); return value; }
  private async ensureRule(standardId: string, id: string) { if (!(await this.prisma.standardRule.findFirst({ where: { id, standardId } }))) throw new NotFoundException("Regel wurde nicht gefunden."); }
  private async ensureUser(id: string) { if (!(await this.prisma.user.findFirst({ where: { id, isActive: true } }))) throw new NotFoundException("Verantwortlicher Benutzer wurde nicht gefunden."); }

  private async assertStandardAccess(
    actor: AuthenticatedUser | undefined,
    id: string,
    action: "read" | "update" | "delete" | "approve",
  ): Promise<void> {
    if (!actor || !this.access) return;
    await this.access.assertAllowed(actor, {
      resource: "standards",
      action,
      targetType: "standard",
      targetId: id,
    }, "Richtlinie wurde nicht gefunden.");
  }

  private async assertStandardDestination(
    actor: AuthenticatedUser | undefined,
    spaceId: string,
    categoryId: string | null | undefined,
    action: "create" | "update",
  ): Promise<void> {
    if (!actor || !this.access) return;
    await this.access.assertAllowed(actor, {
      resource: "standards",
      action,
      targetType: categoryId ? "category" : "space",
      targetId: categoryId ?? spaceId,
    });
  }

  private async assertLinkedPagesReadable(
    actor: AuthenticatedUser | undefined,
    pageIds: string[],
  ): Promise<void> {
    if (!actor || !this.access || pageIds.length === 0) return;
    const allowedIds = await this.access.allowedTargetIds(actor, {
      resource: "pages",
      action: "read",
      targetType: "page",
      targetIds: pageIds,
    });
    if (allowedIds.length !== new Set(pageIds).size) {
      throw new NotFoundException(
        "Mindestens eine Wiki-Seite wurde nicht gefunden.",
      );
    }
  }

  private async resolveStandardSpace(
    requestedSpaceId: string | undefined,
    categoryId: string | null | undefined,
    pageIds: string[],
    fallbackSpaceId?: string,
  ): Promise<string> {
    const [category, firstPage] = await Promise.all([
      categoryId
        ? this.prisma.category.findUnique({
            where: { id: categoryId },
            select: { scope: true, spaceId: true },
          })
        : null,
      pageIds[0]
        ? this.prisma.page.findFirst({
            where: { id: pageIds[0], deletedAt: null },
            select: { spaceId: true },
          })
        : null,
    ]);
    if (categoryId && (!category || category.scope !== CategoryScope.STANDARD)) {
      throw new BadRequestException(
        "Die Kategorie gehört nicht zu den Richtlinien.",
      );
    }
    const candidate =
      requestedSpaceId ??
      category?.spaceId ??
      firstPage?.spaceId ??
      fallbackSpaceId;
    return this.spaces.resolveOpenSpace("standard", candidate);
  }

  private async assertStandardSpaceRelations(
    spaceId: string,
    categoryId: string | null | undefined,
    pageIds: string[],
  ): Promise<void> {
    const [category, pageCount] = await Promise.all([
      categoryId
        ? this.prisma.category.findUnique({
            where: { id: categoryId },
            select: { spaceId: true },
          })
        : null,
      pageIds.length
        ? this.prisma.page.count({
            where: { id: { in: pageIds }, spaceId, deletedAt: null },
          })
        : 0,
    ]);
    if (category && category.spaceId !== spaceId) {
      throw new BadRequestException(
        "Richtlinie und Kategorie müssen demselben Bereich angehören.",
      );
    }
    if (pageIds.length && pageCount !== new Set(pageIds).size) {
      throw new BadRequestException(
        "Mindestens eine Wiki-Seite gehört zu einem anderen Bereich.",
      );
    }
  }
  private async validateRelations(categoryId: string | null | undefined, responsibleId: string, pageIds: string[]) { await this.ensureUser(responsibleId); if (categoryId) { const category = await this.prisma.category.findUnique({ where: { id: categoryId } }); if (!category || category.scope !== CategoryScope.STANDARD) throw new BadRequestException("Die Kategorie gehört nicht zu den Richtlinien."); } if (pageIds.length) { const count = await this.prisma.page.count({ where: { id: { in: pageIds }, deletedAt: null } }); if (count !== new Set(pageIds).size) throw new BadRequestException("Mindestens eine Wiki-Seite ist ungültig."); } }
  private async uniqueSlug(title: string) { const base = slugify(title, { lower: true, strict: true, locale: "de" }) || "standard"; let slug = base; let index = 1; while (await this.prisma.standard.findUnique({ where: { slug } })) { index += 1; slug = `${base}-${index}`; } return slug; }
  private ruleCreateData(input: CreateStandardRuleInput): Prisma.StandardRuleCreateWithoutStandardInput { return { title: input.title, description: input.description, type: RULE_DB[input.type ?? "must"], sortOrder: input.sortOrder ?? 0, minVcpu: input.minVcpu, minRamMb: input.minRamMb, backupRequired: input.backupRequired, allowedPorts: input.allowedPorts ?? [], allowedNetworks: input.allowedNetworks ?? [], namingConvention: input.namingConvention }; }
  private ruleUpdateData(input: UpdateStandardRuleInput): Prisma.StandardRuleUpdateInput { return { title: input.title, description: input.description, type: input.type ? RULE_DB[input.type] : undefined, sortOrder: input.sortOrder, minVcpu: input.minVcpu, minRamMb: input.minRamMb, backupRequired: input.backupRequired, allowedPorts: input.allowedPorts, allowedNetworks: input.allowedNetworks, namingConvention: input.namingConvention }; }
  private async snapshot(standard: FullStandard, userId: string) { const snapshot = { title: standard.title, description: standard.description, justification: standard.justification, status: STATUS_API[standard.status], priority: PRIORITY_API[standard.priority], validFrom: standard.validFrom?.toISOString() ?? null, validUntil: standard.validUntil?.toISOString() ?? null, rules: standard.rules.map((r) => this.mapRule(r)) }; await this.prisma.standardVersion.upsert({ where: { standardId_version: { standardId: standard.id, version: standard.version } }, update: {}, create: { standardId: standard.id, version: standard.version, authorId: userId, snapshot } }); }
  private mapRule(rule: FullStandard["rules"][number]) { return { id: rule.id, title: rule.title, description: rule.description, type: RULE_API[rule.type], sortOrder: rule.sortOrder, minVcpu: rule.minVcpu, minRamMb: rule.minRamMb, backupRequired: rule.backupRequired, allowedPorts: Array.isArray(rule.allowedPorts) ? rule.allowedPorts : [], allowedNetworks: Array.isArray(rule.allowedNetworks) ? rule.allowedNetworks : [], namingConvention: rule.namingConvention, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() }; }
  private async toApiMany(
    standards: FullStandard[],
    user?: AuthenticatedUser,
  ) {
    let allowedPageIds: Set<string> | undefined;
    if (user && this.access) {
      const linkedPageIds = [
        ...new Set(
          standards.flatMap((standard) =>
            standard.pages.map((link) => link.page.id),
          ),
        ),
      ];
      allowedPageIds = new Set(
        await this.access.allowedTargetIds(user, {
          resource: "pages",
          action: "read",
          targetType: "page",
          targetIds: linkedPageIds,
        }),
      );
    }
    return standards.map((standard) => this.toApi(standard, allowedPageIds));
  }
  private toApi(standard: FullStandard, allowedPageIds?: Set<string>) { const assessment = standard.classificationConfidence !== null && standard.classificationReason && standard.assessedAt ? { confidence: standard.classificationConfidence, reason: standard.classificationReason, qualityScore: standard.qualityScore, maturityScore: standard.maturityScore, sensitivity: standard.sensitivity ? SENSITIVITY_API[standard.sensitivity] : null, contradictions: Array.isArray(standard.contradictions) ? standard.contradictions : [], suggestedTitle: standard.suggestedTitle, suggestedTags: Array.isArray(standard.suggestedTags) ? standard.suggestedTags : [], suggestedCategoryId: standard.suggestedCategoryId, conversionSuggestion: standard.conversionSuggestion, assessedAt: standard.assessedAt.toISOString() } : null; return { id: standard.id, spaceId: standard.spaceId, title: standard.title, slug: standard.slug, description: standard.description, justification: standard.justification, status: STATUS_API[standard.status], priority: PRIORITY_API[standard.priority], version: standard.version, mcpVisible: standard.mcpVisible, knowledgeType: "standard" as const, knowledgePriority: 1 as const, validFrom: standard.validFrom?.toISOString() ?? null, validUntil: standard.validUntil?.toISOString() ?? null, categoryId: standard.categoryId, category: standard.category, createdBy: standard.createdBy, responsible: standard.responsible, rules: standard.rules.map((r) => this.mapRule(r)), pages: standard.pages.filter((p) => !allowedPageIds || allowedPageIds.has(p.page.id)).map((p) => p.page), exceptions: standard.exceptions.map((e) => ({ id: e.id, reason: e.reason, status: e.status === StandardExceptionStatus.APPROVED && e.expiresAt && e.expiresAt < new Date() ? "expired" : EXCEPTION_API[e.status], expiresAt: e.expiresAt?.toISOString() ?? null, decisionNote: e.decisionNote, requestedBy: e.requestedBy, responsible: e.responsible, decidedBy: e.decidedBy, createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString() })), assessment, createdAt: standard.createdAt.toISOString(), updatedAt: standard.updatedAt.toISOString() }; }
}
