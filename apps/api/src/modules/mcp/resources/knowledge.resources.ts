import { HttpException } from "@nestjs/common";
import {
  McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import {
  McpKnowledgeIdReferenceSchema,
  type McpKnowledgeListOutput,
  type McpKnowledgeReadOutput,
  McpKnowledgeReferenceSchema,
  type McpKnowledgeSource,
} from "@ad-wiki/shared-types";
import {
  KnowledgeAccessService,
  type KnowledgeAccessContext,
} from "@/modules/knowledge/knowledge-access.service";

const RESOURCE_LIMIT = 50;

/** Stellt dieselben sichtbaren Inhalte zusätzlich über zitierbare MCP-Ressourcen bereit. */
export function registerKnowledgeResources(
  server: McpServer,
  knowledge: KnowledgeAccessService,
  context: KnowledgeAccessContext,
): void {
  if (context.scopes.includes("pages:read")) {
    server.registerResource(
      "wiki-pages",
      new ResourceTemplate("ad-wiki://wiki/{slug}", {
        list: async () => resourceList(
          await knowledge.listWiki(context, { limit: RESOURCE_LIMIT }),
        ),
      }),
      {
        title: "AD-Wiki-Seiten",
        description: "Veröffentlichte und für MCP freigegebene Wiki-Seiten.",
        mimeType: "text/markdown",
      },
      async (uri, variables) => {
        const parsed = McpKnowledgeReferenceSchema.safeParse({ slug: variables.slug });
        if (!parsed.success) throw new ResourceNotFoundError(uri.href);
        return readResource(
          uri,
          () => knowledge.readWiki(context, parsed.data),
        );
      },
    );
  }

  if (context.scopes.includes("notes:read")) {
    server.registerResource(
      "notes",
      new ResourceTemplate("ad-wiki://notes/{id}", {
        list: async () => resourceList(
          await knowledge.listNotes(context, { limit: RESOURCE_LIMIT }),
        ),
      }),
      {
        title: "AD-Wiki-Notizen",
        description: "Eigene oder freigegebene, für MCP sichtbare Notizen.",
        mimeType: "text/markdown",
      },
      async (uri, variables) => {
        const parsed = McpKnowledgeIdReferenceSchema.safeParse({ id: variables.id });
        if (!parsed.success) throw new ResourceNotFoundError(uri.href);
        return readResource(
          uri,
          () => knowledge.readNote(context, parsed.data.id),
        );
      },
    );
  }

  if (context.scopes.includes("standards:read")) {
    server.registerResource(
      "standards",
      new ResourceTemplate("ad-wiki://standards/{id}", {
        list: async () => resourceList(
          await knowledge.listStandards(context, { limit: RESOURCE_LIMIT }),
        ),
      }),
      {
        title: "AD-Wiki-Richtlinien",
        description: "Aktive, aktuell gültige und für MCP freigegebene Richtlinien.",
        mimeType: "text/markdown",
      },
      async (uri, variables) => {
        const parsed = McpKnowledgeIdReferenceSchema.safeParse({ id: variables.id });
        if (!parsed.success) throw new ResourceNotFoundError(uri.href);
        return readResource(
          uri,
          () => knowledge.readStandard(context, { id: parsed.data.id }),
        );
      },
    );
  }
}

function resourceList(output: McpKnowledgeListOutput) {
  return {
    resources: output.results.map(resourceMetadata),
  };
}

function resourceMetadata(source: McpKnowledgeSource) {
  return {
    uri: source.uri,
    name: source.title,
    title: source.title,
    description: `${source.type}, Status ${source.status}, Wissensrang ${source.knowledgePriority}`,
    mimeType: "text/markdown",
  };
}

async function readResource(
  uri: URL,
  operation: () => Promise<McpKnowledgeReadOutput>,
) {
  try {
    const output = await operation();
    const document = output.result;
    const version = document.source.version === null
      ? "ohne Version"
      : `Version ${document.source.version}`;
    return {
      contents: [{
        uri: document.source.uri,
        mimeType: "text/markdown",
        text: [
          `# ${document.source.title}`,
          document.content,
          `---\nQuelle: ${document.source.uri} · ${version} · Status ${document.source.status}`,
        ].join("\n\n"),
      }],
    };
  } catch (error) {
    if (error instanceof HttpException && error.getStatus() < 500) {
      throw new ResourceNotFoundError(uri.href);
    }
    throw error;
  }
}
