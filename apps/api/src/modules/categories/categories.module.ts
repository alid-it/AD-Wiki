import { Module } from "@nestjs/common";
import { CategoriesController } from "@/modules/categories/categories.controller";
import { CategoriesService } from "@/modules/categories/categories.service";
import { AuthModule } from "@/modules/auth/auth.module";
import { SpacesModule } from "@/modules/spaces/spaces.module";
import { ResourceAclsModule } from "@/modules/resource-acls/resource-acls.module";

/** Modul für die Verwaltung von Kategorien. */
@Module({
  imports: [AuthModule, SpacesModule, ResourceAclsModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
