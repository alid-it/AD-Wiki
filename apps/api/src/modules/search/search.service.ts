import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { GlobalSearchQuery, GlobalSearchResultType, SearchQuery } from "@ad-wiki/shared-types";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { ResourceAccessService } from "@/modules/resource-acls/resource-access.service";
import { PrismaService } from "@/prisma/prisma.service";

/** Ein einzelnes Suchergebnis (Ausschnitt einer Seite). */
interface SearchResultRow {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  rank: number;
}

interface GlobalSearchResultRow {
  type: GlobalSearchResultType;
  id: string;
  title: string;
  excerpt: string | null;
  match_field: "title" | "content" | "description" | "filename" | "altText" | "tag";
  updated_at: Date;
  slug: string | null;
  rank: number;
  total: number;
}

/**
 * Volltextsuche über veröffentlichte Seiten mittels PostgreSQL
 * `to_tsvector` / `plainto_tsquery`. Durchsucht Titel und Inhalt und
 * sortiert nach Relevanz (`ts_rank`).
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly access?: ResourceAccessService,
  ) {}

  /** Führt die paginierte Volltextsuche aus. */
  async search(query: SearchQuery) {
    const offset = (query.page - 1) * query.limit;

    // Wiederverwendete WHERE-Bedingung: nur veröffentlichte Treffer.
    const matchCondition = Prisma.sql`
      status::text = 'PUBLISHED'
      AND type::text = 'PAGE'
      AND is_public = true
      AND deleted_at IS NULL
      AND to_tsvector('german', title || ' ' || content)
          @@ plainto_tsquery('german', ${query.q})
    `;

    const [rows, countResult] = await this.prisma.$transaction([
      this.prisma.$queryRaw<SearchResultRow[]>`
        SELECT
          id,
          title,
          slug,
          excerpt,
          ts_rank(
            to_tsvector('german', title || ' ' || content),
            plainto_tsquery('german', ${query.q})
          )::float8 AS rank
        FROM pages
        WHERE ${matchCondition}
        ORDER BY rank DESC, created_at DESC
        LIMIT ${query.limit} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM pages
        WHERE ${matchCondition}
      `,
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data: rows.map((row) => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        excerpt: row.excerpt,
        rank: row.rank,
      })),
      meta: { total, page: query.page, perPage: query.limit, query: query.q },
    };
  }

  /**
   * Durchsucht alle Wissensquellen, für die der angemeldete Benutzer Leserechte
   * besitzt. Notizen und Tags werden zusätzlich auf die individuelle Sichtbarkeit
   * eingeschränkt, damit auch über Such-Metadaten keine Inhalte offengelegt werden.
   */
  async globalSearch(query: GlobalSearchQuery, user: AuthenticatedUser) {
    const selectedTypes = new Set(query.types ?? ["pages", "notes", "standards", "media"]);
    const [canReadPages, canReadNotes, canReadStandards, canReadMedia] = await Promise.all([
      selectedTypes.has("pages") ? this.hasPermission(user, "pages", "read") : false,
      selectedTypes.has("notes") ? this.hasPermission(user, "notes", "read") : false,
      selectedTypes.has("standards") ? this.hasPermission(user, "standards", "read") : false,
      selectedTypes.has("media") ? this.hasPermission(user, "media", "read") : false,
    ]);
    const needsPageVisibility = canReadPages || canReadMedia;
    const [pageCandidates, noteCandidates, standardCandidates] = await Promise.all([
      this.access && needsPageVisibility
        ? this.prisma.page.findMany({
            where: {
              deletedAt: null,
              type: "PAGE",
              ...(canReadPages ? { status: "PUBLISHED" } : {}),
            },
            select: { id: true },
          })
        : [],
      this.access && canReadNotes
        ? this.prisma.note.findMany({
            where: {
              deletedAt: null,
              OR: [
                {
                  spaceId: null,
                  OR: [
                    { ownerId: user.id },
                    { shares: { some: { userId: user.id } } },
                  ],
                },
                { spaceId: { not: null } },
              ],
            },
            select: { id: true },
          })
        : [],
      this.access && canReadStandards
        ? this.prisma.standard.findMany({ select: { id: true } })
        : [],
    ]);
    const [allowedPageIds, allowedNoteIds, allowedStandardIds] =
      this.access
        ? await Promise.all([
            this.access.allowedTargetIds(user, {
              resource: "pages",
              action: "read",
              targetType: "page",
              targetIds: pageCandidates.map((page) => page.id),
            }),
            this.access.allowedTargetIds(user, {
              resource: "notes",
              action: "read",
              targetType: "note",
              targetIds: noteCandidates.map((note) => note.id),
            }),
            this.access.allowedTargetIds(user, {
              resource: "standards",
              action: "read",
              targetType: "standard",
              targetIds: standardCandidates.map((standard) => standard.id),
            }),
          ])
        : [
            pageCandidates.map((page) => page.id),
            noteCandidates.map((note) => note.id),
            standardCandidates.map((standard) => standard.id),
          ];
    const pageAclCondition = !this.access
      ? Prisma.empty
      : allowedPageIds.length > 0
      ? Prisma.sql`AND p.id IN (${Prisma.join(allowedPageIds)})`
      : Prisma.sql`AND FALSE`;
    const noteAclCondition = !this.access
      ? Prisma.sql`AND (
          n.owner_id = ${user.id}
          OR EXISTS (
            SELECT 1 FROM note_shares ns
            WHERE ns.note_id = n.id AND ns.user_id = ${user.id}
          )
        )`
      : allowedNoteIds.length > 0
      ? Prisma.sql`AND n.id IN (${Prisma.join(allowedNoteIds)})`
      : Prisma.sql`AND FALSE`;
    const standardAclCondition = !this.access
      ? Prisma.empty
      : allowedStandardIds.length > 0
      ? Prisma.sql`AND s.id IN (${Prisma.join(allowedStandardIds)})`
      : Prisma.sql`AND FALSE`;

    const branches: Prisma.Sql[] = [];

    if (canReadPages && (!this.access || allowedPageIds.length > 0)) {
      branches.push(Prisma.sql`
        SELECT
          'page'::text AS type,
          p.id,
          p.title,
          COALESCE(
            NULLIF(p.excerpt, ''),
            LEFT(regexp_replace(p.content, '<[^>]+>', ' ', 'g'), 280)
          ) AS excerpt,
          CASE
            WHEN p.title ILIKE search.pattern THEN 'title'
            WHEN EXISTS (
              SELECT 1 FROM tags_on_pages tp
              JOIN tags t ON t.id = tp.tag_id
              WHERE tp.page_id = p.id AND t.name ILIKE search.pattern
            ) THEN 'tag'
            ELSE 'content'
          END::text AS match_field,
          p.updated_at,
          p.slug,
          (
            ts_rank(
              to_tsvector('german', coalesce(p.title, '') || ' ' || coalesce(p.content, '')),
              search.term
            )
            + CASE WHEN p.title ILIKE search.pattern THEN 1.0 ELSE 0.0 END
            + CASE WHEN EXISTS (
                SELECT 1 FROM tags_on_pages tp
                JOIN tags t ON t.id = tp.tag_id
                WHERE tp.page_id = p.id AND t.name ILIKE search.pattern
              ) THEN 0.5 ELSE 0.0 END
          )::float8 AS rank
        FROM pages p
        CROSS JOIN search_input search
        WHERE p.status::text = 'PUBLISHED'
          AND p.type::text = 'PAGE'
          AND p.deleted_at IS NULL
          ${pageAclCondition}
          AND (
            to_tsvector('german', coalesce(p.title, '') || ' ' || coalesce(p.content, '')) @@ search.term
            OR p.title ILIKE search.pattern
            OR p.content ILIKE search.pattern
            OR EXISTS (
              SELECT 1 FROM tags_on_pages tp
              JOIN tags t ON t.id = tp.tag_id
              WHERE tp.page_id = p.id AND t.name ILIKE search.pattern
            )
          )
      `);
    }

    if (canReadNotes && (!this.access || allowedNoteIds.length > 0)) {
      branches.push(Prisma.sql`
        SELECT
          'note'::text AS type,
          n.id,
          COALESCE(NULLIF(n.title, ''), LEFT(regexp_replace(n.content, '<[^>]+>', ' ', 'g'), 80), 'Notiz') AS title,
          LEFT(regexp_replace(n.content, '<[^>]+>', ' ', 'g'), 280) AS excerpt,
          CASE
            WHEN n.title ILIKE search.pattern THEN 'title'
            WHEN EXISTS (
              SELECT 1 FROM tags_on_notes tn
              JOIN tags t ON t.id = tn.tag_id
              WHERE tn.note_id = n.id AND t.name ILIKE search.pattern
            ) THEN 'tag'
            ELSE 'content'
          END::text AS match_field,
          n.updated_at,
          NULL::text AS slug,
          (
            ts_rank(
              to_tsvector('german', coalesce(n.title, '') || ' ' || coalesce(n.content, '')),
              search.term
            )
            + CASE WHEN n.title ILIKE search.pattern THEN 1.0 ELSE 0.0 END
            + CASE WHEN EXISTS (
                SELECT 1 FROM tags_on_notes tn
                JOIN tags t ON t.id = tn.tag_id
                WHERE tn.note_id = n.id AND t.name ILIKE search.pattern
              ) THEN 0.5 ELSE 0.0 END
          )::float8 AS rank
        FROM notes n
        CROSS JOIN search_input search
        WHERE n.deleted_at IS NULL
          ${noteAclCondition}
          AND (
            to_tsvector('german', coalesce(n.title, '') || ' ' || coalesce(n.content, '')) @@ search.term
            OR n.title ILIKE search.pattern
            OR n.content ILIKE search.pattern
            OR EXISTS (
              SELECT 1 FROM tags_on_notes tn
              JOIN tags t ON t.id = tn.tag_id
              WHERE tn.note_id = n.id AND t.name ILIKE search.pattern
            )
          )
      `);
    }

    if (canReadStandards && (!this.access || allowedStandardIds.length > 0)) {
      branches.push(Prisma.sql`
        SELECT
          'standard'::text AS type,
          s.id,
          s.title,
          LEFT(regexp_replace(s.description, '<[^>]+>', ' ', 'g'), 280) AS excerpt,
          CASE WHEN s.title ILIKE search.pattern THEN 'title' ELSE 'description' END::text AS match_field,
          s.updated_at,
          s.slug,
          (
            ts_rank(
              to_tsvector('german', coalesce(s.title, '') || ' ' || coalesce(s.description, '')),
              search.term
            )
            + CASE WHEN s.title ILIKE search.pattern THEN 1.0 ELSE 0.0 END
          )::float8 AS rank
        FROM standards s
        CROSS JOIN search_input search
        WHERE TRUE
          ${standardAclCondition}
          AND (
            to_tsvector('german', coalesce(s.title, '') || ' ' || coalesce(s.description, '')) @@ search.term
            OR s.title ILIKE search.pattern
            OR s.description ILIKE search.pattern
          )
      `);
    }

    if (canReadMedia) {
      const linkedMediaVisibility =
        !this.access
          ? Prisma.sql`TRUE`
          : allowedPageIds.length > 0
          ? Prisma.sql`
              NOT EXISTS (
                SELECT 1 FROM page_media pm WHERE pm.media_id = m.id
              )
              OR EXISTS (
                SELECT 1 FROM page_media pm
                WHERE pm.media_id = m.id
                  AND pm.page_id IN (${Prisma.join(allowedPageIds)})
              )
            `
          : Prisma.sql`
              NOT EXISTS (
                SELECT 1 FROM page_media pm WHERE pm.media_id = m.id
              )
            `;
      branches.push(Prisma.sql`
        SELECT
          'media'::text AS type,
          m.id,
          m.filename AS title,
          m.alt_text AS excerpt,
          CASE WHEN m.filename ILIKE search.pattern THEN 'filename' ELSE 'altText' END::text AS match_field,
          m.created_at AS updated_at,
          NULL::text AS slug,
          (
            CASE WHEN lower(m.filename) = lower(${query.q}) THEN 2.0 ELSE 0.0 END
            + CASE WHEN m.filename ILIKE search.pattern THEN 1.0 ELSE 0.0 END
            + CASE WHEN m.alt_text ILIKE search.pattern THEN 0.5 ELSE 0.0 END
          )::float8 AS rank
        FROM media m
        CROSS JOIN search_input search
        WHERE (${linkedMediaVisibility})
          AND (m.filename ILIKE search.pattern OR m.alt_text ILIKE search.pattern)
      `);
    }

    // Tags sind eine zusätzliche Ergebnisart im Tab „Alle“. Bei einem expliziten
    // Quellenfilter würden sie die erwartete Tab-Filterung verfälschen.
    if (!query.types && (canReadPages || canReadNotes)) {
      const visibility: Prisma.Sql[] = [];
      const timestamps: Prisma.Sql[] = [];
      if (canReadPages && (!this.access || allowedPageIds.length > 0)) {
        visibility.push(Prisma.sql`EXISTS (
          SELECT 1 FROM tags_on_pages tp
          JOIN pages p ON p.id = tp.page_id
          WHERE tp.tag_id = t.id
            AND p.status::text = 'PUBLISHED'
            AND p.type::text = 'PAGE'
            AND p.deleted_at IS NULL
            ${pageAclCondition}
        )`);
        timestamps.push(Prisma.sql`(
          SELECT MAX(p.updated_at) FROM tags_on_pages tp
          JOIN pages p ON p.id = tp.page_id
          WHERE tp.tag_id = t.id
            AND p.status::text = 'PUBLISHED'
            AND p.type::text = 'PAGE'
            AND p.deleted_at IS NULL
            ${pageAclCondition}
        )`);
      }
      if (canReadNotes && (!this.access || allowedNoteIds.length > 0)) {
        visibility.push(Prisma.sql`EXISTS (
          SELECT 1 FROM tags_on_notes tn
          JOIN notes n ON n.id = tn.note_id
          WHERE tn.tag_id = t.id
            AND n.deleted_at IS NULL
            ${noteAclCondition}
        )`);
        timestamps.push(Prisma.sql`(
          SELECT MAX(n.updated_at) FROM tags_on_notes tn
          JOIN notes n ON n.id = tn.note_id
          WHERE tn.tag_id = t.id
            AND n.deleted_at IS NULL
            ${noteAclCondition}
        )`);
      }
      if (visibility.length > 0) {
        branches.push(Prisma.sql`
        SELECT
          'tag'::text AS type,
          t.id,
          t.name AS title,
          NULL::text AS excerpt,
          'tag'::text AS match_field,
          COALESCE(GREATEST(${Prisma.join(timestamps, ", ")}), CURRENT_TIMESTAMP) AS updated_at,
          t.slug,
          (CASE WHEN lower(t.name) = lower(${query.q}) THEN 2.0 ELSE 1.0 END)::float8 AS rank
        FROM tags t
        CROSS JOIN search_input search
        WHERE t.name ILIKE search.pattern
          AND (${Prisma.join(visibility, " OR ")})
        `);
      }
    }

    if (branches.length === 0) {
      return {
        data: [],
        meta: { total: 0, page: query.page, perPage: query.limit, query: query.q },
      };
    }

    const offset = (query.page - 1) * query.limit;
    const rows = await this.prisma.$queryRaw<GlobalSearchResultRow[]>(Prisma.sql`
      WITH search_input AS (
        SELECT
          plainto_tsquery('german', ${query.q}) AS term,
          ${`%${query.q}%`}::text AS pattern
      ), results AS (
        ${Prisma.join(branches, " UNION ALL ")}
      )
      SELECT
        type,
        id,
        title,
        excerpt,
        match_field,
        updated_at,
        slug,
        rank,
        COUNT(*) OVER()::int AS total
      FROM results
      ORDER BY rank DESC, updated_at DESC, title ASC
      LIMIT ${query.limit} OFFSET ${offset}
    `);

    return {
      data: rows.map((row) => ({
        type: row.type,
        id: row.id,
        title: row.title,
        excerpt: row.excerpt,
        matchField: row.match_field,
        updatedAt: row.updated_at.toISOString(),
        url: this.resultUrl(row),
      })),
      meta: {
        total: rows[0]?.total ?? 0,
        page: query.page,
        perPage: query.limit,
        query: query.q,
      },
    };
  }

  private resultUrl(row: Pick<GlobalSearchResultRow, "type" | "id" | "slug" | "title">) {
    switch (row.type) {
      case "page":
        return `/wiki/${row.slug}`;
      case "note":
        return `/notes?note=${row.id}`;
      case "standard":
        return `/standards?standard=${row.id}`;
      case "media":
        return `/media?media=${row.id}`;
      case "tag":
        return `/search?q=${encodeURIComponent(row.title)}&types=pages,notes`;
    }
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
}
