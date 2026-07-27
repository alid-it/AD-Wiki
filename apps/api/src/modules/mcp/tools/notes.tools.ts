import { McpServer } from "@modelcontextprotocol/server";
import {
  type McpKnowledgeIdReference,
  McpKnowledgeIdReferenceSchema,
  McpKnowledgeReadOutputSchema,
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

/** Registriert ausschließlich lesende Werkzeuge für eigene oder freigegebene Notizen. */
export function registerNotesTools(
  server: McpServer,
  knowledge: KnowledgeAccessService,
  context: KnowledgeAccessContext,
): void {
  server.registerTool(
    "search_notes",
    {
      title: "Notizen durchsuchen",
      description: "Durchsucht nur eigene oder freigegebene, für MCP sichtbare und nicht archivierte Notizen.",
      inputSchema: McpWikiSearchInputSchema,
      outputSchema: McpKnowledgeSearchOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input: McpWikiSearchInput) =>
      executeReadTool(() => knowledge.searchNotes(context, input)),
  );

  server.registerTool(
    "read_note",
    {
      title: "Notiz lesen",
      description: "Liest eine eigene oder freigegebene sichtbare Notiz anhand ihrer ID.",
      inputSchema: McpKnowledgeIdReferenceSchema,
      outputSchema: McpKnowledgeReadOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input: McpKnowledgeIdReference) =>
      executeReadTool(() => knowledge.readNote(context, input.id)),
  );
}
