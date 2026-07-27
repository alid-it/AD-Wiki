ALTER TABLE "pages"
  ADD COLUMN "knowledge_type" "KnowledgeKind" NOT NULL DEFAULT 'WIKI',
  ADD COLUMN "knowledge_priority" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "notes"
  ADD COLUMN "knowledge_type" "KnowledgeKind" NOT NULL DEFAULT 'NOTE',
  ADD COLUMN "knowledge_priority" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "standards"
  ADD COLUMN "knowledge_type" "KnowledgeKind" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "knowledge_priority" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "pages" ADD CONSTRAINT "pages_fixed_knowledge_rank"
  CHECK ("knowledge_type" = 'WIKI' AND "knowledge_priority" = 2);
ALTER TABLE "notes" ADD CONSTRAINT "notes_fixed_knowledge_rank"
  CHECK ("knowledge_type" = 'NOTE' AND "knowledge_priority" = 3);
ALTER TABLE "standards" ADD CONSTRAINT "standards_fixed_knowledge_rank"
  CHECK ("knowledge_type" = 'STANDARD' AND "knowledge_priority" = 1);

CREATE INDEX "pages_knowledge_priority_idx" ON "pages"("knowledge_priority");
CREATE INDEX "notes_knowledge_priority_idx" ON "notes"("knowledge_priority");
CREATE INDEX "standards_knowledge_priority_idx" ON "standards"("knowledge_priority");
