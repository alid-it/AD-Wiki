-- CreateEnum
CREATE TYPE "ResourceAclEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateTable
CREATE TABLE "resource_acl_entries" (
    "id" TEXT NOT NULL,
    "recipient_key" TEXT NOT NULL,
    "target_key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "effect" "ResourceAclEffect" NOT NULL,
    "inherit_to_children" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT,
    "group_id" TEXT,
    "space_id" TEXT,
    "category_id" TEXT,
    "page_id" TEXT,
    "note_id" TEXT,
    "standard_id" TEXT,

    CONSTRAINT "resource_acl_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "resource_acl_entries_one_recipient_check"
      CHECK (num_nonnulls("user_id", "group_id") = 1),
    CONSTRAINT "resource_acl_entries_recipient_key_check"
      CHECK (
        ("user_id" IS NOT NULL AND "recipient_key" = 'user:' || "user_id")
        OR
        ("group_id" IS NOT NULL AND "recipient_key" = 'group:' || "group_id")
      ),
    CONSTRAINT "resource_acl_entries_one_target_check"
      CHECK (
        num_nonnulls(
          "space_id",
          "category_id",
          "page_id",
          "note_id",
          "standard_id"
        ) = 1
      ),
    CONSTRAINT "resource_acl_entries_target_key_check"
      CHECK (
        ("space_id" IS NOT NULL AND "target_key" = 'space:' || "space_id")
        OR
        ("category_id" IS NOT NULL AND "target_key" = 'category:' || "category_id")
        OR
        ("page_id" IS NOT NULL AND "target_key" = 'page:' || "page_id")
        OR
        ("note_id" IS NOT NULL AND "target_key" = 'note:' || "note_id")
        OR
        ("standard_id" IS NOT NULL AND "target_key" = 'standard:' || "standard_id")
      ),
    CONSTRAINT "resource_acl_entries_action_check"
      CHECK (
        "action" IN (
          'create',
          'read',
          'update',
          'delete',
          'share',
          'approve',
          'run',
          'restore',
          'assign_role',
          'reset_password',
          'purge',
          'test',
          'manage_members'
        )
      )
);

-- CreateTable
CREATE TABLE "resource_acl_boundaries" (
    "id" TEXT NOT NULL,
    "target_key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "space_id" TEXT,
    "category_id" TEXT,
    "page_id" TEXT,
    "note_id" TEXT,
    "standard_id" TEXT,

    CONSTRAINT "resource_acl_boundaries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "resource_acl_boundaries_one_target_check"
      CHECK (
        num_nonnulls(
          "space_id",
          "category_id",
          "page_id",
          "note_id",
          "standard_id"
        ) = 1
      ),
    CONSTRAINT "resource_acl_boundaries_target_key_check"
      CHECK (
        ("space_id" IS NOT NULL AND "target_key" = 'space:' || "space_id")
        OR
        ("category_id" IS NOT NULL AND "target_key" = 'category:' || "category_id")
        OR
        ("page_id" IS NOT NULL AND "target_key" = 'page:' || "page_id")
        OR
        ("note_id" IS NOT NULL AND "target_key" = 'note:' || "note_id")
        OR
        ("standard_id" IS NOT NULL AND "target_key" = 'standard:' || "standard_id")
      ),
    CONSTRAINT "resource_acl_boundaries_action_check"
      CHECK (
        "action" IN (
          'create',
          'read',
          'update',
          'delete',
          'share',
          'approve',
          'run',
          'restore',
          'assign_role',
          'reset_password',
          'purge',
          'test',
          'manage_members'
        )
      )
);

-- CreateIndex
CREATE UNIQUE INDEX "resource_acl_entries_recipient_key_target_key_action_key"
  ON "resource_acl_entries"("recipient_key", "target_key", "action");
CREATE INDEX "resource_acl_entries_user_id_action_idx"
  ON "resource_acl_entries"("user_id", "action");
CREATE INDEX "resource_acl_entries_group_id_action_idx"
  ON "resource_acl_entries"("group_id", "action");
CREATE INDEX "resource_acl_entries_target_key_action_idx"
  ON "resource_acl_entries"("target_key", "action");
CREATE UNIQUE INDEX "resource_acl_boundaries_target_key_action_key"
  ON "resource_acl_boundaries"("target_key", "action");
CREATE INDEX "resource_acl_boundaries_target_key_action_idx"
  ON "resource_acl_boundaries"("target_key", "action");

-- AddForeignKey
ALTER TABLE "resource_acl_entries"
  ADD CONSTRAINT "resource_acl_entries_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resource_acl_entries"
  ADD CONSTRAINT "resource_acl_entries_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "groups"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_acl_entries"
  ADD CONSTRAINT "resource_acl_entries_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "knowledge_spaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resource_acl_entries"
  ADD CONSTRAINT "resource_acl_entries_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resource_acl_entries"
  ADD CONSTRAINT "resource_acl_entries_page_id_fkey"
  FOREIGN KEY ("page_id") REFERENCES "pages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resource_acl_entries"
  ADD CONSTRAINT "resource_acl_entries_note_id_fkey"
  FOREIGN KEY ("note_id") REFERENCES "notes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resource_acl_entries"
  ADD CONSTRAINT "resource_acl_entries_standard_id_fkey"
  FOREIGN KEY ("standard_id") REFERENCES "standards"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "resource_acl_boundaries"
  ADD CONSTRAINT "resource_acl_boundaries_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "knowledge_spaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resource_acl_boundaries"
  ADD CONSTRAINT "resource_acl_boundaries_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resource_acl_boundaries"
  ADD CONSTRAINT "resource_acl_boundaries_page_id_fkey"
  FOREIGN KEY ("page_id") REFERENCES "pages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resource_acl_boundaries"
  ADD CONSTRAINT "resource_acl_boundaries_note_id_fkey"
  FOREIGN KEY ("note_id") REFERENCES "notes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resource_acl_boundaries"
  ADD CONSTRAINT "resource_acl_boundaries_standard_id_fkey"
  FOREIGN KEY ("standard_id") REFERENCES "standards"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
