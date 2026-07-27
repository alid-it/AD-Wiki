import { ForbiddenException, Inject, Injectable, Optional } from "@nestjs/common";
import {
  CategoryScope,
  NoteStatus,
  PageStatus,
  PageType,
  StandardStatus,
} from "@prisma/client";
import type {
  McpCategorySuggestion,
  McpClassificationSuggestion,
  McpClassifyContentInput,
  McpClassifyContentOutput,
  McpSuggestCategoryInput,
  McpSuggestCategoryOutput,
  McpSuggestTagsInput,
  McpSuggestTagsOutput,
  McpTagSuggestion,
} from "@ad-wiki/shared-types";
import type { KnowledgeAccessContext } from "@/modules/knowledge/knowledge-access.service";
import {
  KNOWLEDGE_INTELLIGENCE_PROVIDER,
  type KnowledgeIntelligenceProvider,
} from "@/modules/knowledge/knowledge-intelligence.provider";
import { PrismaService } from "@/prisma/prisma.service";
import { ResourceAccessService } from "@/modules/resource-acls/resource-access.service";

interface TaggedDocument {
  text: string;
  tags: string[];
}

const KIND_SCOPE = {
  wiki: "pages:read",
  note: "notes:read",
  standard: "standards:read",
} as const;
const CATEGORY_SCOPE = {
  wiki: CategoryScope.WIKI,
  note: CategoryScope.NOTE,
  standard: CategoryScope.STANDARD,
} as const;

/** Lokale, nachvollziehbare Heuristiken mit optionaler Provider-Erweiterung. */
@Injectable()
export class KnowledgeIntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(KNOWLEDGE_INTELLIGENCE_PROVIDER)
    private readonly provider?: KnowledgeIntelligenceProvider,
    @Optional() private readonly access?: ResourceAccessService,
  ) {}

  async classify(
    _context: KnowledgeAccessContext,
    input: McpClassifyContentInput,
  ): Promise<McpClassifyContentOutput> {
    const local = this.localClassification(input.title, input.content);
    if (!this.provider) return { result: local, warnings: ["Lokale deterministische Heuristik; keine Inhalte wurden verändert."] };
    try {
      const provided = await this.provider.classify(input.title, input.content);
      return { result: { ...provided, provider: this.provider.name }, warnings: ["Provider-Ergebnisse sind unverbindliche Vorschläge und lösen keine Schreibvorgänge aus."] };
    } catch {
      return { result: local, warnings: [`Provider ${this.provider.name} war nicht verfügbar; lokale Heuristik wurde verwendet.`] };
    }
  }

  async suggestTags(
    context: KnowledgeAccessContext,
    input: McpSuggestTagsInput,
  ): Promise<McpSuggestTagsOutput> {
    this.requireScope(context, KIND_SCOPE[input.type]);
    const documents = await this.taggedDocuments(context, input.type);
    const local = this.rankTags(input.title, input.content, documents, input.limit);
    if (!this.provider) return { results: local, warnings: documents.length === 0 ? ["Keine sichtbaren Vergleichsinhalte mit Tags gefunden."] : [] };
    try {
      const external = await this.provider.suggestTags(input.title, input.content);
      return { results: this.mergeTagSuggestions(local, external, input.limit), warnings: ["Provider-Vorschläge wurden nur mit existierenden sichtbaren Tags zusammengeführt."] };
    } catch {
      return { results: local, warnings: [`Provider ${this.provider.name} war nicht verfügbar; lokale Vorschläge wurden verwendet.`] };
    }
  }

  async suggestCategory(
    context: KnowledgeAccessContext,
    input: McpSuggestCategoryInput,
  ): Promise<McpSuggestCategoryOutput> {
    this.requireScope(context, "categories:read");
    const categories = await this.categoryCandidates(context, input.type);
    const queryTokens = this.tokens(`${input.title ?? ""} ${input.content}`);
    const results = categories.map((category) => {
      const labelScore = this.similarity(queryTokens, this.tokens(`${category.name} ${category.description ?? ""}`));
      const contentScore = Math.max(0, ...category.samples.map((sample) => this.similarity(queryTokens, this.tokens(sample))));
      const score = Math.min(1, labelScore * 0.65 + contentScore * 0.35);
      return {
        id: category.id,
        name: category.name,
        slug: category.slug,
        score: Number(score.toFixed(4)),
        reason: contentScore > labelScore
          ? "Ähnliche sichtbare Inhalte sind dieser Kategorie zugeordnet."
          : "Name oder Beschreibung der Kategorie passen zum Inhalt.",
      } satisfies McpCategorySuggestion;
    }).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "de"));
    const local = results.slice(0, input.limit);
    if (!this.provider) return { results: local, warnings: local.every((item) => item.score === 0) ? ["Keine inhaltlich starke Kategorieübereinstimmung gefunden."] : [] };
    try {
      const external = await this.provider.suggestCategory(input.title, input.content);
      const visible = new Map(local.concat(results).map((item) => [item.id, item]));
      for (const suggestion of external) {
        const existing = visible.get(suggestion.id);
        if (existing) visible.set(suggestion.id, { ...existing, score: Math.max(existing.score, Math.min(1, suggestion.score)), reason: `${existing.reason} Provider: ${suggestion.reason}` });
      }
      return { results: [...visible.values()].sort((a, b) => b.score - a.score).slice(0, input.limit), warnings: ["Provider-Vorschläge wurden auf sichtbare Kategorien des gewählten Wissenstyps begrenzt."] };
    } catch {
      return { results: local, warnings: [`Provider ${this.provider.name} war nicht verfügbar; lokale Vorschläge wurden verwendet.`] };
    }
  }

  private localClassification(title: string | undefined, content: string): McpClassificationSuggestion {
    const text = `${title ?? ""}\n${content}`;
    const normalized = text.toLocaleLowerCase("de-DE");
    const scores = {
      standard: this.keywordScore(normalized, ["muss", "darf nicht", "verbindlich", "richtlinie", "standard", "mindestens", "zulässig"]),
      wiki: this.keywordScore(normalized, ["## ", "### ", "erklärung", "anleitung", "beispiel", "grundlagen", "konfiguration", "siehe"]),
      note: this.keywordScore(normalized, ["todo", "offen", "notiz", "idee", "später", "prüfen", "merken", "?"]),
    };
    if (content.length < 220) scores.note += 2;
    if ((content.match(/^#{1,3}\s/gm) ?? []).length >= 2) scores.wiki += 2;
    if ((content.match(/\b(muss|darf nicht|ist verpflichtend)\b/gi) ?? []).length >= 2) scores.standard += 2;
    const ordered = Object.entries(scores).sort((a, b) => b[1] - a[1]) as Array<["standard" | "wiki" | "note", number]>;
    const best = ordered[0] ?? ["note", 0];
    const second = ordered[1]?.[1] ?? 0;
    const confidence = Math.min(0.95, Math.max(0.4, 0.5 + (best[1] - second) * 0.08));
    const quality = Math.min(1, 0.2 + Math.min(content.length / 3000, 0.45) + (title ? 0.15 : 0) + (/^#{1,3}\s/m.test(content) ? 0.15 : 0) + (/https?:\/\//.test(content) ? 0.05 : 0));
    const maturity = Math.min(1, 0.15 + (content.length >= 500 ? 0.25 : 0) + (content.length >= 1500 ? 0.2 : 0) + (/\b(beispiel|voraussetzung|entscheidung|begründung)\b/i.test(content) ? 0.2 : 0) + (best[0] !== "note" ? 0.1 : 0));
    const sensitivity = /\b(passwort|kennwort|private key|client secret|zugangsdaten|token)\b/i.test(text)
      ? "high"
      : /\b(intern|vertraulich|personenbezogen|ip-adresse|hostname)\b/i.test(text)
        ? "medium"
        : "low";
    return {
      suggestedType: best[0],
      confidence: Number(confidence.toFixed(2)),
      reason: `Lokale Signale: standard=${scores.standard}, wiki=${scores.wiki}, note=${scores.note}.`,
      qualityScore: Number(quality.toFixed(2)),
      maturityScore: Number(maturity.toFixed(2)),
      sensitivity,
      provider: "local-heuristics-v1",
    };
  }

  private async taggedDocuments(context: KnowledgeAccessContext, kind: "wiki" | "note" | "standard"): Promise<TaggedDocument[]> {
    if (!this.access) return this.taggedDocumentsLegacy(context, kind);
    if (kind === "wiki") {
      const base = { type: PageType.PAGE, status: PageStatus.PUBLISHED, mcpVisible: true, deletedAt: null } as const;
      const candidates = await this.prisma.page.findMany({ where: base, select: { id: true } });
      const allowedIds = await this.aclIds(context, "pages", "page", candidates.map((row) => row.id));
      const rows = await this.prisma.page.findMany({ where: { ...base, id: { in: allowedIds } }, take: 200, orderBy: { updatedAt: "desc" }, select: { title: true, content: true, tags: { select: { tag: { select: { name: true } } } } } });
      return rows.map((row) => ({ text: `${row.title} ${row.content}`, tags: row.tags.map((entry) => entry.tag.name) }));
    }
    if (kind === "note") {
      const base = { status: { not: NoteStatus.ARCHIVED }, mcpVisible: true, deletedAt: null, OR: [{ spaceId: null, OR: [{ ownerId: context.userId }, { shares: { some: { userId: context.userId } } }] }, { spaceId: { not: null } }] };
      const candidates = await this.prisma.note.findMany({ where: base, select: { id: true } });
      const allowedIds = await this.aclIds(context, "notes", "note", candidates.map((row) => row.id));
      const rows = await this.prisma.note.findMany({ where: { AND: [base, { id: { in: allowedIds } }] }, take: 200, orderBy: { updatedAt: "desc" }, select: { title: true, content: true, tags: { select: { tag: { select: { name: true } } } } } });
      return rows.map((row) => ({ text: `${row.title ?? ""} ${row.content}`, tags: row.tags.map((entry) => entry.tag.name) }));
    }
    const now = new Date();
    const base = { status: StandardStatus.ACTIVE, mcpVisible: true, AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: now } }] }, { OR: [{ validUntil: null }, { validUntil: { gte: now } }] }] };
    const candidates = await this.prisma.standard.findMany({ where: base, select: { id: true } });
    const allowedIds = await this.aclIds(context, "standards", "standard", candidates.map((row) => row.id));
    const rows = await this.prisma.standard.findMany({ where: { AND: [base, { id: { in: allowedIds } }] }, take: 200, orderBy: { updatedAt: "desc" }, select: { title: true, description: true, pages: { select: { page: { select: { tags: { select: { tag: { select: { name: true } } } } } } } } } });
    return rows.map((row) => ({ text: `${row.title} ${row.description}`, tags: [...new Set(row.pages.flatMap((link) => link.page.tags.map((entry) => entry.tag.name)))] }));
  }

  private rankTags(title: string | undefined, content: string, documents: TaggedDocument[], limit: number): McpTagSuggestion[] {
    const query = this.tokens(`${title ?? ""} ${content}`);
    const normalizedText = `${title ?? ""} ${content}`.toLocaleLowerCase("de-DE");
    const scores = new Map<string, { name: string; score: number; direct: boolean; matches: number }>();
    for (const document of documents) {
      const similarity = this.similarity(query, this.tokens(document.text));
      for (const tag of document.tags) {
        const key = tag.toLocaleLowerCase("de-DE");
        const direct = normalizedText.includes(key);
        const current = scores.get(key) ?? { name: tag, score: 0, direct: false, matches: 0 };
        current.score += similarity + (direct ? 1 : 0);
        current.direct ||= direct;
        current.matches += 1;
        scores.set(key, current);
      }
    }
    const maximum = Math.max(1, ...[...scores.values()].map((item) => item.score));
    return [...scores.values()].map((item) => ({
      name: item.name,
      score: Number(Math.min(1, item.score / maximum).toFixed(4)),
      reason: item.direct ? "Der vorhandene Tag kommt direkt im Inhalt vor." : `Tag aus ${item.matches} ähnlichen sichtbaren Inhalten.`,
    })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "de")).slice(0, limit);
  }

  private async categoryCandidates(context: KnowledgeAccessContext, kind: "wiki" | "note" | "standard") {
    if (!this.access) return this.categoryCandidatesLegacy(context, kind);
    const canRead = context.scopes.includes(KIND_SCOPE[kind]);
    const categoryCandidates = await this.prisma.category.findMany({
      where: { scope: CATEGORY_SCOPE[kind] },
      select: { id: true },
    });
    const categoryIds = await this.aclIds(
      context,
      "categories",
      "category",
      categoryCandidates.map((category) => category.id),
    );
    const common = { where: { scope: CATEGORY_SCOPE[kind], id: { in: categoryIds } }, orderBy: { sortOrder: "asc" as const }, take: 100 };
    if (kind === "wiki") {
      const candidates = canRead ? await this.prisma.page.findMany({ where: { type: PageType.PAGE, status: PageStatus.PUBLISHED, mcpVisible: true, deletedAt: null }, select: { id: true } }) : [];
      const ids = await this.aclIds(context, "pages", "page", candidates.map((row) => row.id));
      const rows = await this.prisma.category.findMany({ ...common, select: { id: true, name: true, slug: true, description: true, pages: { where: canRead ? { id: { in: ids }, type: PageType.PAGE, status: PageStatus.PUBLISHED, mcpVisible: true, deletedAt: null } : { id: "__no_access__" }, take: 20, select: { title: true, content: true } } } });
      return rows.map((row) => ({ ...row, samples: row.pages.map((page) => `${page.title} ${page.content}`) }));
    }
    if (kind === "note") {
      const noteBase = { status: { not: NoteStatus.ARCHIVED }, mcpVisible: true, deletedAt: null, OR: [{ spaceId: null, OR: [{ ownerId: context.userId }, { shares: { some: { userId: context.userId } } }] }, { spaceId: { not: null } }] };
      const candidates = canRead ? await this.prisma.note.findMany({ where: noteBase, select: { id: true } }) : [];
      const ids = await this.aclIds(context, "notes", "note", candidates.map((row) => row.id));
      const rows = await this.prisma.category.findMany({ ...common, select: { id: true, name: true, slug: true, description: true, notes: { where: canRead ? { AND: [noteBase, { id: { in: ids } }] } : { id: "__no_access__" }, take: 20, select: { title: true, content: true } } } });
      return rows.map((row) => ({ ...row, samples: row.notes.map((note) => `${note.title ?? ""} ${note.content}`) }));
    }
    const now = new Date();
    const standardBase = { status: StandardStatus.ACTIVE, mcpVisible: true, AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: now } }] }, { OR: [{ validUntil: null }, { validUntil: { gte: now } }] }] };
    const candidates = canRead ? await this.prisma.standard.findMany({ where: standardBase, select: { id: true } }) : [];
    const ids = await this.aclIds(context, "standards", "standard", candidates.map((row) => row.id));
    const rows = await this.prisma.category.findMany({ ...common, select: { id: true, name: true, slug: true, description: true, standards: { where: canRead ? { AND: [standardBase, { id: { in: ids } }] } : { id: "__no_access__" }, take: 20, select: { title: true, description: true } } } });
    return rows.map((row) => ({ ...row, samples: row.standards.map((standard) => `${standard.title} ${standard.description}`) }));
  }

  private mergeTagSuggestions(local: McpTagSuggestion[], external: McpTagSuggestion[], limit: number): McpTagSuggestion[] {
    const byName = new Map(local.map((item) => [item.name.toLocaleLowerCase("de-DE"), item]));
    for (const suggestion of external) {
      const key = suggestion.name.toLocaleLowerCase("de-DE");
      const existing = byName.get(key);
      if (existing) byName.set(key, { ...existing, score: Math.max(existing.score, Math.min(1, suggestion.score)), reason: `${existing.reason} Provider: ${suggestion.reason}` });
    }
    return [...byName.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private async taggedDocumentsLegacy(
    context: KnowledgeAccessContext,
    kind: "wiki" | "note" | "standard",
  ): Promise<TaggedDocument[]> {
    if (kind === "wiki") {
      const rows = await this.prisma.page.findMany({ where: { type: PageType.PAGE, status: PageStatus.PUBLISHED, mcpVisible: true, deletedAt: null }, take: 200, orderBy: { updatedAt: "desc" }, select: { title: true, content: true, tags: { select: { tag: { select: { name: true } } } } } });
      return rows.map((row) => ({ text: `${row.title} ${row.content}`, tags: row.tags.map((entry) => entry.tag.name) }));
    }
    if (kind === "note") {
      const rows = await this.prisma.note.findMany({ where: { status: { not: NoteStatus.ARCHIVED }, mcpVisible: true, deletedAt: null, OR: [{ ownerId: context.userId }, { shares: { some: { userId: context.userId } } }] }, take: 200, orderBy: { updatedAt: "desc" }, select: { title: true, content: true, tags: { select: { tag: { select: { name: true } } } } } });
      return rows.map((row) => ({ text: `${row.title ?? ""} ${row.content}`, tags: row.tags.map((entry) => entry.tag.name) }));
    }
    const now = new Date();
    const rows = await this.prisma.standard.findMany({ where: { status: StandardStatus.ACTIVE, mcpVisible: true, AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: now } }] }, { OR: [{ validUntil: null }, { validUntil: { gte: now } }] }] }, take: 200, orderBy: { updatedAt: "desc" }, select: { title: true, description: true, pages: { select: { page: { select: { tags: { select: { tag: { select: { name: true } } } } } } } } } });
    return rows.map((row) => ({ text: `${row.title} ${row.description}`, tags: [...new Set(row.pages.flatMap((link) => link.page.tags.map((entry) => entry.tag.name)))] }));
  }

  private async categoryCandidatesLegacy(
    context: KnowledgeAccessContext,
    kind: "wiki" | "note" | "standard",
  ) {
    const canRead = context.scopes.includes(KIND_SCOPE[kind]);
    const common = { where: { scope: CATEGORY_SCOPE[kind] }, orderBy: { sortOrder: "asc" as const }, take: 100 };
    if (kind === "wiki") {
      const rows = await this.prisma.category.findMany({ ...common, select: { id: true, name: true, slug: true, description: true, pages: { where: canRead ? { type: PageType.PAGE, status: PageStatus.PUBLISHED, mcpVisible: true, deletedAt: null } : { id: "__no_access__" }, take: 20, select: { title: true, content: true } } } });
      return rows.map((row) => ({ ...row, samples: row.pages.map((page) => `${page.title} ${page.content}`) }));
    }
    if (kind === "note") {
      const rows = await this.prisma.category.findMany({ ...common, select: { id: true, name: true, slug: true, description: true, notes: { where: canRead ? { status: { not: NoteStatus.ARCHIVED }, mcpVisible: true, deletedAt: null, OR: [{ ownerId: context.userId }, { shares: { some: { userId: context.userId } } }] } : { id: "__no_access__" }, take: 20, select: { title: true, content: true } } } });
      return rows.map((row) => ({ ...row, samples: row.notes.map((note) => `${note.title ?? ""} ${note.content}`) }));
    }
    const now = new Date();
    const rows = await this.prisma.category.findMany({ ...common, select: { id: true, name: true, slug: true, description: true, standards: { where: canRead ? { status: StandardStatus.ACTIVE, mcpVisible: true, AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: now } }] }, { OR: [{ validUntil: null }, { validUntil: { gte: now } }] }] } : { id: "__no_access__" }, take: 20, select: { title: true, description: true } } } });
    return rows.map((row) => ({ ...row, samples: row.standards.map((standard) => `${standard.title} ${standard.description}`) }));
  }

  private keywordScore(text: string, keywords: string[]): number {
    return keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0);
  }

  private tokens(text: string): Set<string> {
    return new Set(text.toLocaleLowerCase("de-DE").normalize("NFKD").split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3).slice(0, 2000));
  }

  private similarity(left: Set<string>, right: Set<string>): number {
    if (left.size === 0 || right.size === 0) return 0;
    let intersection = 0;
    for (const token of left) if (right.has(token)) intersection += 1;
    return intersection / new Set([...left, ...right]).size;
  }

  private requireScope(context: KnowledgeAccessContext, scope: string): void {
    if (!context.scopes.includes(scope)) throw new ForbiddenException("Für diese Wissensvorschläge fehlt die Leseberechtigung.");
  }

  private async aclIds(
    context: KnowledgeAccessContext,
    resource: "pages" | "notes" | "standards" | "categories",
    targetType: "page" | "note" | "standard" | "category",
    targetIds: string[],
  ): Promise<string[]> {
    if (!this.access) return targetIds;
    if (!context.actor) return [];
    return this.access.allowedTargetIds(context.actor, {
      resource,
      action: "read",
      targetType,
      targetIds,
    });
  }
}
