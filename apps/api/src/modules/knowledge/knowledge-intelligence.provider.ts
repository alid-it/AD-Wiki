import type {
  McpCategorySuggestion,
  McpClassificationSuggestion,
  McpKnowledgeConflict,
  McpTagSuggestion,
} from "@ad-wiki/shared-types";

export const KNOWLEDGE_INTELLIGENCE_PROVIDER = Symbol("KNOWLEDGE_INTELLIGENCE_PROVIDER");

/** Austauschbarer, ausschließlich vorschlagender Provider ohne Schreibrechte. */
export interface KnowledgeIntelligenceProvider {
  readonly name: string;
  classify(title: string | undefined, content: string): Promise<McpClassificationSuggestion>;
  suggestTags(title: string | undefined, content: string): Promise<McpTagSuggestion[]>;
  suggestCategory(title: string | undefined, content: string): Promise<McpCategorySuggestion[]>;
  detectConflicts?(title: string | undefined, content: string): Promise<McpKnowledgeConflict[]>;
}
