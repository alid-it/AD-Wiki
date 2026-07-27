import { McpServer } from "@modelcontextprotocol/server";
import {
  type McpCreateNoteInput,
  McpCreateNoteInputSchema,
  type McpUpdateNoteInput,
  McpUpdateNoteInputSchema,
  McpWriteResultSchema,
} from "@ad-wiki/shared-types";
import type { KnowledgeAccessContext } from "@/modules/knowledge/knowledge-access.service";
import { KnowledgeWriteService } from "@/modules/knowledge/knowledge-write.service";
import {
  CREATE_ANNOTATIONS,
  executeWriteTool,
  UPDATE_ANNOTATIONS,
} from "@/modules/mcp/tools/tool-result";

export function registerNotesWriteTools(
  server: McpServer,
  knowledge: KnowledgeWriteService,
  context: KnowledgeAccessContext,
): void {
  server.registerTool(
    "create_note",
    {
      title: "Notiz erfassen",
      description: "Erstellt nach Client-Freigabe eine nicht MCP-sichtbare Notiz im Besitz des Tokenbenutzers.",
      inputSchema: McpCreateNoteInputSchema,
      outputSchema: McpWriteResultSchema,
      annotations: CREATE_ANNOTATIONS,
    },
    (input: McpCreateNoteInput) =>
      executeWriteTool(() => knowledge.createNote(context, input)),
  );

  server.registerTool(
    "update_note",
    {
      title: "Notiz bearbeiten",
      description: "Ändert nach Client-Freigabe nur eigene Notizen oder Freigaben mit EDIT-Recht; Status, Besitzer und MCP-Sichtbarkeit bleiben unverändert.",
      inputSchema: McpUpdateNoteInputSchema,
      outputSchema: McpWriteResultSchema,
      annotations: UPDATE_ANNOTATIONS,
    },
    (input: McpUpdateNoteInput) =>
      executeWriteTool(() => knowledge.updateNote(context, input)),
  );
}
