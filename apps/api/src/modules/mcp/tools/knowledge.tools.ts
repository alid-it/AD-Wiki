import { McpServer } from "@modelcontextprotocol/server";
import {
  type McpKnowledgeCatalogInput,
  McpKnowledgeCatalogInputSchema,
  McpKnowledgeCatalogOutputSchema,
  type McpKnowledgeSearchInput,
  McpKnowledgeSearchInputSchema,
  McpKnowledgeSearchOutputSchema,
} from "@ad-wiki/shared-types";
import {
  KnowledgeAccessService,
  type KnowledgeAccessContext,
} from "@/modules/knowledge/knowledge-access.service";
import {
  executeReadTool,
  READ_ONLY_ANNOTATIONS,
} from "@/modules/mcp/tools/tool-result";

/** Registriert den typübergreifenden, ACL-bewussten Wissenszugriff. */
export function registerKnowledgeTools(
  server: McpServer,
  knowledge: KnowledgeAccessService,
  context: KnowledgeAccessContext,
): void {
  server.registerTool(
    "list_knowledge",
    {
      title: "Gesamten Wissenskatalog auflisten",
      description:
        "Listet alle für den angemeldeten Benutzer sichtbaren Wiki-Seiten, Notizen und aktiven Richtlinien gruppiert und paginiert auf. ACL, Eigentum, Freigaben und MCP-Sichtbarkeit werden unverändert erzwungen.",
      inputSchema: McpKnowledgeCatalogInputSchema,
      outputSchema: McpKnowledgeCatalogOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input: McpKnowledgeCatalogInput) =>
      executeReadTool(() => knowledge.listKnowledge(context, input)),
  );

  server.registerTool(
    "search_knowledge",
    {
      title: "Wissen durchsuchen",
      description: "Durchsucht sichtbare Richtlinien, Wiki-Seiten und Notizen mit fachlicher Quellenrangfolge.",
      inputSchema: McpKnowledgeSearchInputSchema,
      outputSchema: McpKnowledgeSearchOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input: McpKnowledgeSearchInput) =>
      executeReadTool(() => knowledge.searchKnowledge(context, input)),
  );
}
