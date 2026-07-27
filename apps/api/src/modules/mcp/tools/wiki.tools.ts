import { McpServer } from "@modelcontextprotocol/server";
import {
  type McpKnowledgeListInput,
  McpKnowledgeListInputSchema,
  McpKnowledgeListOutputSchema,
  McpKnowledgeReadOutputSchema,
  type McpKnowledgeReference,
  McpKnowledgeReferenceSchema,
  McpKnowledgeSearchOutputSchema,
  type McpWikiSearchInput,
  McpWikiSearchInputSchema,
} from "@ad-wiki/shared-types";
import {
  KnowledgeAccessService,
  type KnowledgeAccessContext,
} from "@/modules/knowledge/knowledge-access.service";
import {
  executeReadTool,
  READ_ONLY_ANNOTATIONS,
} from "@/modules/mcp/tools/tool-result";

/** Registriert die ersten ausschließlich lesenden Wiki-Werkzeuge. */
export function registerWikiTools(
  server: McpServer,
  knowledge: KnowledgeAccessService,
  context: KnowledgeAccessContext,
): void {
  server.registerTool(
    "list_pages",
    {
      title: "Wiki-Seiten auflisten",
      description: "Listet ausschließlich veröffentlichte, für MCP freigegebene Wiki-Seiten auf.",
      inputSchema: McpKnowledgeListInputSchema,
      outputSchema: McpKnowledgeListOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input: McpKnowledgeListInput) => executeReadTool(() => knowledge.listWiki(context, input)),
  );

  server.registerTool(
    "search_wiki",
    {
      title: "Wiki durchsuchen",
      description: "Durchsucht ausschließlich veröffentlichte, für MCP freigegebene Wiki-Seiten per deutscher Volltextsuche.",
      inputSchema: McpWikiSearchInputSchema,
      outputSchema: McpKnowledgeSearchOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input: McpWikiSearchInput) => executeReadTool(() => knowledge.searchWiki(context, input)),
  );

  server.registerTool(
    "read_page",
    {
      title: "Wiki-Seite lesen",
      description: "Liest eine sichtbare Wiki-Seite anhand ihrer ID oder ihres Slugs.",
      inputSchema: McpKnowledgeReferenceSchema,
      outputSchema: McpKnowledgeReadOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input: McpKnowledgeReference) => executeReadTool(() => knowledge.readWiki(context, input)),
  );
}
