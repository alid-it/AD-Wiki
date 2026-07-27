import { z } from 'zod';
import { z as z4 } from 'zod-mcp';

/** Metadaten eines MCP-Tokens. Hash und Klartext werden niemals aufgelistet. */
export const McpAccessTokenSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tokenPrefix: z.string(),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  active: z.boolean(),
});
export type McpAccessToken = z.infer<typeof McpAccessTokenSchema>;

/** Eingabe zum Erstellen eines benutzergebundenen MCP-Tokens. */
export const CreateMcpAccessTokenSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiresAt: z.string().datetime().nullable().optional(),
});
export type CreateMcpAccessTokenInput = z.infer<typeof CreateMcpAccessTokenSchema>;

/** Nur diese Antwort enthaelt einmalig den geheimen Token-Klartext. */
export const CreatedMcpAccessTokenSchema = McpAccessTokenSchema.extend({
  token: z.string().min(32),
});
export type CreatedMcpAccessToken = z.infer<typeof CreatedMcpAccessTokenSchema>;

export const McpOAuthAuthorizationRequestSchema = z.object({
  id: z.string().uuid(),
  clientName: z.string(),
  redirectUri: z.string().url(),
  scopes: z.array(z.enum(['mcp:read', 'mcp:write'])),
  expiresAt: z.string().datetime(),
});
export type McpOAuthAuthorizationRequest = z.infer<typeof McpOAuthAuthorizationRequestSchema>;

export const McpOAuthRedirectSchema = z.object({ redirectUrl: z.string().url() });
export type McpOAuthRedirect = z.infer<typeof McpOAuthRedirectSchema>;

// ── Phase 9b: gemeinsame Knowledge-Verträge ──────────────────────────────

export const McpKnowledgeKindSchema = z4.enum(['note', 'wiki', 'standard']);

export const McpKnowledgeListInputSchema = z4.object({
  limit: z4.number().int().positive().max(50).default(20),
  cursor: z4.string().min(1).max(1000).optional(),
});
export type McpKnowledgeListInput = z4.infer<typeof McpKnowledgeListInputSchema>;

/**
 * Paginierung für den typübergreifenden Wissenskatalog. Jeder Wissenstyp
 * besitzt einen eigenen Cursor, damit langsamere Bereiche nicht übersprungen
 * werden, wenn ein anderer Bereich mehr Treffer enthält.
 */
export const McpKnowledgeCatalogInputSchema = z4.object({
  limitPerType: z4.number().int().positive().max(50).default(20),
  cursors: z4.object({
    wiki: z4.string().min(1).max(1000).optional(),
    notes: z4.string().min(1).max(1000).optional(),
    standards: z4.string().min(1).max(1000).optional(),
  }).default({}),
});
export type McpKnowledgeCatalogInput = z4.infer<typeof McpKnowledgeCatalogInputSchema>;

export const McpKnowledgeSearchInputSchema = McpKnowledgeListInputSchema.extend({
  query: z4.string().trim().min(1).max(200),
  types: z4.array(McpKnowledgeKindSchema).min(1).max(3).default(['standard', 'wiki', 'note']),
});
export type McpKnowledgeSearchInput = z4.infer<typeof McpKnowledgeSearchInputSchema>;

export const McpWikiSearchInputSchema = McpKnowledgeListInputSchema.extend({
  query: z4.string().trim().min(1).max(200),
});
export type McpWikiSearchInput = z4.infer<typeof McpWikiSearchInputSchema>;

export const McpKnowledgeIdReferenceSchema = z4.object({
  id: z4.string().uuid(),
});
export type McpKnowledgeIdReference = z4.infer<typeof McpKnowledgeIdReferenceSchema>;

/** Referenz auf genau eine Ressource. Wiki und Richtlinien unterstützen auch Slugs. */
export const McpKnowledgeReferenceObjectSchema = z4.object({
  id: z4.string().uuid().optional(),
  slug: z4.string().trim().min(1).max(200).optional(),
});

export const McpKnowledgeReferenceSchema = McpKnowledgeReferenceObjectSchema.refine(
  (value) => Boolean(value.id) !== Boolean(value.slug),
  {
    message: 'Genau eine Referenz aus id oder slug ist erforderlich.',
  },
);
export type McpKnowledgeReference = z4.infer<typeof McpKnowledgeReferenceSchema>;

export const McpKnowledgeCategorySchema = z4.object({
  id: z4.string().uuid(),
  name: z4.string(),
  slug: z4.string(),
});
export type McpKnowledgeCategory = z4.infer<typeof McpKnowledgeCategorySchema>;

/** Einheitliche, zitierbare Quellenangabe für alle MCP-Lesewerkzeuge. */
export const McpKnowledgeSourceSchema = z4.object({
  id: z4.string().uuid(),
  type: McpKnowledgeKindSchema,
  title: z4.string(),
  status: z4.string(),
  knowledgePriority: z4.union([z4.literal(1), z4.literal(2), z4.literal(3)]),
  version: z4.number().int().positive().nullable(),
  updatedAt: z4.string().datetime(),
  uri: z4.string().min(1),
});
export type McpKnowledgeSource = z4.infer<typeof McpKnowledgeSourceSchema>;

/** Vollständiger sichtbarer Wissensinhalt mit bewusst begrenzten Metadaten. */
export const McpKnowledgeDocumentSchema = z4.object({
  source: McpKnowledgeSourceSchema,
  content: z4.string(),
  excerpt: z4.string().nullable(),
  category: McpKnowledgeCategorySchema.nullable(),
  tags: z4.array(z4.string()),
  metadata: z4.record(z4.string(), z4.unknown()),
});
export type McpKnowledgeDocument = z4.infer<typeof McpKnowledgeDocumentSchema>;

export const McpKnowledgeConflictSchema = z4.object({
  topic: z4.string(),
  higherPrioritySourceId: z4.string().uuid().nullable(),
  lowerPrioritySourceId: z4.string().uuid().nullable(),
  reason: z4.string(),
  sourceIds: z4.array(z4.string().uuid()).max(10).optional(),
  severity: z4.enum(['info', 'warning', 'critical']).optional(),
});
export type McpKnowledgeConflict = z4.infer<typeof McpKnowledgeConflictSchema>;

export const McpKnowledgeListOutputSchema = z4.object({
  results: z4.array(McpKnowledgeSourceSchema),
  sources: z4.array(McpKnowledgeSourceSchema),
  conflicts: z4.array(McpKnowledgeConflictSchema),
  warnings: z4.array(z4.string()),
  nextCursor: z4.string().nullable(),
});
export type McpKnowledgeListOutput = z4.infer<typeof McpKnowledgeListOutputSchema>;

export const McpKnowledgeCatalogOutputSchema = z4.object({
  results: z4.object({
    wiki: z4.array(McpKnowledgeSourceSchema),
    notes: z4.array(McpKnowledgeSourceSchema),
    standards: z4.array(McpKnowledgeSourceSchema),
  }),
  sources: z4.array(McpKnowledgeSourceSchema),
  warnings: z4.array(z4.string()),
  nextCursors: z4.object({
    wiki: z4.string().nullable(),
    notes: z4.string().nullable(),
    standards: z4.string().nullable(),
  }),
});
export type McpKnowledgeCatalogOutput = z4.infer<typeof McpKnowledgeCatalogOutputSchema>;

export const McpKnowledgeReadOutputSchema = z4.object({
  result: McpKnowledgeDocumentSchema,
  sources: z4.array(McpKnowledgeSourceSchema),
  conflicts: z4.array(McpKnowledgeConflictSchema),
  warnings: z4.array(z4.string()),
});
export type McpKnowledgeReadOutput = z4.infer<typeof McpKnowledgeReadOutputSchema>;

export const McpKnowledgeSearchResultSchema = z4.object({
  sourceId: z4.string().uuid(),
  excerpt: z4.string().nullable(),
  score: z4.number().min(0),
});
export type McpKnowledgeSearchResult = z4.infer<typeof McpKnowledgeSearchResultSchema>;

export const McpKnowledgeSearchOutputSchema = z4.object({
  results: z4.array(McpKnowledgeSearchResultSchema),
  sources: z4.array(McpKnowledgeSourceSchema),
  conflicts: z4.array(McpKnowledgeConflictSchema),
  warnings: z4.array(z4.string()),
  nextCursor: z4.string().nullable(),
});
export type McpKnowledgeSearchOutput = z4.infer<typeof McpKnowledgeSearchOutputSchema>;

// ── Phase 9c: sichere Schreibverträge ────────────────────────────────────

const McpTagListSchema = z4.array(z4.string().trim().min(1).max(40)).max(20);

export const McpCreatePageInputSchema = z4.object({
  title: z4.string().trim().min(1).max(200),
  content: z4.string().max(100_000).default(''),
  excerpt: z4.string().trim().max(500).optional(),
  categoryId: z4.string().uuid().nullable().optional(),
  parentId: z4.string().uuid().nullable().optional(),
  tags: McpTagListSchema.default([]),
});
export type McpCreatePageInput = z4.infer<typeof McpCreatePageInputSchema>;

export const McpUpdatePageInputSchema = z4.object({
  id: z4.string().uuid(),
  expectedVersion: z4.number().int().positive(),
  title: z4.string().trim().min(1).max(200).optional(),
  content: z4.string().max(100_000).optional(),
  excerpt: z4.string().trim().max(500).nullable().optional(),
  categoryId: z4.string().uuid().nullable().optional(),
  parentId: z4.string().uuid().nullable().optional(),
  tags: McpTagListSchema.optional(),
  changeMessage: z4.string().trim().min(1).max(500),
}).refine(
  (value) => [
    value.title,
    value.content,
    value.excerpt,
    value.categoryId,
    value.parentId,
    value.tags,
  ].some((field) => field !== undefined),
  { message: 'Mindestens ein Seitenfeld muss geändert werden.' },
);
export type McpUpdatePageInput = z4.infer<typeof McpUpdatePageInputSchema>;

export const McpCreateNoteInputSchema = z4.object({
  title: z4.string().trim().max(200).nullable().optional(),
  content: z4.string().trim().min(1).max(100_000),
  categoryId: z4.string().uuid().nullable().optional(),
  tags: McpTagListSchema.default([]),
});
export type McpCreateNoteInput = z4.infer<typeof McpCreateNoteInputSchema>;

export const McpUpdateNoteInputSchema = z4.object({
  id: z4.string().uuid(),
  title: z4.string().trim().max(200).nullable().optional(),
  content: z4.string().trim().min(1).max(100_000).optional(),
  categoryId: z4.string().uuid().nullable().optional(),
  tags: McpTagListSchema.optional(),
}).refine(
  (value) => [value.title, value.content, value.categoryId, value.tags]
    .some((field) => field !== undefined),
  { message: 'Mindestens ein Notizfeld muss geändert werden.' },
);
export type McpUpdateNoteInput = z4.infer<typeof McpUpdateNoteInputSchema>;

export const McpCreateStandardRuleInputSchema = z4.object({
  title: z4.string().trim().min(1).max(200),
  description: z4.string().trim().max(10_000).optional(),
  type: z4.enum(['must', 'should', 'may', 'must_not']).default('must'),
  sortOrder: z4.number().int().default(0),
  minVcpu: z4.number().int().positive().nullable().optional(),
  minRamMb: z4.number().int().positive().nullable().optional(),
  backupRequired: z4.boolean().nullable().optional(),
  allowedPorts: z4.array(z4.number().int().min(1).max(65_535)).default([]),
  allowedNetworks: z4.array(z4.string().trim().min(1).max(100)).default([]),
  namingConvention: z4.string().trim().max(500).nullable().optional(),
});

export const McpCreateStandardDraftInputSchema = z4.object({
  title: z4.string().trim().min(1).max(200),
  description: z4.string().trim().min(1).max(50_000),
  justification: z4.string().trim().min(1).max(20_000),
  priority: z4.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  categoryId: z4.string().uuid().nullable().optional(),
  validFrom: z4.string().datetime().nullable().optional(),
  validUntil: z4.string().datetime().nullable().optional(),
  pageIds: z4.array(z4.string().uuid()).max(100).default([]),
  rules: z4.array(McpCreateStandardRuleInputSchema).max(100).default([]),
});
export type McpCreateStandardDraftInput = z4.infer<typeof McpCreateStandardDraftInputSchema>;

export const McpWriteResultSchema = z4.object({
  result: z4.object({
    id: z4.string().uuid(),
    type: McpKnowledgeKindSchema,
    title: z4.string(),
    status: z4.string(),
    version: z4.number().int().positive().nullable(),
    mcpVisible: z4.boolean(),
    uri: z4.string().min(1),
  }),
  warnings: z4.array(z4.string()),
});
export type McpWriteResult = z4.infer<typeof McpWriteResultSchema>;

// ── Phase 9d: Wissensqualität und Richtlinienauswertung ──────────────────────

export const McpEvaluationTargetSchema = z4.object({
  vcpus: z4.number().int().positive().optional(),
  ramMb: z4.number().int().positive().optional(),
  backupEnabled: z4.boolean().optional(),
  ports: z4.array(z4.number().int().min(1).max(65_535)).max(500).default([]),
  networks: z4.array(z4.string().trim().min(1).max(200)).max(100).default([]),
  name: z4.string().trim().min(1).max(500).optional(),
  categoryId: z4.string().uuid().optional(),
});
export type McpEvaluationTarget = z4.infer<typeof McpEvaluationTargetSchema>;

export const McpEvaluateStandardsInputSchema = z4.object({
  target: McpEvaluationTargetSchema,
  standardIds: z4.array(z4.string().uuid()).min(1).max(50).optional(),
  includeShould: z4.boolean().default(true),
});
export type McpEvaluateStandardsInput = z4.infer<typeof McpEvaluateStandardsInputSchema>;

export const McpStandardCheckSchema = z4.object({
  standardId: z4.string().uuid(),
  ruleId: z4.string().uuid(),
  rule: z4.string(),
  type: z4.enum(['must', 'should', 'may', 'must_not']),
  result: z4.enum(['pass', 'fail', 'unknown', 'not_applicable']),
  expected: z4.string().nullable(),
  actual: z4.string().nullable(),
  reason: z4.string(),
});
export type McpStandardCheck = z4.infer<typeof McpStandardCheckSchema>;

export const McpEvaluateStandardsOutputSchema = z4.object({
  result: z4.enum(['compliant', 'non_compliant', 'unknown']),
  checks: z4.array(McpStandardCheckSchema),
  unknownChecks: z4.array(McpStandardCheckSchema),
  sources: z4.array(McpKnowledgeSourceSchema),
  conflicts: z4.array(McpKnowledgeConflictSchema),
  warnings: z4.array(z4.string()),
});
export type McpEvaluateStandardsOutput = z4.infer<typeof McpEvaluateStandardsOutputSchema>;

export const McpDetectConflictsInputSchema = z4.object({
  standardIds: z4.array(z4.string().uuid()).min(2).max(50).optional(),
  categoryId: z4.string().uuid().optional(),
});
export type McpDetectConflictsInput = z4.infer<typeof McpDetectConflictsInputSchema>;

export const McpDetectConflictsOutputSchema = z4.object({
  conflicts: z4.array(McpKnowledgeConflictSchema),
  sources: z4.array(McpKnowledgeSourceSchema),
  warnings: z4.array(z4.string()),
});
export type McpDetectConflictsOutput = z4.infer<typeof McpDetectConflictsOutputSchema>;

export const McpClassifyContentInputSchema = z4.object({
  title: z4.string().trim().max(200).optional(),
  content: z4.string().trim().min(1).max(100_000),
});
export type McpClassifyContentInput = z4.infer<typeof McpClassifyContentInputSchema>;

export const McpClassificationSuggestionSchema = z4.object({
  suggestedType: McpKnowledgeKindSchema,
  confidence: z4.number().min(0).max(1),
  reason: z4.string(),
  qualityScore: z4.number().min(0).max(1),
  maturityScore: z4.number().min(0).max(1),
  sensitivity: z4.enum(['low', 'medium', 'high']),
  provider: z4.string(),
});
export type McpClassificationSuggestion = z4.infer<typeof McpClassificationSuggestionSchema>;

export const McpClassifyContentOutputSchema = z4.object({
  result: McpClassificationSuggestionSchema,
  warnings: z4.array(z4.string()),
});
export type McpClassifyContentOutput = z4.infer<typeof McpClassifyContentOutputSchema>;

export const McpSuggestTagsInputSchema = McpClassifyContentInputSchema.extend({
  type: McpKnowledgeKindSchema,
  limit: z4.number().int().positive().max(20).default(8),
});
export type McpSuggestTagsInput = z4.infer<typeof McpSuggestTagsInputSchema>;

export const McpTagSuggestionSchema = z4.object({
  name: z4.string(),
  score: z4.number().min(0).max(1),
  reason: z4.string(),
});
export type McpTagSuggestion = z4.infer<typeof McpTagSuggestionSchema>;

export const McpSuggestTagsOutputSchema = z4.object({
  results: z4.array(McpTagSuggestionSchema),
  warnings: z4.array(z4.string()),
});
export type McpSuggestTagsOutput = z4.infer<typeof McpSuggestTagsOutputSchema>;

export const McpSuggestCategoryInputSchema = McpClassifyContentInputSchema.extend({
  type: McpKnowledgeKindSchema,
  limit: z4.number().int().positive().max(10).default(5),
});
export type McpSuggestCategoryInput = z4.infer<typeof McpSuggestCategoryInputSchema>;

export const McpCategorySuggestionSchema = z4.object({
  id: z4.string().uuid(),
  name: z4.string(),
  slug: z4.string(),
  score: z4.number().min(0).max(1),
  reason: z4.string(),
});
export type McpCategorySuggestion = z4.infer<typeof McpCategorySuggestionSchema>;

export const McpSuggestCategoryOutputSchema = z4.object({
  results: z4.array(McpCategorySuggestionSchema),
  warnings: z4.array(z4.string()),
});
export type McpSuggestCategoryOutput = z4.infer<typeof McpSuggestCategoryOutputSchema>;
