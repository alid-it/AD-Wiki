import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { PageStatus, PageType } from "@prisma/client";
import type {
  McpCreateNoteInput,
  McpCreatePageInput,
  McpCreateStandardDraftInput,
  McpUpdateNoteInput,
  McpUpdatePageInput,
  McpWriteResult,
} from "@ad-wiki/shared-types";
import { AuditService } from "@/modules/audit/audit.service";
import type { KnowledgeAccessContext } from "@/modules/knowledge/knowledge-access.service";
import { NotesService } from "@/modules/notes/notes.service";
import { PagesService } from "@/modules/pages/pages.service";
import { StandardsService } from "@/modules/standards/standards.service";

/**
 * Transportneutrale Schreibgrenze für MCP. Kritische Felder werden hier
 * serverseitig festgelegt und können nicht aus Tool-Eingaben übernommen werden.
 */
@Injectable()
export class KnowledgeWriteService {
  constructor(
    private readonly pages: PagesService,
    private readonly notes: NotesService,
    private readonly standards: StandardsService,
    private readonly audit: AuditService,
  ) {}

  async createPage(
    context: KnowledgeAccessContext,
    input: McpCreatePageInput,
  ): Promise<McpWriteResult> {
    this.requireScope(context, "pages:create");
    const createInput = {
      ...input,
      type: "page",
      status: "draft",
      isPublic: false,
      mcpVisible: false,
    } as const;
    const page = context.actor
      ? await this.pages.create(createInput, context.userId, context.actor)
      : await this.pages.create(createInput, context.userId);
    await this.auditMutation(context, "page.created", "page", page.id, {
      title: page.title,
      slug: page.slug,
      status: page.status,
    });
    return {
      result: {
        id: page.id,
        type: "wiki",
        title: page.title,
        status: page.status,
        version: page.version,
        mcpVisible: false,
        uri: `ad-wiki://wiki/${page.slug}`,
      },
      warnings: ["Die Seite wurde als nicht freigegebener Entwurf erstellt."],
    };
  }

  async updatePage(
    context: KnowledgeAccessContext,
    input: McpUpdatePageInput,
  ): Promise<McpWriteResult> {
    this.requireScope(context, "pages:update");
    const current = context.actor
      ? await this.pages.findUpdateState(input.id, context.actor)
      : await this.pages.findUpdateState(input.id);
    if (current.type !== PageType.PAGE) {
      throw new BadRequestException("MCP kann nur Inhaltsseiten bearbeiten.");
    }
    if (current.status !== PageStatus.DRAFT) {
      throw new ConflictException(
        "Veröffentlichte oder archivierte Seiten werden nicht direkt geändert. Dafür ist künftig ein KnowledgeChangeRequest vorgesehen.",
      );
    }
    const { id, expectedVersion, changeMessage, ...changes } = input;
    const page = await this.pages.update(id, {
      ...changes,
      mcpVisible: false,
      changeMessage: `[MCP] ${changeMessage}`,
    }, {
      expectedVersion,
      editorId: context.userId,
      ...(context.actor ? { actor: context.actor } : {}),
    });
    await this.auditMutation(context, "page.updated", "page", page.id, {
      title: page.title,
      expectedVersion,
      version: page.version,
      changeMessage,
    });
    return {
      result: {
        id: page.id,
        type: "wiki",
        title: page.title,
        status: page.status,
        version: page.version,
        mcpVisible: false,
        uri: `ad-wiki://wiki/${page.slug}`,
      },
      warnings: ["Der Entwurf bleibt nicht öffentlich und nicht für MCP-Lesezugriffe freigegeben."],
    };
  }

  async createNote(
    context: KnowledgeAccessContext,
    input: McpCreateNoteInput,
  ): Promise<McpWriteResult> {
    this.requireScope(context, "notes:create");
    const note = context.actor
      ? await this.notes.create(
          { ...input, mcpVisible: false },
          context.userId,
          context.actor,
        )
      : await this.notes.create(
          { ...input, mcpVisible: false },
          context.userId,
        );
    await this.auditMutation(context, "note.created", "note", note.id, {
      title: note.title,
      status: note.status,
    });
    return this.noteResult(
      note,
      "Die Notiz wurde nicht für MCP-Lesezugriffe freigegeben.",
    );
  }

  async updateNote(
    context: KnowledgeAccessContext,
    input: McpUpdateNoteInput,
  ): Promise<McpWriteResult> {
    this.requireScope(context, "notes:update");
    const { id, ...changes } = input;
    const note = context.actor
      ? await this.notes.update(id, changes, context.userId, context.actor)
      : await this.notes.update(id, changes, context.userId);
    await this.auditMutation(context, "note.updated", "note", note.id, {
      title: note.title,
      status: note.status,
    });
    return this.noteResult(
      note,
      "Status, Besitzer und MCP-Freigabe der Notiz wurden nicht verändert.",
    );
  }

  async createStandardDraft(
    context: KnowledgeAccessContext,
    input: McpCreateStandardDraftInput,
  ): Promise<McpWriteResult> {
    this.requireScope(context, "standards:create");
    if (
      input.validFrom
      && input.validUntil
      && new Date(input.validUntil) < new Date(input.validFrom)
    ) {
      throw new BadRequestException("validUntil darf nicht vor validFrom liegen.");
    }
    const standardInput = {
      ...input,
      responsibleId: context.userId,
      mcpVisible: false,
    };
    const standard = context.actor
      ? await this.standards.create(
          standardInput,
          context.userId,
          context.actor,
        )
      : await this.standards.create(standardInput, context.userId);
    await this.auditMutation(context, "standard.created", "standard", standard.id, {
      title: standard.title,
      status: standard.status,
    });
    return {
      result: {
        id: standard.id,
        type: "standard",
        title: standard.title,
        status: standard.status,
        version: standard.version,
        mcpVisible: false,
        uri: `ad-wiki://standards/${standard.id}`,
      },
      warnings: ["Die Richtlinie wurde als nicht freigegebener Entwurf erstellt und benötigt den Web-Review."],
    };
  }

  private noteResult(note: {
    id: string;
    title: string | null;
    content: string;
    status: string;
    mcpVisible: boolean;
  }, warning: string): McpWriteResult {
    return {
      result: {
        id: note.id,
        type: "note",
        title: note.title?.trim() || note.content.replace(/\s+/g, " ").trim().slice(0, 80) || "Notiz",
        status: note.status,
        version: null,
        mcpVisible: note.mcpVisible,
        uri: `ad-wiki://notes/${note.id}`,
      },
      warnings: [warning],
    };
  }

  private requireScope(context: KnowledgeAccessContext, scope: string): void {
    if (!context.scopes.includes(scope)) {
      throw new ForbiddenException("Für dieses Schreibwerkzeug fehlt die Berechtigung.");
    }
  }

  private async auditMutation(
    context: KnowledgeAccessContext,
    action: string,
    resource: string,
    resourceId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.log(context.userId, action, resource, resourceId, {
      ...details,
      source: "mcp",
      tokenId: context.tokenId ?? null,
    });
  }
}
