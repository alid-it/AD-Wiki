import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  NoteStatus,
  PageStatus,
  PageType,
  Prisma,
  StandardStatus,
} from "@prisma/client";
import { z } from "zod";
import type {
  McpKnowledgeCatalogInput,
  McpKnowledgeCatalogOutput,
  McpKnowledgeDocument,
  McpKnowledgeListInput,
  McpKnowledgeListOutput,
  McpKnowledgeReadOutput,
  McpKnowledgeReference,
  McpKnowledgeSearchInput,
  McpKnowledgeSource,
  McpKnowledgeSearchOutput,
  McpWikiSearchInput,
} from "@ad-wiki/shared-types";
import { PrismaService } from "@/prisma/prisma.service";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { ResourceAccessService } from "@/modules/resource-acls/resource-access.service";

export interface KnowledgeAccessContext {
  userId: string;
  scopes: readonly string[];
  tokenId?: string;
  actor?: AuthenticatedUser;
}

interface CursorPayload {
  id: string;
  updatedAt: Date;
}

interface SearchCursorPayload extends CursorPayload {
  score: number;
  kind: "note" | "wiki" | "standard";
  queryHash: string;
}

interface KnowledgeSearchRow {
  id: string;
  kind: "note" | "wiki" | "standard";
  title: string;
  status: string;
  version: number | null;
  updatedAt: Date;
  resourceKey: string;
  knowledgePriority: 1 | 2 | 3;
  excerpt: string | null;
  score: number;
}

const CursorSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string().datetime(),
});

const SearchCursorSchema = CursorSchema.extend({
  score: z.number().finite().nonnegative(),
  kind: z.enum(["note", "wiki", "standard"]),
  queryHash: z.string().length(64),
});

const pageSourceSelect = Prisma.validator<Prisma.PageSelect>()({
  id: true,
  title: true,
  slug: true,
  status: true,
  version: true,
  updatedAt: true,
});
type PageSourceRow = Prisma.PageGetPayload<{ select: typeof pageSourceSelect }>;

const pageDocumentSelect = Prisma.validator<Prisma.PageSelect>()({
  ...pageSourceSelect,
  content: true,
  excerpt: true,
  category: { select: { id: true, name: true, slug: true } },
  tags: { include: { tag: { select: { name: true } } } },
});
type PageDocumentRow = Prisma.PageGetPayload<{ select: typeof pageDocumentSelect }>;

const noteSourceSelect = Prisma.validator<Prisma.NoteSelect>()({
  id: true,
  title: true,
  content: true,
  status: true,
  updatedAt: true,
});
type NoteSourceRow = Prisma.NoteGetPayload<{ select: typeof noteSourceSelect }>;

const standardSourceSelect = Prisma.validator<Prisma.StandardSelect>()({
  id: true,
  title: true,
  slug: true,
  status: true,
  version: true,
  updatedAt: true,
});
type StandardSourceRow = Prisma.StandardGetPayload<{ select: typeof standardSourceSelect }>;

const standardDocumentSelect = Prisma.validator<Prisma.StandardSelect>()({
  ...standardSourceSelect,
  description: true,
  justification: true,
  priority: true,
  validFrom: true,
  validUntil: true,
  category: { select: { id: true, name: true, slug: true } },
  rules: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      title: true,
      description: true,
      type: true,
      sortOrder: true,
      minVcpu: true,
      minRamMb: true,
      backupRequired: true,
      allowedPorts: true,
      allowedNetworks: true,
      namingConvention: true,
    },
  },
});
type StandardDocumentRow = Prisma.StandardGetPayload<{
  select: typeof standardDocumentSelect;
}>;

/**
 * Einziger Datenzugang für MCP-Lesewerkzeuge.
 *
 * Die Filter kombinieren ACL, MCP-Freigabe, Status, Löschzustand,
 * Eigentümerschaft/Freigaben und zeitliche Gültigkeit. Unsichtbare Inhalte
 * werden beim Einzelabruf absichtlich wie nicht vorhandene Inhalte behandelt.
 */
@Injectable()
export class KnowledgeAccessService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly access?: ResourceAccessService,
  ) {}

  /**
   * Listet den gesamten für den Tokenbenutzer sichtbaren Wissenskatalog.
   * Die bestehenden typspezifischen Listen bleiben die einzige Filterquelle,
   * damit ACL, Eigentum, Freigaben, Status und MCP-Sichtbarkeit identisch sind.
   */
  async listKnowledge(
    context: KnowledgeAccessContext,
    input: McpKnowledgeCatalogInput,
  ): Promise<McpKnowledgeCatalogOutput> {
    const empty = (): McpKnowledgeListOutput => ({
      results: [],
      sources: [],
      conflicts: [],
      warnings: [],
      nextCursor: null,
    });
    const allowed = (scope: string) => context.scopes.includes(scope);

    const [wiki, notes, standards] = await Promise.all([
      allowed("pages:read")
        ? this.listWiki(context, { limit: input.limitPerType, cursor: input.cursors.wiki })
        : Promise.resolve(empty()),
      allowed("notes:read")
        ? this.listNotes(context, { limit: input.limitPerType, cursor: input.cursors.notes })
        : Promise.resolve(empty()),
      allowed("standards:read")
        ? this.listStandards(context, { limit: input.limitPerType, cursor: input.cursors.standards })
        : Promise.resolve(empty()),
    ]);

    const warnings = [
      ...(!allowed("pages:read")
        ? ["Wiki-Seiten wurden wegen fehlender Leseberechtigung übersprungen."]
        : []),
      ...(!allowed("notes:read")
        ? ["Notizen wurden wegen fehlender Leseberechtigung übersprungen."]
        : []),
      ...(!allowed("standards:read")
        ? ["Richtlinien wurden wegen fehlender Leseberechtigung übersprungen."]
        : []),
      ...wiki.warnings,
      ...notes.warnings,
      ...standards.warnings,
    ];

    return {
      results: {
        wiki: wiki.results,
        notes: notes.results,
        standards: standards.results,
      },
      sources: [...wiki.sources, ...notes.sources, ...standards.sources],
      warnings,
      nextCursors: {
        wiki: wiki.nextCursor,
        notes: notes.nextCursor,
        standards: standards.nextCursor,
      },
    };
  }

  async listWiki(
    context: KnowledgeAccessContext,
    input: McpKnowledgeListInput,
  ): Promise<McpKnowledgeListOutput> {
    const cursor = this.decodeCursor(input.cursor);
    const where = await this.wikiAclWhere(context);
    const rows = await this.prisma.page.findMany({
      where: this.withCursor(where, cursor),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      select: pageSourceSelect,
    });
    return this.listOutput(rows.map((row) => this.pageSource(row)), input.limit);
  }

  async readWiki(
    context: KnowledgeAccessContext,
    reference: McpKnowledgeReference,
  ): Promise<McpKnowledgeReadOutput> {
    const where = await this.wikiAclWhere(context);
    const row = await this.prisma.page.findFirst({
      where: { ...where, ...this.referenceWhere(reference) },
      select: pageDocumentSelect,
    });
    if (!row) throw this.notFound();
    return this.readOutput(this.pageDocument(row));
  }

  async searchWiki(
    context: KnowledgeAccessContext,
    input: McpWikiSearchInput,
  ): Promise<McpKnowledgeSearchOutput> {
    return this.searchKinds(context, input, ["wiki"]);
  }

  async searchNotes(
    context: KnowledgeAccessContext,
    input: McpWikiSearchInput,
  ): Promise<McpKnowledgeSearchOutput> {
    return this.searchKinds(context, input, ["note"]);
  }

  async searchStandards(
    context: KnowledgeAccessContext,
    input: McpWikiSearchInput,
  ): Promise<McpKnowledgeSearchOutput> {
    return this.searchKinds(context, input, ["standard"]);
  }

  async searchKnowledge(
    context: KnowledgeAccessContext,
    input: McpKnowledgeSearchInput,
  ): Promise<McpKnowledgeSearchOutput> {
    return this.searchKinds(context, input, input.types);
  }

  async listNotes(
    context: KnowledgeAccessContext,
    input: McpKnowledgeListInput,
  ): Promise<McpKnowledgeListOutput> {
    const cursor = this.decodeCursor(input.cursor);
    const where = await this.noteAclWhere(context);
    const rows = await this.prisma.note.findMany({
      where: this.withCursor(where, cursor),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      select: noteSourceSelect,
    });
    return this.listOutput(rows.map((row) => this.noteSource(row)), input.limit);
  }

  async readNote(
    context: KnowledgeAccessContext,
    id: string,
  ): Promise<McpKnowledgeReadOutput> {
    const where = await this.noteAclWhere(context);
    const row = await this.prisma.note.findFirst({
      where: { ...where, id },
      select: {
        ...noteSourceSelect,
        ownerId: true,
        category: { select: { id: true, name: true, slug: true } },
        tags: { include: { tag: { select: { name: true } } } },
        shares: {
          where: { userId: context.userId },
          select: { permission: true },
          take: 1,
        },
      },
    });
    if (!row) throw this.notFound();
    const source = this.noteSource(row);
    const document: McpKnowledgeDocument = {
      source,
      content: row.content,
      excerpt: this.excerpt(row.content),
      category: row.category,
      tags: row.tags.map((entry) => entry.tag.name),
      metadata: {
        isOwner: row.ownerId === context.userId,
        sharePermission: row.shares[0]?.permission.toLowerCase() ?? null,
      },
    };
    return this.readOutput(document);
  }

  async listStandards(
    context: KnowledgeAccessContext,
    input: McpKnowledgeListInput,
    now = new Date(),
  ): Promise<McpKnowledgeListOutput> {
    const cursor = this.decodeCursor(input.cursor);
    const where = await this.standardAclWhere(context, now);
    const rows = await this.prisma.standard.findMany({
      where: this.withCursor(where, cursor),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      select: standardSourceSelect,
    });
    return this.listOutput(rows.map((row) => this.standardSource(row)), input.limit);
  }

  async readStandard(
    context: KnowledgeAccessContext,
    reference: McpKnowledgeReference,
    now = new Date(),
  ): Promise<McpKnowledgeReadOutput> {
    const where = await this.standardAclWhere(context, now);
    const row = await this.prisma.standard.findFirst({
      where: {
        ...where,
        ...this.referenceWhere(reference),
      },
      select: standardDocumentSelect,
    });
    if (!row) throw this.notFound();
    return this.readOutput(this.standardDocument(row));
  }

  private async searchKinds(
    context: KnowledgeAccessContext,
    input: McpWikiSearchInput,
    requestedKinds: readonly ("note" | "wiki" | "standard")[],
    now = new Date(),
  ): Promise<McpKnowledgeSearchOutput> {
    const uniqueKinds = [...new Set(requestedKinds)].sort();
    const allowedKinds = uniqueKinds.filter((kind) =>
      context.scopes.includes(this.scopeForKind(kind)),
    );
    if (allowedKinds.length === 0) {
      throw new ForbiddenException("Für die angeforderten Wissenstypen fehlt die Leseberechtigung.");
    }

    const query = input.query.trim();
    const fingerprint = `${query}\u0000${allowedKinds.join(",")}`;
    const cursor = this.decodeSearchCursor(input.cursor, fingerprint);
    const cursorCondition = cursor
      ? Prisma.sql`AND (
          score < ${cursor.score}
          OR (
            score = ${cursor.score}
            AND (
              "updatedAt" < ${cursor.updatedAt}
              OR (
                "updatedAt" = ${cursor.updatedAt}
                AND (
                  kind > ${cursor.kind}
                  OR (kind = ${cursor.kind} AND id < ${cursor.id})
                )
              )
            )
          )
        )`
      : Prisma.empty;
    const wantsWiki = allowedKinds.includes("wiki");
    const wantsNote = allowedKinds.includes("note");
    const wantsStandard = allowedKinds.includes("standard");
    const [wikiIds, noteIds, standardIds] = await Promise.all([
      wantsWiki && this.access
        ? this.prisma.page.findMany({
            where: await this.wikiAclWhere(context),
            select: { id: true },
          })
        : [],
      wantsNote && this.access
        ? this.prisma.note.findMany({
            where: await this.noteAclWhere(context),
            select: { id: true },
          })
        : [],
      wantsStandard && this.access
        ? this.prisma.standard.findMany({
            where: await this.standardAclWhere(context, now),
            select: { id: true },
          })
        : [],
    ]);
    const visibleWikiIds = wikiIds.map((row) => row.id);
    const visibleNoteIds = noteIds.map((row) => row.id);
    const visibleStandardIds = standardIds.map((row) => row.id);
    const includeWiki = wantsWiki && (!this.access || visibleWikiIds.length > 0);
    const includeNote = wantsNote && (!this.access || visibleNoteIds.length > 0);
    const includeStandard =
      wantsStandard && (!this.access || visibleStandardIds.length > 0);
    const wikiAclCondition = !this.access
      ? Prisma.empty
      : includeWiki
      ? Prisma.sql`AND p.id IN (${Prisma.join(visibleWikiIds)})`
      : Prisma.sql`AND FALSE`;
    const noteAclCondition = !this.access
      ? Prisma.empty
      : includeNote
      ? Prisma.sql`AND n.id IN (${Prisma.join(visibleNoteIds)})`
      : Prisma.sql`AND FALSE`;
    const standardAclCondition = !this.access
      ? Prisma.empty
      : includeStandard
      ? Prisma.sql`AND s.id IN (${Prisma.join(visibleStandardIds)})`
      : Prisma.sql`AND FALSE`;

    const rows = await this.prisma.$queryRaw<KnowledgeSearchRow[]>`
      WITH search_query AS (
        SELECT plainto_tsquery('german', ${query}) AS query
      ), matches AS (
        SELECT
          p.id,
          'wiki'::text AS kind,
          p.title,
          p.status::text AS status,
          p.version,
          p.updated_at AS "updatedAt",
          p.slug AS "resourceKey",
          2::integer AS "knowledgePriority",
          COALESCE(
            NULLIF(p.excerpt, ''),
            LEFT(regexp_replace(p.content, '\\s+', ' ', 'g'), 500)
          ) AS excerpt,
          ts_rank(
            to_tsvector('german', p.title || ' ' || p.content),
            search_query.query
          ) AS "textScore"
        FROM pages p
        CROSS JOIN search_query
        WHERE ${includeWiki}
          AND p.type::text = 'PAGE'
          AND p.status::text = 'PUBLISHED'
          AND p.mcp_visible = TRUE
          AND p.deleted_at IS NULL
          ${wikiAclCondition}
          AND to_tsvector('german', p.title || ' ' || p.content) @@ search_query.query

        UNION ALL

        SELECT
          n.id,
          'note'::text AS kind,
          COALESCE(
            NULLIF(BTRIM(n.title), ''),
            LEFT(regexp_replace(n.content, '\\s+', ' ', 'g'), 80),
            'Notiz'
          ) AS title,
          n.status::text AS status,
          NULL::integer AS version,
          n.updated_at AS "updatedAt",
          n.id::text AS "resourceKey",
          3::integer AS "knowledgePriority",
          LEFT(regexp_replace(n.content, '\\s+', ' ', 'g'), 500) AS excerpt,
          ts_rank(
            to_tsvector('german', COALESCE(n.title, '') || ' ' || n.content),
            search_query.query
          ) AS "textScore"
        FROM notes n
        CROSS JOIN search_query
        WHERE ${includeNote}
          AND n.status::text <> 'ARCHIVED'
          AND n.mcp_visible = TRUE
          AND n.deleted_at IS NULL
          ${noteAclCondition}
          AND (
            ${this.access !== undefined}
            OR n.owner_id = ${context.userId}
            OR EXISTS (
              SELECT 1
              FROM note_shares share
              WHERE share.note_id = n.id
                AND share.user_id = ${context.userId}
            )
          )
          AND to_tsvector('german', COALESCE(n.title, '') || ' ' || n.content) @@ search_query.query

        UNION ALL

        SELECT
          s.id,
          'standard'::text AS kind,
          s.title,
          s.status::text AS status,
          s.version,
          s.updated_at AS "updatedAt",
          s.id::text AS "resourceKey",
          1::integer AS "knowledgePriority",
          LEFT(regexp_replace(s.description, '\\s+', ' ', 'g'), 500) AS excerpt,
          ts_rank(
            to_tsvector(
              'german',
              s.title || ' ' || s.description || ' ' || s.justification
            ),
            search_query.query
          ) AS "textScore"
        FROM standards s
        CROSS JOIN search_query
        WHERE ${includeStandard}
          AND s.status::text = 'ACTIVE'
          AND s.mcp_visible = TRUE
          ${standardAclCondition}
          AND (s.valid_from IS NULL OR s.valid_from <= ${now})
          AND (s.valid_until IS NULL OR s.valid_until >= ${now})
          AND to_tsvector(
            'german',
            s.title || ' ' || s.description || ' ' || s.justification
          ) @@ search_query.query
      ), ranked AS (
        SELECT
          id,
          kind,
          title,
          status,
          version,
          "updatedAt",
          "resourceKey",
          "knowledgePriority",
          excerpt,
          (
            "textScore"
            + CASE "knowledgePriority"
                WHEN 1 THEN 0.10
                WHEN 2 THEN 0.05
                ELSE 0.00
              END
          )::float8 AS score
        FROM matches
      )
      SELECT *
      FROM ranked
      WHERE score > 0
        ${cursorCondition}
      ORDER BY score DESC, "updatedAt" DESC, kind ASC, id DESC
      LIMIT ${input.limit + 1}
    `;

    const hasMore = rows.length > input.limit;
    const visibleRows = hasMore ? rows.slice(0, input.limit) : rows;
    const sources = visibleRows.map((row) => this.searchSource(row));
    const last = visibleRows[visibleRows.length - 1];
    const skippedKinds = uniqueKinds.filter((kind) => !allowedKinds.includes(kind));
    return {
      results: visibleRows.map((row) => ({
        sourceId: row.id,
        excerpt: row.excerpt,
        score: row.score,
      })),
      sources,
      conflicts: [],
      warnings: skippedKinds.map(
        (kind) => `Wissenstyp ${kind} wurde wegen fehlender Leseberechtigung übersprungen.`,
      ),
      nextCursor: hasMore && last
        ? this.encodeSearchCursor(last, fingerprint)
        : null,
    };
  }

  private async wikiAclWhere(
    context: KnowledgeAccessContext,
  ): Promise<Prisma.PageWhereInput> {
    const where = this.wikiWhere(context);
    if (!this.access) return where;
    const candidates = await this.prisma.page.findMany({
      where,
      select: { id: true },
    });
    const allowedIds = await this.access.allowedTargetIds(
      await this.resolveActor(context),
      {
        resource: "pages",
        action: "read",
        targetType: "page",
        targetIds: candidates.map((candidate) => candidate.id),
      },
    );
    return { AND: [where, { id: { in: allowedIds } }] };
  }

  private async noteAclWhere(
    context: KnowledgeAccessContext,
  ): Promise<Prisma.NoteWhereInput> {
    const where = this.noteWhere(context);
    if (!this.access) return where;
    const candidates = await this.prisma.note.findMany({
      where,
      select: { id: true },
    });
    const allowedIds = await this.access.allowedTargetIds(
      await this.resolveActor(context),
      {
        resource: "notes",
        action: "read",
        targetType: "note",
        targetIds: candidates.map((candidate) => candidate.id),
      },
    );
    return { AND: [where, { id: { in: allowedIds } }] };
  }

  private async standardAclWhere(
    context: KnowledgeAccessContext,
    now: Date,
  ): Promise<Prisma.StandardWhereInput> {
    const where = this.standardWhere(context, now);
    if (!this.access) return where;
    const candidates = await this.prisma.standard.findMany({
      where,
      select: { id: true },
    });
    const allowedIds = await this.access.allowedTargetIds(
      await this.resolveActor(context),
      {
        resource: "standards",
        action: "read",
        targetType: "standard",
        targetIds: candidates.map((candidate) => candidate.id),
      },
    );
    return { AND: [where, { id: { in: allowedIds } }] };
  }

  private async resolveActor(
    context: KnowledgeAccessContext,
  ): Promise<AuthenticatedUser> {
    if (context.actor) return context.actor;
    const user = await this.prisma.user.findUnique({
      where: { id: context.userId },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        roleId: true,
        role: { select: { name: true } },
        isActive: true,
        isProtected: true,
      },
    });
    if (!user || !user.isActive) throw this.notFound();
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      roleId: user.roleId,
      role: user.role.name as AuthenticatedUser["role"],
      isActive: user.isActive,
      isProtected: user.isProtected,
      authenticationMethod: "jwt",
    };
  }

  private wikiWhere(context: KnowledgeAccessContext): Prisma.PageWhereInput {
    this.requireScope(context, "pages:read");
    return {
      type: PageType.PAGE,
      status: PageStatus.PUBLISHED,
      mcpVisible: true,
      deletedAt: null,
    };
  }

  private noteWhere(context: KnowledgeAccessContext): Prisma.NoteWhereInput {
    this.requireScope(context, "notes:read");
    return {
      status: { not: NoteStatus.ARCHIVED },
      mcpVisible: true,
      deletedAt: null,
      OR: this.access
        ? [
            {
              spaceId: null,
              OR: [
                { ownerId: context.userId },
                { shares: { some: { userId: context.userId } } },
              ],
            },
            { spaceId: { not: null } },
          ]
        : [
            { ownerId: context.userId },
            { shares: { some: { userId: context.userId } } },
          ],
    };
  }

  private standardWhere(
    context: KnowledgeAccessContext,
    now: Date,
  ): Prisma.StandardWhereInput {
    this.requireScope(context, "standards:read");
    return {
      status: StandardStatus.ACTIVE,
      mcpVisible: true,
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
      ],
    };
  }

  private requireScope(context: KnowledgeAccessContext, scope: string): void {
    if (!context.scopes.includes(scope)) {
      throw new ForbiddenException("Für diesen Wissenstyp fehlt die Leseberechtigung.");
    }
  }

  private scopeForKind(kind: "note" | "wiki" | "standard"): string {
    switch (kind) {
      case "note":
        return "notes:read";
      case "wiki":
        return "pages:read";
      case "standard":
        return "standards:read";
    }
  }

  private withCursor<T extends Prisma.PageWhereInput | Prisma.NoteWhereInput | Prisma.StandardWhereInput>(
    where: T,
    cursor: CursorPayload | null,
  ): T {
    if (!cursor) return where;
    return {
      AND: [
        where,
        {
          OR: [
            { updatedAt: { lt: cursor.updatedAt } },
            { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
          ],
        },
      ],
    } as T;
  }

  private listOutput(
    allSources: McpKnowledgeSource[],
    limit: number,
  ): McpKnowledgeListOutput {
    const hasMore = allSources.length > limit;
    const sources = hasMore ? allSources.slice(0, limit) : allSources;
    const last = sources[sources.length - 1];
    return {
      results: sources,
      sources,
      conflicts: [],
      warnings: [],
      nextCursor: hasMore && last ? this.encodeCursor(last) : null,
    };
  }

  private readOutput(document: McpKnowledgeDocument): McpKnowledgeReadOutput {
    return {
      result: document,
      sources: [document.source],
      conflicts: [],
      warnings: [],
    };
  }

  private pageSource(row: PageSourceRow): McpKnowledgeSource {
    return {
      id: row.id,
      type: "wiki",
      title: row.title,
      status: row.status.toLowerCase(),
      knowledgePriority: 2,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
      uri: `ad-wiki://wiki/${row.slug}`,
    };
  }

  private noteSource(row: NoteSourceRow): McpKnowledgeSource {
    return {
      id: row.id,
      type: "note",
      title: row.title?.trim() || this.excerpt(row.content, 80) || "Notiz",
      status: row.status.toLowerCase(),
      knowledgePriority: 3,
      version: null,
      updatedAt: row.updatedAt.toISOString(),
      uri: `ad-wiki://notes/${row.id}`,
    };
  }

  private standardSource(row: StandardSourceRow): McpKnowledgeSource {
    return {
      id: row.id,
      type: "standard",
      title: row.title,
      status: row.status.toLowerCase(),
      knowledgePriority: 1,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
      uri: `ad-wiki://standards/${row.id}`,
    };
  }

  private searchSource(row: KnowledgeSearchRow): McpKnowledgeSource {
    const uri = row.kind === "wiki"
      ? `ad-wiki://wiki/${row.resourceKey}`
      : row.kind === "note"
        ? `ad-wiki://notes/${row.resourceKey}`
        : `ad-wiki://standards/${row.resourceKey}`;
    return {
      id: row.id,
      type: row.kind,
      title: row.title,
      status: row.status.toLowerCase(),
      knowledgePriority: row.knowledgePriority,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
      uri,
    };
  }

  private pageDocument(row: PageDocumentRow): McpKnowledgeDocument {
    return {
      source: this.pageSource(row),
      content: row.content,
      excerpt: row.excerpt,
      category: row.category,
      tags: row.tags.map((entry) => entry.tag.name),
      metadata: { slug: row.slug },
    };
  }

  private standardDocument(row: StandardDocumentRow): McpKnowledgeDocument {
    const rulesText = row.rules
      .map((rule) => `- [${rule.type.toLowerCase()}] ${rule.title}${rule.description ? `: ${rule.description}` : ""}`)
      .join("\n");
    const content = [
      row.description,
      `## Begründung\n${row.justification}`,
      rulesText ? `## Regeln\n${rulesText}` : null,
    ].filter((value): value is string => Boolean(value)).join("\n\n");
    return {
      source: this.standardSource(row),
      content,
      excerpt: this.excerpt(row.description),
      category: row.category,
      tags: [],
      metadata: {
        slug: row.slug,
        priority: row.priority.toLowerCase(),
        validFrom: row.validFrom?.toISOString() ?? null,
        validUntil: row.validUntil?.toISOString() ?? null,
        rules: row.rules.map((rule) => ({
          id: rule.id,
          title: rule.title,
          description: rule.description,
          type: rule.type.toLowerCase(),
          sortOrder: rule.sortOrder,
          minVcpu: rule.minVcpu,
          minRamMb: rule.minRamMb,
          backupRequired: rule.backupRequired,
          allowedPorts: Array.isArray(rule.allowedPorts) ? rule.allowedPorts : [],
          allowedNetworks: Array.isArray(rule.allowedNetworks) ? rule.allowedNetworks : [],
          namingConvention: rule.namingConvention,
        })),
      },
    };
  }

  private referenceWhere(
    reference: McpKnowledgeReference,
  ): { id: string } | { slug: string } {
    if (reference.id && !reference.slug) return { id: reference.id };
    if (reference.slug && !reference.id) return { slug: reference.slug };
    throw new BadRequestException("Genau eine Referenz aus id oder slug ist erforderlich.");
  }

  private excerpt(content: string, maxLength = 500): string | null {
    const normalized = content.replace(/\s+/g, " ").trim();
    return normalized ? normalized.slice(0, maxLength) : null;
  }

  private encodeCursor(source: McpKnowledgeSource): string {
    return Buffer.from(
      JSON.stringify({ id: source.id, updatedAt: source.updatedAt }),
      "utf8",
    ).toString("base64url");
  }

  private encodeSearchCursor(row: KnowledgeSearchRow, query: string): string {
    return Buffer.from(
      JSON.stringify({
        id: row.id,
        updatedAt: row.updatedAt.toISOString(),
        score: row.score,
        kind: row.kind,
        queryHash: this.queryHash(query),
      }),
      "utf8",
    ).toString("base64url");
  }

  private decodeCursor(raw: string | undefined): CursorPayload | null {
    if (!raw) return null;
    try {
      const parsed = CursorSchema.parse(
        JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
      );
      return { id: parsed.id, updatedAt: new Date(parsed.updatedAt) };
    } catch {
      throw new BadRequestException("Der Pagination-Cursor ist ungültig.");
    }
  }

  private decodeSearchCursor(
    raw: string | undefined,
    query: string,
  ): SearchCursorPayload | null {
    if (!raw) return null;
    try {
      const parsed = SearchCursorSchema.parse(
        JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
      );
      if (parsed.queryHash !== this.queryHash(query)) throw new Error("query_mismatch");
      return {
        id: parsed.id,
        updatedAt: new Date(parsed.updatedAt),
        score: parsed.score,
        kind: parsed.kind,
        queryHash: parsed.queryHash,
      };
    } catch {
      throw new BadRequestException("Der Such-Cursor ist ungültig.");
    }
  }

  private queryHash(query: string): string {
    return createHash("sha256")
      .update(query.trim().toLocaleLowerCase("de-DE"), "utf8")
      .digest("hex");
  }

  private notFound(): NotFoundException {
    return new NotFoundException("Wissensinhalt wurde nicht gefunden.");
  }
}
