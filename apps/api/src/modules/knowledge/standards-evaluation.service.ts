import { ForbiddenException, Injectable, Optional } from "@nestjs/common";
import {
  NoteStatus,
  PageStatus,
  PageType,
  Prisma,
  StandardRuleType,
  StandardStatus,
} from "@prisma/client";
import type {
  McpDetectConflictsInput,
  McpDetectConflictsOutput,
  McpEvaluateStandardsInput,
  McpEvaluateStandardsOutput,
  McpKnowledgeConflict,
  McpKnowledgeSource,
  McpStandardCheck,
} from "@ad-wiki/shared-types";
import type { KnowledgeAccessContext } from "@/modules/knowledge/knowledge-access.service";
import { PrismaService } from "@/prisma/prisma.service";
import { ResourceAccessService } from "@/modules/resource-acls/resource-access.service";

const evaluationSelect = Prisma.validator<Prisma.StandardSelect>()({
  id: true,
  title: true,
  status: true,
  version: true,
  updatedAt: true,
  categoryId: true,
  rules: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      title: true,
      type: true,
      minVcpu: true,
      minRamMb: true,
      backupRequired: true,
      allowedPorts: true,
      allowedNetworks: true,
      namingConvention: true,
    },
  },
});
type EvaluationStandard = Prisma.StandardGetPayload<{ select: typeof evaluationSelect }>;
type EvaluationRule = EvaluationStandard["rules"][number];

const RULE_TYPE = {
  MUST: "must",
  SHOULD: "should",
  MAY: "may",
  MUST_NOT: "must_not",
} as const;

interface ConstraintResult {
  result: "pass" | "fail" | "unknown";
  expected: string;
  actual: string | null;
  reason: string;
}

interface KnowledgeClaim {
  field: "ramMb" | "vcpus" | "backup";
  value: number | boolean;
  source: McpKnowledgeSource;
}

/** Deterministische Auswertung ausschließlich aktiver, sichtbarer Regeln. */
@Injectable()
export class StandardsEvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly access?: ResourceAccessService,
  ) {}

  async evaluate(
    context: KnowledgeAccessContext,
    input: McpEvaluateStandardsInput,
  ): Promise<McpEvaluateStandardsOutput> {
    const standards = await this.visibleStandards(context, {
      standardIds: input.standardIds,
      categoryId: input.target.categoryId,
    });
    const checks = standards.flatMap((standard) => standard.rules.map((rule) =>
      this.evaluateRule(standard.id, rule, input),
    ));
    const relevant = checks.filter((check) => check.result !== "not_applicable");
    const mandatory = relevant.filter((check) =>
      check.type === "must" || check.type === "must_not",
    );
    const result = mandatory.some((check) => check.result === "fail")
      ? "non_compliant"
      : mandatory.length === 0 || mandatory.some((check) => check.result === "unknown")
        ? "unknown"
        : "compliant";
    const conflicts = this.detectStandardConflicts(standards);
    const warnings = [
      ...(standards.length === 0
        ? ["Keine sichtbare, aktive und aktuell gültige Richtlinie passt zur Auswahl."]
        : []),
      ...(checks.some((check) => check.result === "unknown")
        ? ["Nicht strukturierte Regeln oder fehlende Ist-Werte werden bewusst als unknown ausgewiesen."]
        : []),
      ...(conflicts.some((conflict) => conflict.severity === "critical")
        ? ["Zwischen aktiven Richtlinien bestehen kritische strukturierte Konflikte; eine menschliche Prüfung ist erforderlich."]
        : []),
    ];
    return {
      result,
      checks,
      unknownChecks: checks.filter((check) => check.result === "unknown"),
      sources: standards.map((standard) => this.source(standard)),
      conflicts,
      warnings,
    };
  }

  async detectConflicts(
    context: KnowledgeAccessContext,
    input: McpDetectConflictsInput,
  ): Promise<McpDetectConflictsOutput> {
    const standards = await this.visibleStandards(context, input);
    const documentClaims = await this.visibleDocumentClaims(context);
    const structuredConflicts = this.detectStandardConflicts(standards);
    const crossSourceConflicts = this.detectCrossSourceConflicts(standards, documentClaims);
    const conflicts = [...structuredConflicts, ...crossSourceConflicts].slice(0, 100);
    const usedSourceIds = new Set(conflicts.flatMap((conflict) => conflict.sourceIds ?? []));
    const documentSources = [...new Map(documentClaims
      .filter((claim) => usedSourceIds.has(claim.source.id))
      .map((claim) => [claim.source.id, claim.source])).values()];
    return {
      conflicts,
      sources: [
        ...standards.map((standard) => this.source(standard)),
        ...documentSources,
      ],
      warnings: standards.length < 2
        ? ["Weniger als zwei sichtbare aktive Richtlinien; der Vergleich mit sichtbaren Wiki-Seiten und Notizen wurde dennoch durchgeführt."]
        : ["Die Erkennung meldet nur strukturierte Widersprüche oder klar normative RAM-, vCPU- und Backup-Aussagen."],
    };
  }

  private async visibleDocumentClaims(context: KnowledgeAccessContext): Promise<KnowledgeClaim[]> {
    if (!this.access) return this.visibleDocumentClaimsLegacy(context);
    const claims: KnowledgeClaim[] = [];
    if (context.scopes.includes("pages:read")) {
      const pageWhere = { type: PageType.PAGE, status: PageStatus.PUBLISHED, mcpVisible: true, deletedAt: null } as const;
      const candidates = await this.prisma.page.findMany({
        where: pageWhere,
        select: { id: true },
      });
      const allowedIds = await this.aclIds(
        context,
        "pages",
        "page",
        candidates.map((page) => page.id),
      );
      const pages = await this.prisma.page.findMany({
        where: { ...pageWhere, id: { in: allowedIds } },
        orderBy: { updatedAt: "desc" },
        take: 200,
        select: { id: true, title: true, slug: true, status: true, version: true, updatedAt: true, content: true },
      });
      for (const page of pages) {
        claims.push(...this.extractClaims(page.content, {
          id: page.id, type: "wiki", title: page.title, status: page.status.toLowerCase(),
          knowledgePriority: 2, version: page.version, updatedAt: page.updatedAt.toISOString(),
          uri: `ad-wiki://wiki/${page.slug}`,
        }));
      }
    }
    if (context.scopes.includes("notes:read")) {
      const noteWhere = {
        status: { not: NoteStatus.ARCHIVED },
        mcpVisible: true,
        deletedAt: null,
        OR: [
          {
            spaceId: null,
            OR: [
              { ownerId: context.userId },
              { shares: { some: { userId: context.userId } } },
            ],
          },
          { spaceId: { not: null } },
        ],
      };
      const candidates = await this.prisma.note.findMany({
        where: noteWhere,
        select: { id: true },
      });
      const allowedIds = await this.aclIds(
        context,
        "notes",
        "note",
        candidates.map((note) => note.id),
      );
      const notes = await this.prisma.note.findMany({
        where: {
          AND: [noteWhere, { id: { in: allowedIds } }],
        },
        orderBy: { updatedAt: "desc" },
        take: 200,
        select: { id: true, title: true, content: true, status: true, updatedAt: true },
      });
      for (const note of notes) {
        claims.push(...this.extractClaims(note.content, {
          id: note.id, type: "note", title: note.title?.trim() || "Notiz",
          status: note.status.toLowerCase(), knowledgePriority: 3, version: null,
          updatedAt: note.updatedAt.toISOString(), uri: `ad-wiki://notes/${note.id}`,
        }));
      }
    }
    return claims;
  }

  private async visibleStandards(
    context: KnowledgeAccessContext,
    filter: { standardIds?: string[]; categoryId?: string },
    now = new Date(),
  ): Promise<EvaluationStandard[]> {
    this.requireScope(context, "standards:read");
    const where: Prisma.StandardWhereInput = {
        status: StandardStatus.ACTIVE,
        mcpVisible: true,
        ...(filter.standardIds ? { id: { in: filter.standardIds } } : {}),
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
        ],
      };
    if (!this.access) {
      return this.prisma.standard.findMany({
        where,
        orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
        take: 50,
        select: evaluationSelect,
      });
    }
    const candidates = await this.prisma.standard.findMany({
      where,
      select: { id: true },
    });
    const allowedIds = await this.aclIds(
      context,
      "standards",
      "standard",
      candidates.map((standard) => standard.id),
    );
    return this.prisma.standard.findMany({
      where: { AND: [where, { id: { in: allowedIds } }] },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      take: 50,
      select: evaluationSelect,
    });
  }

  private async aclIds(
    context: KnowledgeAccessContext,
    resource: "pages" | "notes" | "standards",
    targetType: "page" | "note" | "standard",
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

  private async visibleDocumentClaimsLegacy(
    context: KnowledgeAccessContext,
  ): Promise<KnowledgeClaim[]> {
    const claims: KnowledgeClaim[] = [];
    if (context.scopes.includes("pages:read")) {
      const pages = await this.prisma.page.findMany({
        where: { type: PageType.PAGE, status: PageStatus.PUBLISHED, mcpVisible: true, deletedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 200,
        select: { id: true, title: true, slug: true, status: true, version: true, updatedAt: true, content: true },
      });
      for (const page of pages) {
        claims.push(...this.extractClaims(page.content, {
          id: page.id, type: "wiki", title: page.title, status: page.status.toLowerCase(),
          knowledgePriority: 2, version: page.version, updatedAt: page.updatedAt.toISOString(),
          uri: `ad-wiki://wiki/${page.slug}`,
        }));
      }
    }
    if (context.scopes.includes("notes:read")) {
      const notes = await this.prisma.note.findMany({
        where: {
          status: { not: NoteStatus.ARCHIVED }, mcpVisible: true, deletedAt: null,
          OR: [{ ownerId: context.userId }, { shares: { some: { userId: context.userId } } }],
        },
        orderBy: { updatedAt: "desc" },
        take: 200,
        select: { id: true, title: true, content: true, status: true, updatedAt: true },
      });
      for (const note of notes) {
        claims.push(...this.extractClaims(note.content, {
          id: note.id, type: "note", title: note.title?.trim() || "Notiz",
          status: note.status.toLowerCase(), knowledgePriority: 3, version: null,
          updatedAt: note.updatedAt.toISOString(), uri: `ad-wiki://notes/${note.id}`,
        }));
      }
    }
    return claims;
  }

  private evaluateRule(
    standardId: string,
    rule: EvaluationRule,
    input: McpEvaluateStandardsInput,
  ): McpStandardCheck {
    const type = RULE_TYPE[rule.type];
    if (type === "should" && !input.includeShould) {
      return {
        standardId, ruleId: rule.id, rule: rule.title, type,
        result: "not_applicable", expected: null, actual: null,
        reason: "SHOULD-Regeln wurden für diese Auswertung abgewählt.",
      };
    }
    const target = input.target;
    const constraints: ConstraintResult[] = [];
    if (rule.minVcpu !== null) {
      constraints.push(this.minimum("vCPU", rule.minVcpu, target.vcpus, rule.type));
    }
    if (rule.minRamMb !== null) {
      constraints.push(this.minimum("RAM (MB)", rule.minRamMb, target.ramMb, rule.type));
    }
    if (rule.backupRequired !== null) {
      constraints.push(this.booleanConstraint("Backup", rule.backupRequired, target.backupEnabled, rule.type));
    }
    const allowedPorts = this.numberArray(rule.allowedPorts);
    if (allowedPorts.length > 0) {
      constraints.push(this.listConstraint("Ports", allowedPorts.map(String), target.ports.map(String), rule.type));
    }
    const allowedNetworks = this.stringArray(rule.allowedNetworks);
    if (allowedNetworks.length > 0) {
      constraints.push(this.listConstraint("Netze", allowedNetworks, target.networks, rule.type));
    }
    if (rule.namingConvention) {
      constraints.push(this.namingConstraint(rule.namingConvention, target.name, rule.type));
    }
    if (constraints.length === 0) {
      return {
        standardId, ruleId: rule.id, rule: rule.title, type,
        result: "unknown", expected: null, actual: null,
        reason: "Die Regel enthält keine deterministisch auswertbaren strukturierten Felder.",
      };
    }
    const result = constraints.some((item) => item.result === "fail")
      ? "fail"
      : constraints.some((item) => item.result === "unknown")
        ? "unknown"
        : "pass";
    return {
      standardId,
      ruleId: rule.id,
      rule: rule.title,
      type,
      result,
      expected: constraints.map((item) => item.expected).join("; "),
      actual: constraints.map((item) => item.actual ?? "nicht angegeben").join("; "),
      reason: constraints.map((item) => item.reason).join(" "),
    };
  }

  private minimum(label: string, expected: number, actual: number | undefined, type: StandardRuleType): ConstraintResult {
    if (actual === undefined) return { result: "unknown", expected: `${label} mindestens ${expected}`, actual: null, reason: `${label} wurde nicht angegeben.` };
    const passes = type === StandardRuleType.MUST_NOT ? actual < expected : actual >= expected;
    return {
      result: passes ? "pass" : "fail",
      expected: type === StandardRuleType.MUST_NOT ? `${label} unter ${expected}` : `${label} mindestens ${expected}`,
      actual: `${label} ${actual}`,
      reason: passes ? `${label} erfüllt die strukturierte Regel.` : `${label} verletzt die strukturierte Regel.`,
    };
  }

  private booleanConstraint(label: string, expected: boolean, actual: boolean | undefined, type: StandardRuleType): ConstraintResult {
    if (actual === undefined) return { result: "unknown", expected: `${label} = ${expected}`, actual: null, reason: `${label} wurde nicht angegeben.` };
    const passes = type === StandardRuleType.MUST_NOT ? actual !== expected : actual === expected;
    return { result: passes ? "pass" : "fail", expected: `${label} ${type === StandardRuleType.MUST_NOT ? "nicht " : ""}${expected}`, actual: `${label} ${actual}`, reason: passes ? `${label} erfüllt die Regel.` : `${label} verletzt die Regel.` };
  }

  private listConstraint(label: string, expected: string[], actual: string[], type: StandardRuleType): ConstraintResult {
    const normalized = new Set(expected.map((value) => value.toLocaleLowerCase("de-DE")));
    const matches = actual.filter((value) => normalized.has(value.toLocaleLowerCase("de-DE")));
    const passes = type === StandardRuleType.MUST_NOT
      ? matches.length === 0
      : actual.every((value) => normalized.has(value.toLocaleLowerCase("de-DE")));
    return { result: passes ? "pass" : "fail", expected: `${label} ${type === StandardRuleType.MUST_NOT ? "verboten" : "erlaubt"}: ${expected.join(", ")}`, actual: `${label}: ${actual.join(", ") || "keine"}`, reason: passes ? `${label} erfüllen die Regel.` : `${label} enthalten unzulässige Werte.` };
  }

  private namingConstraint(pattern: string, actual: string | undefined, type: StandardRuleType): ConstraintResult {
    if (!actual) return { result: "unknown", expected: `Name gemäß /${pattern}/`, actual: null, reason: "Ein Name wurde nicht angegeben." };
    try {
      const matches = new RegExp(pattern, "u").test(actual);
      const passes = type === StandardRuleType.MUST_NOT ? !matches : matches;
      return { result: passes ? "pass" : "fail", expected: `${type === StandardRuleType.MUST_NOT ? "nicht " : ""}/${pattern}/`, actual, reason: passes ? "Der Name erfüllt die Konvention." : "Der Name verletzt die Konvention." };
    } catch {
      return { result: "unknown", expected: `/${pattern}/`, actual, reason: "Die gespeicherte Namenskonvention ist kein gültiger regulärer Ausdruck." };
    }
  }

  private detectStandardConflicts(standards: EvaluationStandard[]): McpKnowledgeConflict[] {
    const conflicts: McpKnowledgeConflict[] = [];
    for (let leftIndex = 0; leftIndex < standards.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < standards.length; rightIndex += 1) {
        const left = standards[leftIndex];
        const right = standards[rightIndex];
        if (!left || !right) continue;
        for (const leftRule of left.rules) {
          for (const rightRule of right.rules) {
            const reason = this.ruleConflict(leftRule, rightRule);
            if (!reason) continue;
            conflicts.push({
              topic: `${leftRule.title} ↔ ${rightRule.title}`,
              higherPrioritySourceId: null,
              lowerPrioritySourceId: null,
              sourceIds: [left.id, right.id],
              severity: "critical",
              reason: `${left.title} und ${right.title}: ${reason}`,
            });
          }
        }
      }
    }
    return conflicts.slice(0, 100);
  }

  private detectCrossSourceConflicts(
    standards: EvaluationStandard[],
    documentClaims: KnowledgeClaim[],
  ): McpKnowledgeConflict[] {
    const standardClaims: KnowledgeClaim[] = [];
    for (const standard of standards) {
      const source = this.source(standard);
      for (const rule of standard.rules) {
        if (rule.type === StandardRuleType.MUST_NOT) continue;
        if (rule.minRamMb !== null) standardClaims.push({ field: "ramMb", value: rule.minRamMb, source });
        if (rule.minVcpu !== null) standardClaims.push({ field: "vcpus", value: rule.minVcpu, source });
        if (rule.backupRequired !== null) standardClaims.push({ field: "backup", value: rule.backupRequired, source });
      }
    }
    const conflicts: McpKnowledgeConflict[] = [];
    for (const authoritative of standardClaims) {
      for (const document of documentClaims) {
        if (authoritative.field !== document.field || authoritative.value === document.value) continue;
        conflicts.push(this.claimConflict(authoritative, document));
      }
    }
    for (let leftIndex = 0; leftIndex < documentClaims.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < documentClaims.length; rightIndex += 1) {
        const left = documentClaims[leftIndex];
        const right = documentClaims[rightIndex];
        if (!left || !right || left.source.id === right.source.id || left.field !== right.field || left.value === right.value) continue;
        if (left.source.type === right.source.type) continue;
        const higher = left.source.knowledgePriority < right.source.knowledgePriority ? left : right;
        const lower = higher === left ? right : left;
        conflicts.push(this.claimConflict(higher, lower));
      }
    }
    return [...new Map(conflicts.map((conflict) => [
      `${conflict.topic}:${(conflict.sourceIds ?? []).join(":")}`,
      conflict,
    ])).values()];
  }

  private extractClaims(content: string, source: McpKnowledgeSource): KnowledgeClaim[] {
    const claims: KnowledgeClaim[] = [];
    const sentences = content.split(/(?<=[.!?;\n])\s+/u).slice(0, 1000);
    for (const sentence of sentences) {
      if (!/\b(muss|müssen|mindestens|minimum|erfordert|benötigt|verpflichtend|pflicht|darf nicht|kein|keine|optional)\b/iu.test(sentence)) continue;
      for (const match of sentence.matchAll(/(\d+)\s*(gb|mb)\s*(?:ram|arbeitsspeicher)/giu)) {
        const amount = Number(match[1]);
        claims.push({ field: "ramMb", value: match[2]?.toLocaleLowerCase("de-DE") === "gb" ? amount * 1024 : amount, source });
      }
      for (const match of sentence.matchAll(/(\d+)\s*(?:vcpus?|vcpu|virtuelle\s+cpus?)/giu)) {
        claims.push({ field: "vcpus", value: Number(match[1]), source });
      }
      if (/\bbackup\b/iu.test(sentence)) {
        const optional = /\b(kein|keine|nicht erforderlich|optional)\b/iu.test(sentence);
        claims.push({ field: "backup", value: !optional, source });
      }
    }
    return [...new Map(claims.map((claim) => [`${claim.field}:${String(claim.value)}`, claim])).values()];
  }

  private claimConflict(higher: KnowledgeClaim, lower: KnowledgeClaim): McpKnowledgeConflict {
    const label = higher.field === "ramMb" ? "Mindest-RAM" : higher.field === "vcpus" ? "Mindest-vCPU" : "Backup-Pflicht";
    return {
      topic: label,
      higherPrioritySourceId: higher.source.id,
      lowerPrioritySourceId: lower.source.id,
      sourceIds: [higher.source.id, lower.source.id],
      severity: "warning",
      reason: `${higher.source.title} nennt ${String(higher.value)}, ${lower.source.title} nennt ${String(lower.value)}. Die Quelle mit Wissensrang ${higher.source.knowledgePriority} hat Vorrang.`,
    };
  }

  private ruleConflict(left: EvaluationRule, right: EvaluationRule): string | null {
    const leftProhibits = left.type === StandardRuleType.MUST_NOT;
    const rightProhibits = right.type === StandardRuleType.MUST_NOT;
    if (left.backupRequired !== null && right.backupRequired !== null) {
      const leftRequired = leftProhibits ? !left.backupRequired : left.backupRequired;
      const rightRequired = rightProhibits ? !right.backupRequired : right.backupRequired;
      if (leftRequired !== rightRequired) return "Die strukturierten Backup-Vorgaben schließen sich gegenseitig aus.";
    }
    for (const field of ["minVcpu", "minRamMb"] as const) {
      const leftValue = left[field];
      const rightValue = right[field];
      if (leftValue === null || rightValue === null || leftProhibits === rightProhibits) continue;
      const minimum = leftProhibits ? rightValue : leftValue;
      const forbiddenFrom = leftProhibits ? leftValue : rightValue;
      if (minimum >= forbiddenFrom) return `Die Mindestvorgabe ${minimum} kollidiert mit dem Verbot ab ${forbiddenFrom}.`;
    }
    if (
      left.namingConvention
      && right.namingConvention
      && left.namingConvention === right.namingConvention
      && leftProhibits !== rightProhibits
    ) return "Dieselbe Namenskonvention wird gleichzeitig gefordert und verboten.";
    return null;
  }

  private source(standard: EvaluationStandard): McpKnowledgeSource {
    return { id: standard.id, type: "standard", title: standard.title, status: "active", knowledgePriority: 1, version: standard.version, updatedAt: standard.updatedAt.toISOString(), uri: `ad-wiki://standards/${standard.id}` };
  }

  private numberArray(value: Prisma.JsonValue): number[] {
    return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
  }

  private stringArray(value: Prisma.JsonValue): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  private requireScope(context: KnowledgeAccessContext, scope: string): void {
    if (!context.scopes.includes(scope)) throw new ForbiddenException("Für die Richtlinienauswertung fehlt die Leseberechtigung.");
  }
}
