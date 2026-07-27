-- CreateEnum
CREATE TYPE "EntraGraphMembershipMode" AS ENUM ('DIRECT', 'TRANSITIVE');

-- AlterTable
ALTER TABLE "identity_providers" ADD COLUMN     "entra_graph_cache_ttl_minutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "entra_graph_fallback_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "entra_graph_membership_mode" "EntraGraphMembershipMode" NOT NULL DEFAULT 'TRANSITIVE';
