import { Injectable, NotFoundException, Optional } from "@nestjs/common";
import { CategoryScope, PageType } from "@prisma/client";
import PDFDocument from "pdfkit";
import { ZipArchive, type ArchiverError } from "archiver";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ExportFormat } from "@ad-wiki/shared-types";
import { PrismaService } from "@/prisma/prisma.service";
import { UPLOAD_DIR } from "@/modules/media/media.config";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { ResourceAccessService } from "@/modules/resource-acls/resource-access.service";

interface ExportPageRecord {
  id: string;
  title: string;
  slug: string;
  type: PageType;
  content: string;
  excerpt: string | null;
  status: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  categoryId: string | null;
  parentId: string | null;
  author: { id: string; displayName: string };
  category: { id: string; name: string; slug: string } | null;
  tags: Array<{ tag: { name: string } }>;
}

interface ExportCategoryRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

interface ExportFile {
  name: string;
  data: Buffer | string;
}

const PAGE_INCLUDE = {
  author: { select: { id: true, displayName: true } },
  category: { select: { id: true, name: true, slug: true } },
  tags: { include: { tag: { select: { name: true } } } },
} as const;

/** Erzeugt die Download-Artefakte für Seiten-, Kategorie- und Gesamt-Exporte. */
@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly access?: ResourceAccessService,
  ) {}

  async exportPageMarkdown(id: string, user?: AuthenticatedUser) {
    const page = await this.findPage(id, user);
    return {
      filename: `${page.slug}.md`,
      mimeType: "text/markdown; charset=utf-8",
      buffer: Buffer.from(this.pageMarkdown(page), "utf8"),
    };
  }

  async exportPagePdf(id: string, user?: AuthenticatedUser) {
    const page = await this.findPage(id, user);
    return {
      filename: `${page.slug}.pdf`,
      mimeType: "application/pdf",
      buffer: await this.pagePdf(page),
    };
  }

  async exportCategoryMarkdown(id: string, user?: AuthenticatedUser) {
    const { category, pages } = await this.findCategoryPages(id, user);
    const files = pages
      .filter((page) => page.type === PageType.PAGE)
      .map((page) => ({
        name: `${this.folderPath(page, pages)}/${page.slug}.md`.replace(/^\//, ""),
        data: this.pageMarkdown(page),
      }));
    return {
      filename: `${category.slug}-markdown.zip`,
      mimeType: "application/zip",
      buffer: await this.zip(files),
    };
  }

  async exportCategoryPdf(id: string, user?: AuthenticatedUser) {
    const { category, pages } = await this.findCategoryPages(id, user);
    const contentPages = pages.filter((page) => page.type === PageType.PAGE);
    return {
      filename: `${category.slug}.pdf`,
      mimeType: "application/pdf",
      buffer: await this.categoryPdf(category, contentPages, pages),
    };
  }

  async exportWiki(format: ExportFormat, user?: AuthenticatedUser) {
    let [pages, notes, standards, media] = await Promise.all([
      this.prisma.page.findMany({
        where: { deletedAt: null },
        include: PAGE_INCLUDE,
        orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }, { title: "asc" }],
      }),
      this.prisma.note.findMany({
        where: { deletedAt: null },
        include: {
          owner: { select: { id: true, displayName: true } },
          category: { select: { id: true, name: true, slug: true } },
          tags: { include: { tag: { select: { name: true } } } },
        },
        orderBy: { updatedAt: "desc" },
      }),
      this.prisma.standard.findMany({
        include: {
          createdBy: { select: { id: true, displayName: true } },
          responsible: { select: { id: true, displayName: true } },
          category: { select: { id: true, name: true, slug: true } },
          rules: { orderBy: { sortOrder: "asc" } },
        },
        orderBy: { updatedAt: "desc" },
      }),
      this.prisma.media.findMany({
        orderBy: { createdAt: "desc" },
        include: { pages: { select: { pageId: true } } },
      }),
    ]);
    if (user && this.access) {
      const [allowedPageIds, allowedNoteIds, allowedStandardIds] =
        await Promise.all([
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
      const allowedPages = new Set(allowedPageIds);
      const allowedNotes = new Set(allowedNoteIds);
      const allowedStandards = new Set(allowedStandardIds);
      pages = pages.filter((page) => allowedPages.has(page.id));
      notes = notes.filter((note) => allowedNotes.has(note.id));
      standards = standards.filter((standard) => allowedStandards.has(standard.id));
      media = media.filter(
        (item) =>
          item.pages.length === 0 ||
          item.pages.some((link) => allowedPages.has(link.pageId)),
      );
    }

    const pageRecords = pages as unknown as ExportPageRecord[];
    const files: ExportFile[] = [];
    for (const page of pageRecords.filter((entry) => entry.type === PageType.PAGE)) {
      const directory = [page.category?.slug ?? "unkategorisiert", this.folderPath(page, pageRecords)]
        .filter(Boolean)
        .join("/");
      if (format === "pdf") {
        files.push({ name: `${directory}/${page.slug}.pdf`, data: await this.pagePdf(page) });
      } else if (format === "html") {
        files.push({ name: `${directory}/${page.slug}.html`, data: this.pageHtml(page) });
      } else {
        files.push({ name: `${directory}/${page.slug}.md`, data: this.pageMarkdown(page) });
      }
    }

    const usedNoteNames = new Set<string>();
    for (const note of notes) {
      const base = uniqueName(this.slugFilename(note.title || "notiz", note.id), usedNoteNames);
      files.push({
        name: `notes/${base}.md`,
        data: this.noteMarkdown({
          title: note.title || "Notiz",
          content: note.content,
          status: note.status.toLowerCase(),
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          owner: note.owner.displayName,
          category: note.category?.name ?? null,
          tags: note.tags.map((entry) => entry.tag.name),
        }),
      });
    }

    for (const standard of standards) {
      files.push({ name: `standards/${standard.slug}.md`, data: this.standardMarkdown(standard) });
    }

    const usedMediaNames = new Set<string>();
    for (const item of media) {
      const source = join(UPLOAD_DIR, item.filepath.replace(/^uploads[/\\]/, ""));
      if (!existsSync(source)) continue;
      const safe = uniqueName(safeFilename(item.filename) || basename(source), usedMediaNames);
      files.push({ name: `media/${safe}`, data: await readFile(source) });
    }

    const metadata = {
      exportedAt: new Date().toISOString(),
      format,
      counts: { pages: pageRecords.filter((page) => page.type === PageType.PAGE).length, notes: notes.length, standards: standards.length, media: media.length },
      pages: pageRecords.map((page) => ({
        id: page.id,
        title: page.title,
        slug: page.slug,
        type: page.type.toLowerCase(),
        parentId: page.parentId,
        category: page.category,
        tags: page.tags.map((entry) => entry.tag.name),
        author: page.author,
        version: page.version,
        status: page.status.toLowerCase(),
        createdAt: page.createdAt.toISOString(),
        updatedAt: page.updatedAt.toISOString(),
      })),
      notes: notes.map((note) => ({ id: note.id, title: note.title, owner: note.owner, status: note.status.toLowerCase(), updatedAt: note.updatedAt.toISOString() })),
      standards: standards.map((standard) => ({ id: standard.id, title: standard.title, slug: standard.slug, version: standard.version, status: standard.status.toLowerCase(), updatedAt: standard.updatedAt.toISOString() })),
      media: media.map((item) => ({ id: item.id, filename: item.filename, mimetype: item.mimetype, size: item.size, createdAt: item.createdAt.toISOString() })),
    };
    files.push({ name: "metadata.json", data: JSON.stringify(metadata, null, 2) });

    const stamp = new Date().toISOString().slice(0, 10);
    return {
      filename: `ad-wiki-${format}-${stamp}.zip`,
      mimeType: "application/zip",
      buffer: await this.zip(files),
      itemCount: files.length,
    };
  }

  /** Markdown mit YAML-Frontmatter; der gespeicherte Inhalt bleibt unverändert. */
  pageMarkdown(page: ExportPageRecord): string {
    const frontmatter = [
      "---",
      `title: ${yamlValue(page.title)}`,
      `author: ${yamlValue(page.author.displayName)}`,
      `created: ${page.createdAt.toISOString().slice(0, 10)}`,
      `updated: ${page.updatedAt.toISOString().slice(0, 10)}`,
      `version: ${page.version}`,
      `category: ${page.category ? yamlValue(page.category.name) : "null"}`,
      `tags: [${page.tags.map((entry) => yamlValue(entry.tag.name)).join(", ")}]`,
      `status: ${page.status.toLowerCase()}`,
      "---",
      "",
    ];
    return `${frontmatter.join("\n")}${page.content.trim()}\n`;
  }

  pageHtml(page: ExportPageRecord): string {
    const body = looksLikeHtml(page.content) ? sanitizeExportHtml(page.content) : markdownToHtml(page.content);
    return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(page.title)} - AD-Wiki</title><style>${HTML_STYLES}</style></head>
<body><main><header><p class="brand">AD-Wiki</p><h1>${escapeHtml(page.title)}</h1>
<dl><div><dt>Autor</dt><dd>${escapeHtml(page.author.displayName)}</dd></div><div><dt>Version</dt><dd>${page.version}</dd></div><div><dt>Kategorie</dt><dd>${escapeHtml(page.category?.name ?? "Ohne Kategorie")}</dd></div><div><dt>Aktualisiert</dt><dd>${formatDate(page.updatedAt)}</dd></div></dl></header>
<article>${body}</article></main><footer>Generiert am ${formatDate(new Date())} - AD-Wiki</footer></body></html>`;
  }

  async pagePdf(page: ExportPageRecord): Promise<Buffer> {
    return this.createPdf((doc) => {
      this.renderPageHeader(doc, page);
      this.renderContent(doc, page.content);
    });
  }

  private async categoryPdf(category: ExportCategoryRecord, pages: ExportPageRecord[], allPages: ExportPageRecord[]) {
    return this.createPdf((doc) => {
      doc.fillColor("#17436b").font("Helvetica-Bold").fontSize(11).text("AD-WIKI");
      doc.moveDown(1).fillColor("#12212f").fontSize(28).text(category.name);
      if (category.description) doc.moveDown(0.5).font("Helvetica").fontSize(11).fillColor("#536474").text(category.description);
      doc.moveDown(2).font("Helvetica-Bold").fontSize(16).fillColor("#12212f").text("Inhaltsverzeichnis");
      doc.moveDown(0.5);
      for (const page of pages) {
        const path = this.folderPath(page, allPages);
        doc.font("Helvetica").fontSize(10).fillColor("#334b5f").text(`${path ? `${path} / ` : ""}${page.title}`, { indent: path ? 12 : 0 });
      }
      for (const page of pages) {
        doc.addPage();
        this.renderPageHeader(doc, page);
        this.renderContent(doc, page.content);
      }
    });
  }

  private renderPageHeader(doc: PDFKit.PDFDocument, page: ExportPageRecord) {
    doc.fillColor("#17436b").font("Helvetica-Bold").fontSize(10).text("AD-WIKI");
    doc.moveDown(0.8).fillColor("#12212f").fontSize(24).text(page.title, { lineGap: 3 });
    doc.moveDown(0.8);
    const metadata = [
      `Autor: ${page.author.displayName}`,
      `Erstellt: ${formatDate(page.createdAt)}`,
      `Aktualisiert: ${formatDate(page.updatedAt)}`,
      `Version: ${page.version}`,
      `Kategorie: ${page.category?.name ?? "Ohne Kategorie"}`,
    ];
    doc.font("Helvetica").fontSize(9).fillColor("#536474").text(metadata.join("   |   "), { lineGap: 3 });
    if (page.tags.length) doc.moveDown(0.4).text(`Tags: ${page.tags.map((entry) => entry.tag.name).join(", ")}`);
    doc.moveDown(0.8).strokeColor("#d7e0e7").lineWidth(1).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
    doc.moveDown(1.2);
  }

  private renderContent(doc: PDFKit.PDFDocument, content: string) {
    const lines = contentToMarkdownLike(content).split(/\r?\n/);
    let inCode = false;
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (/^```/.test(line.trim())) { inCode = !inCode; doc.moveDown(0.25); continue; }
      if (!line.trim()) { doc.moveDown(0.45); continue; }
      if (inCode) {
        doc.font("Courier").fontSize(8.5).fillColor("#253746").text(line, { indent: 10, lineGap: 2 });
        continue;
      }
      const heading = /^(#{1,4})\s+(.+)$/.exec(line);
      if (heading) {
        const size = [20, 16, 13, 11][heading[1].length - 1] ?? 11;
        doc.moveDown(heading[1].length === 1 ? 0.8 : 0.5).font("Helvetica-Bold").fontSize(size).fillColor("#18364f").text(cleanInlineMarkdown(heading[2]), { lineGap: 3 });
        doc.moveDown(0.25);
        continue;
      }
      const task = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line);
      if (task) {
        doc.font("Helvetica").fontSize(10).fillColor("#243746").text(`[${task[1].trim() ? "x" : " "}] ${cleanInlineMarkdown(task[2])}`, { indent: 12, lineGap: 3 });
        continue;
      }
      const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
      if (bullet) {
        doc.font("Helvetica").fontSize(10).fillColor("#243746").text(`- ${cleanInlineMarkdown(bullet[1])}`, { indent: 12, lineGap: 3 });
        continue;
      }
      doc.font("Helvetica").fontSize(10.5).fillColor("#243746").text(cleanInlineMarkdown(line.trim()), { lineGap: 4, paragraphGap: 3 });
    }
  }

  private createPdf(render: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margins: { top: 54, right: 54, bottom: 62, left: 54 }, bufferPages: true, info: { Title: "AD-Wiki Export", Author: "AD-Wiki" } });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("error", reject);
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      render(doc);
      const range = doc.bufferedPageRange();
      for (let index = range.start; index < range.start + range.count; index += 1) {
        doc.switchToPage(index);
        const footer = `Seite ${index + 1} von ${range.count}   |   Generiert am ${formatDate(new Date())} — AD-Wiki`;
        // Innerhalb des druckbaren Bereichs bleiben: PDFKit erzeugt sonst beim
        // Schreiben in den unteren Rand automatisch eine zusätzliche Leerseite.
        const footerY = doc.page.height - doc.page.margins.bottom - 12;
        doc.font("Helvetica").fontSize(8).fillColor("#6b7b88").text(footer, doc.page.margins.left, footerY, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: "center", lineBreak: false });
      }
      doc.end();
    });
  }

  private noteMarkdown(note: { title: string; content: string; status: string; createdAt: Date; updatedAt: Date; owner: string; category: string | null; tags: string[] }) {
    return ["---", `title: ${yamlValue(note.title)}`, `owner: ${yamlValue(note.owner)}`, `created: ${note.createdAt.toISOString().slice(0, 10)}`, `updated: ${note.updatedAt.toISOString().slice(0, 10)}`, `category: ${note.category ? yamlValue(note.category) : "null"}`, `tags: [${note.tags.map(yamlValue).join(", ")}]`, `status: ${note.status}`, "---", "", note.content.trim(), ""].join("\n");
  }

  private standardMarkdown(standard: { title: string; description: string; justification: string; status: string; priority: string; version: number; createdAt: Date; updatedAt: Date; createdBy: { displayName: string }; responsible: { displayName: string }; category: { name: string } | null; rules: Array<{ title: string; description: string | null; type: string }> }) {
    return ["---", `title: ${yamlValue(standard.title)}`, `author: ${yamlValue(standard.createdBy.displayName)}`, `responsible: ${yamlValue(standard.responsible.displayName)}`, `created: ${standard.createdAt.toISOString().slice(0, 10)}`, `updated: ${standard.updatedAt.toISOString().slice(0, 10)}`, `version: ${standard.version}`, `category: ${standard.category ? yamlValue(standard.category.name) : "null"}`, `status: ${standard.status.toLowerCase()}`, `priority: ${standard.priority.toLowerCase()}`, "---", "", `# ${standard.title}`, "", standard.description, "", "## Begründung", "", standard.justification, "", "## Regeln", "", ...standard.rules.flatMap((rule) => [`### ${rule.title}`, "", `Typ: ${rule.type.toLowerCase()}`, "", rule.description ?? "", ""]), ""].join("\n");
  }

  private async findPage(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<ExportPageRecord> {
    const page = await this.prisma.page.findFirst({ where: { id, type: PageType.PAGE, deletedAt: null }, include: PAGE_INCLUDE });
    if (!page) throw new NotFoundException("Seite wurde nicht gefunden.");
    if (user && this.access) {
      await this.access.assertAllowed(user, {
        resource: "pages",
        action: "read",
        targetType: "page",
        targetId: id,
      }, "Seite wurde nicht gefunden.");
    }
    return page as unknown as ExportPageRecord;
  }

  private async findCategoryPages(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<{ category: ExportCategoryRecord; pages: ExportPageRecord[] }> {
    const category = await this.prisma.category.findFirst({ where: { id, scope: CategoryScope.WIKI }, select: { id: true, name: true, slug: true, description: true } });
    if (!category) throw new NotFoundException("Kategorie wurde nicht gefunden.");
    if (user && this.access) {
      await this.access.assertAllowed(user, {
        resource: "categories",
        action: "read",
        targetType: "category",
        targetId: id,
      }, "Kategorie wurde nicht gefunden.");
    }
    let pages = await this.prisma.page.findMany({ where: { categoryId: id, deletedAt: null }, include: PAGE_INCLUDE, orderBy: [{ sortOrder: "asc" }, { title: "asc" }] });
    if (user && this.access) {
      const allowedIds = await this.access.allowedTargetIds(user, {
        resource: "pages",
        action: "read",
        targetType: "page",
        targetIds: pages.map((page) => page.id),
      });
      const allowed = new Set(allowedIds);
      pages = pages.filter((page) => allowed.has(page.id));
    }
    return { category, pages: pages as unknown as ExportPageRecord[] };
  }

  private folderPath(page: ExportPageRecord, pages: ExportPageRecord[]): string {
    const byId = new Map(pages.map((entry) => [entry.id, entry]));
    const segments: string[] = [];
    const visited = new Set<string>();
    let parentId = page.parentId;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent || parent.type !== PageType.FOLDER) break;
      segments.unshift(parent.slug);
      parentId = parent.parentId;
    }
    return segments.join("/");
  }

  private zip(files: ExportFile[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const output: Buffer[] = [];
      const archive = new ZipArchive({ zlib: { level: 9 } });
      archive.on("data", (chunk: Buffer) => output.push(chunk));
      archive.on("warning", (error: ArchiverError) => error.code === "ENOENT" ? undefined : reject(error));
      archive.on("error", reject);
      archive.on("end", () => resolve(Buffer.concat(output)));
      for (const file of files) archive.append(file.data, { name: file.name.replace(/\\/g, "/") });
      void archive.finalize();
    });
  }

  private slugFilename(title: string, id: string) {
    const normalized = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
    return normalized || `eintrag-${id.slice(0, 8)}`;
  }
}

function yamlValue(value: string): string {
  return JSON.stringify(value.replace(/\r?\n/g, " "));
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(value);
}

function looksLikeHtml(content: string) {
  return /<\/?[a-z][\s\S]*>/i.test(content);
}

function contentToMarkdownLike(content: string) {
  if (!looksLikeHtml(content)) return content;
  return content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<li[^>]*data-type=["']taskItem["'][^>]*data-checked=["']true["'][^>]*>/gi, "\n- [x] ")
    .replace(/<li[^>]*data-type=["']taskItem["'][^>]*>/gi, "\n- [ ] ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(br|\/p|\/div|\/li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n");
}

function cleanInlineMarkdown(value: string) {
  return value.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)").replace(/[*_~`]/g, "");
}

function markdownToHtml(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  let listOpen = false;
  const output: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const bullet = /^[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      if (!listOpen) { output.push("<ul>"); listOpen = true; }
      output.push(`<li>${escapeHtml(cleanInlineMarkdown(bullet[1]))}</li>`);
      continue;
    }
    if (listOpen) { output.push("</ul>"); listOpen = false; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) output.push(`<h${heading[1].length}>${escapeHtml(cleanInlineMarkdown(heading[2]))}</h${heading[1].length}>`);
    else if (line) output.push(`<p>${escapeHtml(cleanInlineMarkdown(line))}</p>`);
  }
  if (listOpen) output.push("</ul>");
  return output.join("\n");
}

function sanitizeExportHtml(html: string) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/\son\w+\s*=\s*(["']).*?\1/gi, "");
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeFilename(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\.+$/g, "").slice(0, 150);
}

function uniqueName(value: string, used: Set<string>) {
  if (!used.has(value.toLowerCase())) { used.add(value.toLowerCase()); return value; }
  const dot = value.lastIndexOf(".");
  const base = dot > 0 ? value.slice(0, dot) : value;
  const extension = dot > 0 ? value.slice(dot) : "";
  let index = 2;
  while (used.has(`${base}-${index}${extension}`.toLowerCase())) index += 1;
  const result = `${base}-${index}${extension}`;
  used.add(result.toLowerCase());
  return result;
}

const HTML_STYLES = `
:root{color-scheme:light;font-family:Inter,Segoe UI,Arial,sans-serif;color:#243746;background:#f6f8fa}body{margin:0}main{max-width:900px;margin:40px auto;background:#fff;padding:56px;box-shadow:0 8px 30px #17324d18}header{border-bottom:1px solid #d7e0e7;padding-bottom:24px;margin-bottom:32px}.brand{color:#17436b;font-size:12px;font-weight:700;letter-spacing:.12em}h1{font-size:34px;color:#12212f}h2,h3,h4{color:#18364f;margin-top:1.7em}p,li{line-height:1.7}dl{display:flex;flex-wrap:wrap;gap:12px 24px}dl div{display:flex;gap:6px;font-size:13px}dt{color:#6b7b88}dd{margin:0;font-weight:600}pre,code{font-family:Consolas,monospace;background:#eef3f6;border-radius:5px}pre{padding:16px;overflow:auto}footer{max-width:1012px;margin:0 auto 30px;text-align:center;color:#6b7b88;font-size:12px}@media print{body{background:#fff}main{margin:0;box-shadow:none;max-width:none}}`;
