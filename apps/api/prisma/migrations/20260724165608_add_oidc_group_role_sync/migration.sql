-- AlterTable
ALTER TABLE "external_identities" ADD COLUMN     "last_group_claims" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "last_role_claims" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "external_role_grants" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "external_identity_id" TEXT NOT NULL,
    "role_mapping_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,

    CONSTRAINT "external_role_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "external_role_grants_external_identity_id_key" ON "external_role_grants"("external_identity_id");

-- CreateIndex
CREATE INDEX "external_role_grants_role_mapping_id_idx" ON "external_role_grants"("role_mapping_id");

-- CreateIndex
CREATE INDEX "external_role_grants_role_id_idx" ON "external_role_grants"("role_id");

-- AddForeignKey
ALTER TABLE "external_role_grants" ADD CONSTRAINT "external_role_grants_external_identity_id_fkey" FOREIGN KEY ("external_identity_id") REFERENCES "external_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_role_grants" ADD CONSTRAINT "external_role_grants_role_mapping_id_fkey" FOREIGN KEY ("role_mapping_id") REFERENCES "identity_provider_role_mappings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_role_grants" ADD CONSTRAINT "external_role_grants_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
