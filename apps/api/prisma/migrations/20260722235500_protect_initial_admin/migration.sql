ALTER TABLE "users"
ADD COLUMN "is_protected" BOOLEAN NOT NULL DEFAULT false;

-- Es darf hoechstens ein als Setup-Admin geschuetztes Konto geben.
CREATE UNIQUE INDEX "users_single_protected_account"
ON "users" ("is_protected")
WHERE "is_protected" = true;
