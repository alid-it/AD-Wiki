CREATE TYPE "StandardStatus" AS ENUM ('DRAFT', 'REVIEW', 'ACTIVE', 'DEPRECATED');
CREATE TYPE "StandardPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "StandardRuleType" AS ENUM ('MUST', 'SHOULD', 'MAY', 'MUST_NOT');
CREATE TYPE "StandardExceptionStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'EXPIRED');

CREATE TABLE "standards" (
  "id" TEXT NOT NULL, "title" TEXT NOT NULL, "slug" TEXT NOT NULL,
  "description" TEXT NOT NULL, "justification" TEXT NOT NULL,
  "status" "StandardStatus" NOT NULL DEFAULT 'DRAFT',
  "priority" "StandardPriority" NOT NULL DEFAULT 'MEDIUM', "version" INTEGER NOT NULL DEFAULT 1,
  "mcp_visible" BOOLEAN NOT NULL DEFAULT false, "valid_from" TIMESTAMP(3), "valid_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by" TEXT NOT NULL, "responsible_id" TEXT NOT NULL, "category_id" TEXT,
  "classification_confidence" DOUBLE PRECISION, "classification_reason" TEXT,
  "quality_score" DOUBLE PRECISION, "maturity_score" DOUBLE PRECISION, "sensitivity" "KnowledgeSensitivity",
  "contradictions" JSONB NOT NULL DEFAULT '[]', "suggested_title" TEXT,
  "suggested_tags" JSONB NOT NULL DEFAULT '[]', "suggested_category_id" TEXT,
  "conversion_suggestion" TEXT, "assessed_at" TIMESTAMP(3),
  CONSTRAINT "standards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "standards_slug_key" ON "standards"("slug");
CREATE INDEX "standards_status_priority_idx" ON "standards"("status", "priority");
CREATE INDEX "standards_category_id_idx" ON "standards"("category_id");

CREATE TABLE "standard_rules" (
  "id" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT,
  "type" "StandardRuleType" NOT NULL DEFAULT 'MUST', "sort_order" INTEGER NOT NULL DEFAULT 0,
  "min_vcpu" INTEGER, "min_ram_mb" INTEGER, "backup_required" BOOLEAN,
  "allowed_ports" JSONB NOT NULL DEFAULT '[]', "allowed_networks" JSONB NOT NULL DEFAULT '[]',
  "naming_convention" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, "standard_id" TEXT NOT NULL,
  CONSTRAINT "standard_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "standard_rules_standard_id_sort_order_idx" ON "standard_rules"("standard_id", "sort_order");

CREATE TABLE "standard_versions" (
  "id" TEXT NOT NULL, "version" INTEGER NOT NULL, "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "standard_id" TEXT NOT NULL, "author_id" TEXT NOT NULL,
  CONSTRAINT "standard_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "standard_versions_standard_id_version_key" ON "standard_versions"("standard_id", "version");

CREATE TABLE "standard_page_links" (
  "standard_id" TEXT NOT NULL, "page_id" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "standard_page_links_pkey" PRIMARY KEY ("standard_id", "page_id")
);
CREATE INDEX "standard_page_links_page_id_idx" ON "standard_page_links"("page_id");

CREATE TABLE "standard_exceptions" (
  "id" TEXT NOT NULL, "reason" TEXT NOT NULL,
  "status" "StandardExceptionStatus" NOT NULL DEFAULT 'REQUESTED', "expires_at" TIMESTAMP(3), "decision_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  "standard_id" TEXT NOT NULL, "requested_by" TEXT NOT NULL, "responsible_id" TEXT NOT NULL, "decided_by" TEXT,
  CONSTRAINT "standard_exceptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "standard_exceptions_standard_id_status_idx" ON "standard_exceptions"("standard_id", "status");

ALTER TABLE "standards" ADD CONSTRAINT "standards_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "standards" ADD CONSTRAINT "standards_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "standards" ADD CONSTRAINT "standards_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "standard_rules" ADD CONSTRAINT "standard_rules_standard_id_fkey" FOREIGN KEY ("standard_id") REFERENCES "standards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "standard_versions" ADD CONSTRAINT "standard_versions_standard_id_fkey" FOREIGN KEY ("standard_id") REFERENCES "standards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "standard_versions" ADD CONSTRAINT "standard_versions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "standard_page_links" ADD CONSTRAINT "standard_page_links_standard_id_fkey" FOREIGN KEY ("standard_id") REFERENCES "standards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "standard_page_links" ADD CONSTRAINT "standard_page_links_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "standard_exceptions" ADD CONSTRAINT "standard_exceptions_standard_id_fkey" FOREIGN KEY ("standard_id") REFERENCES "standards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "standard_exceptions" ADD CONSTRAINT "standard_exceptions_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "standard_exceptions" ADD CONSTRAINT "standard_exceptions_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "standard_exceptions" ADD CONSTRAINT "standard_exceptions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
