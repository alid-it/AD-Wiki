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

/** Registriert die Lesewerkzeuge für aktive, gültige und freigegebene Richtlinien. */
export function registerStandardsTools(
  server: McpServer,
  knowledge: KnowledgeAccessService,
  context: KnowledgeAccessContext,
): void {
  server.registerTool(
    "list_active_standards",
    {
      title: "Aktive Richtlinien auflisten",
      description: "Listet ausschließlich aktive, aktuell gültige und für MCP freigegebene Richtlinien auf.",
      inputSchema: McpKnowledgeListInputSchema,
      outputSchema: McpKnowledgeListOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input: McpKnowledgeListInput) =>
      executeReadTool(() => knowledge.listStandards(context, input)),
  );

  server.registerTool(
    "search_standards",
    {
      title: "Richtlinien durchsuchen",
      description: "Durchsucht ausschließlich aktive, aktuell gültige und für MCP freigegebene Richtlinien.",
      inputSchema: McpWikiSearchInputSchema,
      outputSchema: McpKnowledgeSearchOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input: McpWikiSearchInput) =>
      executeReadTool(() => knowledge.searchStandards(context, input)),
  );

  server.registerTool(
    "read_standard",
    {
      title: "Richtlinie lesen",
      description: "Liest eine aktive und aktuell gültige Richtlinie anhand ihrer ID oder ihres Slugs.",
      inputSchema: McpKnowledgeReferenceSchema,
      outputSchema: McpKnowledgeReadOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input: McpKnowledgeReference) =>
      executeReadTool(() => knowledge.readStandard(context, input)),
  );
}
