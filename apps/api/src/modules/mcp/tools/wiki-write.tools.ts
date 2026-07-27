import { McpServer } from "@modelcontextprotocol/server";
import {
  type McpCreatePageInput,
  McpCreatePageInputSchema,
  type McpUpdatePageInput,
  McpUpdatePageInputSchema,
  McpWriteResultSchema,
} from "@ad-wiki/shared-types";
import type { KnowledgeAccessContext } from "@/modules/knowledge/knowledge-access.service";
import { KnowledgeWriteService } from "@/modules/knowledge/knowledge-write.service";
import {
  CREATE_ANNOTATIONS,
  executeWriteTool,
  UPDATE_ANNOTATIONS,
} from "@/modules/mcp/tools/tool-result";

export function registerWikiWriteTools(
  server: McpServer,
  knowledge: KnowledgeWriteService,
  context: KnowledgeAccessContext,
): void {
  server.registerTool(
    "create_page",
    {
      title: "Wiki-Entwurf erstellen",
      description: "Erstellt nach Client-Freigabe ausschließlich eine nicht öffentliche und nicht MCP-sichtbare Wiki-Seite im Entwurfsstatus.",
      inputSchema: McpCreatePageInputSchema,
      outputSchema: McpWriteResultSchema,
      annotations: CREATE_ANNOTATIONS,
    },
    (input: McpCreatePageInput) =>
      executeWriteTool(() => knowledge.createPage(context, input)),
  );

  server.registerTool(
    "update_page",
    {
      title: "Wiki-Entwurf bearbeiten",
      description: "Ändert nach Client-Freigabe nur einen Entwurf und verhindert mit expectedVersion verlorene Updates. Veröffentlichte Seiten werden abgelehnt.",
      inputSchema: McpUpdatePageInputSchema,
      outputSchema: McpWriteResultSchema,
      annotations: UPDATE_ANNOTATIONS,
    },
    (input: McpUpdatePageInput) =>
      executeWriteTool(() => knowledge.updatePage(context, input)),
  );
}
