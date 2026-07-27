import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { access, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { PageStatus, PageType, Prisma, type Media as PrismaMedia } from "@prisma/client";
import type { MediaQuery, SetMediaPagesInput } from "@ad-wiki/shared-types";
import { PrismaService } from "@/prisma/prisma.service";
import { UPLOAD_DIR } from "@/modules/media/media.config";
import { inspectMediaFile } from "@/modules/media/media-file-inspection";
import { PagesService } from "@/modules/pages/pages.service";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { PermissionService } from "@/modules/auth/permission.service";
import { ResourceAccessService } from "@/modules/resource-acls/resource-access.service";

/**
 * Geschäftslogik für Medien: Persistenz der Upload-Metadaten,
 * paginierte Auflistung sowie das Löschen inklusive Datei auf der Platte.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pagesService: PagesService,
    @Optional() private readonly permissions?: PermissionService,
    @Optional() private readonly resourceAccess?: ResourceAccessService,
  ) {}

  /**
   * Speichert die Metadaten einer bereits von Multer abgelegten Datei.
   * `filepath` wird relativ als `uploads/<dateiname>` gehalten.
   */
  async create(file: Express.Multer.File, uploadedById: string) {
    try {
      const inspected = await inspectMediaFile({ path: file.path, originalName: file.originalname });
      const media = await this.prisma.media.create({
        data: {
          filename: file.originalname,
          filepath: `uploads/${file.filename}`,
          mimetype: inspected.mimetype,
          size: inspected.size,
          uploadedById,
        },
      });
      return this.toApiMedia(media);
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      throw error;
    }
  }

  /** Importiert Markdown als Medium und legt daraus direkt einen Wiki-Entwurf an. */
  async importMarkdown(
    file: Express.Multer.File,
    uploadedById: string,
    actor?: AuthenticatedUser,
  ) {
    try {
      const inspected = await inspectMediaFile({ path: file.path, originalName: file.originalname });
      if (inspected.mimetype !== "text/markdown") {
        throw new BadRequestException("Für den Wiki-Import ist eine gültige Markdown-Datei erforderlich.");
      }

      const content = await readFile(file.path, "utf8");
      const heading = /^\s*#\s+(.+)$/m.exec(content)?.[1]?.trim();
      const fallbackTitle = file.originalname.replace(/\.(md|markdown)$/i, "");
      const page = await this.pagesService.create(
        {
          title: heading || fallbackTitle || "Importierte Seite",
          type: "page",
          content,
          status: "draft",
          isPublic: false,
          mcpVisible: false,
          categoryId: null,
          parentId: null,
          tags: [],
        },
        uploadedById,
        actor,
      );

      const media = await this.prisma.media.create({
        data: {
          filename: file.originalname,
          filepath: `uploads/${file.filename}`,
          mimetype: inspected.mimetype,
          size: inspected.size,
          uploadedById,
          pages: { create: { pageId: page.id } },
        },
        include: { pages: { select: { pageId: true } } },
      });

      return { media: this.toApiMedia(media), page };
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      throw error;
    }
  }

  /** Paginierte Liste aller Medien (neueste zuerst). */
  async findAll(
    query: MediaQuery,
    userId: string,
    isAdmin: boolean,
    actor?: AuthenticatedUser,
  ) {
    const where: Prisma.MediaWhereInput = {
      ...(query.pageId ? { pages: { some: { pageId: query.pageId } } } : {}),
      ...(!isAdmin || query.scope === "mine" ? { uploadedById: userId } : {}),
    };
    if (actor && this.resourceAccess) {
      const candidates = await this.prisma.media.findMany({
        where,
        select: { id: true, pages: { select: { pageId: true } } },
      });
      where.id = {
        in: await this.visibleMediaIds(actor, candidates),
      };
    }
    const [total, media] = await this.prisma.$transaction([
      this.prisma.media.count({ where }),
      this.prisma.media.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: {
          uploadedBy: { select: { id: true, displayName: true } },
          pages: { include: { page: { select: { id: true, title: true, slug: true } } } },
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    return {
      data: media.map((item) => this.toApiMedia(item)),
      meta: { total, page: query.page, perPage: query.limit },
    };
  }

  /** Einzelne Datei-Info anhand der ID. */
  async findOne(id: string, actor?: AuthenticatedUser) {
    const media = await this.prisma.media.findUnique({
      where: { id },
      include: {
        uploadedBy: { select: { id: true, displayName: true } },
        pages: { include: { page: { select: { id: true, title: true, slug: true } } } },
      },
    });
    if (!media) {
      throw new NotFoundException(`Medium mit ID "${id}" wurde nicht gefunden.`);
    }
    if (actor && !(await this.isAccessibleTo(id, actor))) {
      throw new NotFoundException(`Medium mit ID "${id}" wurde nicht gefunden.`);
    }
    return this.toApiMedia(media);
  }

  async isAccessibleTo(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<boolean> {
    if (
      this.permissions &&
      !(await this.permissions.isAllowed(actor, "media", "read"))
    ) {
      return false;
    }
    const media = await this.prisma.media.findUnique({
      where: { id },
      select: { id: true, pages: { select: { pageId: true } } },
    });
    if (!media) return false;
    if (!this.resourceAccess || media.pages.length === 0) return true;
    const visible = await this.resourceAccess.allowedTargetIds(actor, {
      resource: "pages",
      action: "read",
      targetType: "page",
      targetIds: media.pages.map((link) => link.pageId),
    });
    return visible.length > 0;
  }

  /** Nur Medien veroeffentlichter, explizit oeffentlicher Seiten sind anonym lesbar. */
  async isPubliclyAccessible(id: string): Promise<boolean> {
    const media = await this.prisma.media.findFirst({
      where: {
        id,
        pages: {
          some: {
            page: {
              isPublic: true,
              status: PageStatus.PUBLISHED,
              type: PageType.PAGE,
              deletedAt: null,
            },
          },
        },
      },
      select: { id: true },
    });
    return media !== null;
  }

  /** Metadaten und sicher aufgeloesten Pfad fuer den Datei-Stream. */
  async fileInfo(id: string) {
    const media = await this.prisma.media.findUnique({ where: { id } });
    if (!media) throw new NotFoundException(`Medium mit ID "${id}" wurde nicht gefunden.`);
    const relativePath = media.filepath.replace(/^uploads[/\\]/, "");
    const absolutePath = join(UPLOAD_DIR, relativePath);
    await access(absolutePath).catch(() => {
      throw new NotFoundException("Die Mediendatei wurde nicht gefunden.");
    });
    const inspected = await inspectMediaFile({ path: absolutePath, originalName: media.filename }).catch(() => {
      throw new NotFoundException("Die Mediendatei hat die Sicherheitsprüfung nicht bestanden.");
    });
    return {
      absolutePath,
      filename: media.filename,
      mimetype: inspected.mimetype,
      size: inspected.size,
    };
  }

  /** Ersetzt die Seitenzuordnungen eines Mediums vollständig. */
  async setPages(
    id: string,
    input: SetMediaPagesInput,
    actor?: AuthenticatedUser,
  ) {
    const media = await this.prisma.media.findUnique({ where: { id }, select: { id: true } });
    if (!media) {
      throw new NotFoundException(`Medium mit ID "${id}" wurde nicht gefunden.`);
    }

    const pageIds = [...new Set(input.pageIds)];
    const existingPages = await this.prisma.page.count({ where: { id: { in: pageIds } } });
    if (existingPages !== pageIds.length) {
      throw new BadRequestException("Mindestens eine ausgewählte Wiki-Seite existiert nicht.");
    }
    if (actor && this.resourceAccess) {
      const currentLinks = await this.prisma.pageMedia.findMany({
        where: { mediaId: id },
        select: { pageId: true },
      });
      const affectedIds = [
        ...new Set([
          ...currentLinks.map((link) => link.pageId),
          ...pageIds,
        ]),
      ];
      const allowedIds = await this.resourceAccess.allowedTargetIds(actor, {
        resource: "pages",
        action: "update",
        targetType: "page",
        targetIds: affectedIds,
      });
      if (allowedIds.length !== affectedIds.length) {
        throw new NotFoundException(
          "Mindestens eine Wiki-Seite wurde nicht gefunden.",
        );
      }
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.pageMedia.deleteMany({ where: { mediaId: id } });
      if (pageIds.length > 0) {
        await transaction.pageMedia.createMany({
          data: pageIds.map((pageId) => ({ mediaId: id, pageId })),
        });
      }
    });
    return this.findOne(id, actor);
  }

  /** Löscht den Datensatz und entfernt die Datei von der Festplatte. */
  async remove(id: string, actor?: AuthenticatedUser) {
    const media = await this.prisma.media.findUnique({
      where: { id },
      include: { pages: { select: { pageId: true } } },
    });
    if (!media) {
      throw new NotFoundException(`Medium mit ID "${id}" wurde nicht gefunden.`);
    }
    if (actor && this.resourceAccess && media.pages.length > 0) {
      const pageIds = media.pages.map((link) => link.pageId);
      const allowedIds = await this.resourceAccess.allowedTargetIds(actor, {
        resource: "pages",
        action: "update",
        targetType: "page",
        targetIds: pageIds,
      });
      if (allowedIds.length !== pageIds.length) {
        throw new NotFoundException(`Medium mit ID "${id}" wurde nicht gefunden.`);
      }
    } else if (actor && !(await this.isAccessibleTo(id, actor))) {
      throw new NotFoundException(`Medium mit ID "${id}" wurde nicht gefunden.`);
    }

    await this.prisma.media.delete({ where: { id } });

    // Datei physisch entfernen; ein fehlendes File soll den Vorgang nicht scheitern lassen.
    const absolutePath = join(UPLOAD_DIR, media.filepath.replace(/^uploads[/\\]/, ""));
    await unlink(absolutePath).catch(() => undefined);

    return { id: media.id, filename: media.filename };
  }

  private async visibleMediaIds(
    actor: AuthenticatedUser,
    media: Array<{ id: string; pages: Array<{ pageId: string }> }>,
  ): Promise<string[]> {
    if (!this.resourceAccess) return media.map((item) => item.id);
    const pageIds = [
      ...new Set(media.flatMap((item) => item.pages.map((link) => link.pageId))),
    ];
    const allowedPageIds = new Set(
      await this.resourceAccess.allowedTargetIds(actor, {
        resource: "pages",
        action: "read",
        targetType: "page",
        targetIds: pageIds,
      }),
    );
    return media
      .filter(
        (item) =>
          item.pages.length === 0 ||
          item.pages.some((link) => allowedPageIds.has(link.pageId)),
      )
      .map((item) => item.id);
  }

  /** Wandelt einen Prisma-Datensatz in das API-Format (ISO-Datum) um. */
  private toApiMedia(media: PrismaMedia & {
    uploadedBy?: { id: string; displayName: string };
    pages?: Array<{ pageId: string; page?: { id: string; title: string; slug: string } }>;
  }) {
    return {
      id: media.id,
      filename: media.filename,
      filepath: media.filepath,
      mimetype: media.mimetype,
      size: media.size,
      altText: media.altText,
      uploadedById: media.uploadedById,
      uploadedBy: media.uploadedBy,
      pageIds: media.pages?.map((page) => page.pageId) ?? [],
      pages: media.pages?.flatMap((entry) => entry.page ? [entry.page] : []) ?? [],
      createdAt: media.createdAt.toISOString(),
    };
  }
}
