-- CreateTable
CREATE TABLE "knowledge_change_requests" (
    "id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "proposed_data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requested_by" TEXT NOT NULL,
    "reviewed_by" TEXT,

    CONSTRAINT "knowledge_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_change_requests_resource_type_resource_id_idx"
ON "knowledge_change_requests"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "knowledge_change_requests_status_created_at_idx"
ON "knowledge_change_requests"("status", "created_at");

-- AddForeignKey
ALTER TABLE "knowledge_change_requests"
ADD CONSTRAINT "knowledge_change_requests_requested_by_fkey"
FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_change_requests"
ADD CONSTRAINT "knowledge_change_requests_reviewed_by_fkey"
FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
