import { Module } from "@nestjs/common";
import { PrismaModule } from "@/prisma/prisma.module";
import { ResourceAclsModule } from "@/modules/resource-acls/resource-acls.module";
import { SearchController } from "@/modules/search/search.controller";
import { SearchService } from "@/modules/search/search.service";

/** Modul für die Volltextsuche über Seiten. */
@Module({
  imports: [PrismaModule, ResourceAclsModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
