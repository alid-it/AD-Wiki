import { McpServer } from "@modelcontextprotocol/server";
import {
  type McpCreateStandardDraftInput,
  McpCreateStandardDraftInputSchema,
  McpWriteResultSchema,
} from "@ad-wiki/shared-types";
import type { KnowledgeAccessContext } from "@/modules/knowledge/knowledge-access.service";
import { KnowledgeWriteService } from "@/modules/knowledge/knowledge-write.service";
import {
  CREATE_ANNOTATIONS,
  executeWriteTool,
} from "@/modules/mcp/tools/tool-result";

export function registerStandardsWriteTools(
  server: McpServer,
  knowledge: KnowledgeWriteService,
  context: KnowledgeAccessContext,
): void {
  server.registerTool(
    "create_standard_draft",
    {
      title: "Richtlinienentwurf erstellen",
      description: "Erstellt nach Client-Freigabe ausschließlich einen nicht MCP-sichtbaren Richtlinienentwurf. Review und Aktivierung bleiben der Weboberfläche vorbehalten.",
      inputSchema: McpCreateStandardDraftInputSchema,
      outputSchema: McpWriteResultSchema,
      annotations: CREATE_ANNOTATIONS,
    },
    (input: McpCreateStandardDraftInput) =>
      executeWriteTool(() => knowledge.createStandardDraft(context, input)),
  );
}
