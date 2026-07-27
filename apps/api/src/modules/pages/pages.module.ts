import { Module } from "@nestjs/common";
import { PagesController } from "@/modules/pages/pages.controller";
import { PagesService } from "@/modules/pages/pages.service";
import { AuthModule } from "@/modules/auth/auth.module";
import { SpacesModule } from "@/modules/spaces/spaces.module";
import { ResourceAclsModule } from "@/modules/resource-acls/resource-acls.module";

/** Modul für die Verwaltung von Seiten, Ordnern und deren Versionen. */
@Module({
  imports: [AuthModule, SpacesModule, ResourceAclsModule],
  controllers: [PagesController],
  providers: [PagesService],
  exports: [PagesService],
})
export class PagesModule {}
