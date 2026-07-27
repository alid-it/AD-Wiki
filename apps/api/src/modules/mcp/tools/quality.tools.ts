import { McpServer } from "@modelcontextprotocol/server";
import {
  type McpClassifyContentInput,
  McpClassifyContentInputSchema,
  McpClassifyContentOutputSchema,
  type McpDetectConflictsInput,
  McpDetectConflictsInputSchema,
  McpDetectConflictsOutputSchema,
  type McpEvaluateStandardsInput,
  McpEvaluateStandardsInputSchema,
  McpEvaluateStandardsOutputSchema,
  type McpSuggestCategoryInput,
  McpSuggestCategoryInputSchema,
  McpSuggestCategoryOutputSchema,
  type McpSuggestTagsInput,
  McpSuggestTagsInputSchema,
  McpSuggestTagsOutputSchema,
} from "@ad-wiki/shared-types";
import type { KnowledgeAccessContext } from "@/modules/knowledge/knowledge-access.service";
import { KnowledgeIntelligenceService } from "@/modules/knowledge/knowledge-intelligence.service";
import { StandardsEvaluationService } from "@/modules/knowledge/standards-evaluation.service";
import {
  executeReadTool,
  INTELLIGENCE_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
} from "@/modules/mcp/tools/tool-result";

/** Registriert die deterministischen Qualitäts- und Auswertungswerkzeuge aus Phase 9d. */
export function registerQualityTools(
  server: McpServer,
  evaluation: StandardsEvaluationService,
  intelligence: KnowledgeIntelligenceService,
  context: KnowledgeAccessContext,
): void {
  server.registerTool(
    "evaluate_against_standards",
    {
      title: "Gegen Richtlinien auswerten",
      description: "Prüft strukturierte Ist-Werte deterministisch gegen ausschließlich aktive, gültige und MCP-sichtbare Richtlinien. Fehlende oder nicht strukturierte Werte werden unknown.",
      inputSchema: McpEvaluateStandardsInputSchema,
      outputSchema: McpEvaluateStandardsOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input: McpEvaluateStandardsInput) =>
      executeReadTool(() => evaluation.evaluate(context, input)),
  );

  server.registerTool(
    "detect_source_conflicts",
    {
      title: "Richtlinienkonflikte erkennen",
      description: "Erkennt konservativ nur deterministisch belegbare Widersprüche zwischen strukturierten Regeln sichtbarer aktiver Richtlinien.",
      inputSchema: McpDetectConflictsInputSchema,
      outputSchema: McpDetectConflictsOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input: McpDetectConflictsInput) =>
      executeReadTool(() => evaluation.detectConflicts(context, input)),
  );

  server.registerTool(
    "classify_content",
    {
      title: "Inhalt klassifizieren",
      description: "Liefert einen unverbindlichen Vorschlag für Wissenstyp, Qualität, Reife und Sensitivität; schreibt oder veröffentlicht nichts.",
      inputSchema: McpClassifyContentInputSchema,
      outputSchema: McpClassifyContentOutputSchema,
      annotations: INTELLIGENCE_ANNOTATIONS,
    },
    (input: McpClassifyContentInput) =>
      executeReadTool(() => intelligence.classify(context, input)),
  );

  server.registerTool(
    "suggest_tags",
    {
      title: "Vorhandene Tags vorschlagen",
      description: "Schlägt ausschließlich Tags aus sichtbaren ähnlichen Inhalten des gewählten Wissenstyps vor und verändert keine Inhalte.",
      inputSchema: McpSuggestTagsInputSchema,
      outputSchema: McpSuggestTagsOutputSchema,
      annotations: INTELLIGENCE_ANNOTATIONS,
    },
    (input: McpSuggestTagsInput) =>
      executeReadTool(() => intelligence.suggestTags(context, input)),
  );

  server.registerTool(
    "suggest_category",
    {
      title: "Kategorie vorschlagen",
      description: "Schlägt sichtbare Kategorien des gewählten Wissenstyps anhand von Name, Beschreibung und erlaubten Vergleichsinhalten vor.",
      inputSchema: McpSuggestCategoryInputSchema,
      outputSchema: McpSuggestCategoryOutputSchema,
      annotations: INTELLIGENCE_ANNOTATIONS,
    },
    (input: McpSuggestCategoryInput) =>
      executeReadTool(() => intelligence.suggestCategory(context, input)),
  );
}
