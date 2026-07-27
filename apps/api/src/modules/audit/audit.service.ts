import { Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuditLog, AuditLogQuery } from "@ad-wiki/shared-types";
import { PrismaService } from "@/prisma/prisma.service";
import { MonitoringService } from "@/health/monitoring.service";

/** Zusatzkontext eines Audit-Eintrags (wird als JSON gespeichert). */
export type AuditDetails = Record<string, unknown>;

/**
 * Zentraler Dienst zum Schreiben und Abfragen von Audit-Log-Einträgen.
 * Wird über das @Global AuditModule in allen Feature-Modulen bereitgestellt.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly monitoring?: MonitoringService,
  ) {}

  /**
   * Schreibt einen Audit-Eintrag. Fehler werden bewusst geschluckt und nur
   * geloggt – das Audit-Logging darf die eigentliche Operation niemals stören.
   *
   * @param userId    Auslösender Benutzer (null bei anonymen Aktionen).
   * @param action    Aktionsname im Format `resource.verb` (siehe AUDIT_ACTIONS).
   * @param resource  Betroffene Ressource (siehe AUDIT_RESOURCES).
   * @param resourceId Optionale ID des betroffenen Objekts.
   * @param details   Optionaler JSON-Zusatzkontext (z. B. Titel, Änderungen).
   * @param ipAddress Optionale IP-Adresse des Requests.
   */
  async log(
    userId: string | null,
    action: string,
    resource: string,
    resourceId?: string | null,
    details?: AuditDetails | null,
    ipAddress?: string | null,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: userId ?? null,
          action,
          resource,
          resourceId: resourceId ?? null,
          details: (details ?? undefined) as Prisma.InputJsonValue | undefined,
          ipAddress: ipAddress ?? null,
        },
      });
      this.monitoring?.recordAuditWrite(true);
    } catch (error) {
      this.monitoring?.recordAuditWrite(false);
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Audit-Log fehlgeschlagen (${action}): ${message}`);
    }
  }

  /**
   * Cursor-basierte, filterbare Liste der Audit-Einträge (neueste zuerst).
   *
   * Statt Offset/Limit wird nach `(createdAt, id)` absteigend geblättert. Das
   * bleibt stabil, wenn während des Blätterns neue Einträge hinzukommen, und
   * skaliert auch bei sehr großen Tabellen (kein teures OFFSET). `id` dient als
   * eindeutiger Tiebreak für Einträge mit identischem Zeitstempel.
   */
  async findAll(
    query: AuditLogQuery,
  ): Promise<{ data: AuditLog[]; meta: { total: number; perPage: number; nextCursor: string | null } }> {
    // Reine Filterbedingung (ohne Cursor) – auch für die Gesamtzahl genutzt.
    const filterWhere: Prisma.AuditLogWhereInput = {};
    if (query.resource) filterWhere.resource = query.resource;
    if (query.action) filterWhere.action = query.action;
    if (query.userId) filterWhere.userId = query.userId;
    if (query.from || query.to) {
      filterWhere.createdAt = {};
      if (query.from) filterWhere.createdAt.gte = new Date(query.from);
      if (query.to) filterWhere.createdAt.lte = new Date(query.to);
    }

    // Cursor in die Blätter-Bedingung übersetzen: alles „nach" (createdAt, id).
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const where: Prisma.AuditLogWhereInput = cursor
      ? {
          AND: [
            filterWhere,
            {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : filterWhere;

    // Eine Zeile mehr laden, um zu erkennen, ob eine weitere Seite existiert.
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where: filterWhere }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.perPage + 1,
        include: { user: { select: { id: true, displayName: true } } },
      }),
    ]);

    const hasMore = rows.length > query.perPage;
    const pageRows = hasMore ? rows.slice(0, query.perPage) : rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

    return {
      data: pageRows.map((log) => this.toApi(log)),
      meta: { total, perPage: query.perPage, nextCursor },
    };
  }

  /** Wandelt einen Prisma-Datensatz in die API-Repräsentation um. */
  private toApi(
    log: Prisma.AuditLogGetPayload<{ include: { user: { select: { id: true; displayName: true } } } }>,
  ): AuditLog {
    return {
      id: log.id,
      action: log.action,
      resource: log.resource,
      resourceId: log.resourceId,
      details: (log.details ?? null) as AuditLog["details"],
      ipAddress: log.ipAddress,
      createdAt: log.createdAt.toISOString(),
      userId: log.userId,
      user: log.user ? { id: log.user.id, displayName: log.user.displayName } : null,
    };
  }
}

/** Kodiert die Cursor-Position `(createdAt, id)` als opaken base64url-Token. */
function encodeCursor(createdAt: Date, id: string): string {
  const payload = JSON.stringify({ c: createdAt.toISOString(), i: id });
  return Buffer.from(payload, "utf8").toString("base64url");
}

/** Dekodiert einen Cursor-Token; bei ungültigem Token wird `null` geliefert. */
function decodeCursor(raw: string): { createdAt: Date; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      c?: unknown;
      i?: unknown;
    };
    if (typeof parsed.c !== "string" || typeof parsed.i !== "string") return null;
    const createdAt = new Date(parsed.c);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: parsed.i };
  } catch {
    return null;
  }
}
