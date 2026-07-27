import { Module } from "@nestjs/common";
import { AuthModule } from "@/modules/auth/auth.module";
import { PagesModule } from "@/modules/pages/pages.module";
import { NotesController } from "@/modules/notes/notes.controller";
import { NotesService } from "@/modules/notes/notes.service";
import { IntegrationsModule } from "@/modules/integrations/integrations.module";
import { SpacesModule } from "@/modules/spaces/spaces.module";
import { ResourceAclsModule } from "@/modules/resource-acls/resource-acls.module";

@Module({
  imports: [AuthModule, PagesModule, IntegrationsModule, SpacesModule, ResourceAclsModule],
  controllers: [NotesController],
  providers: [NotesService],
  exports: [NotesService],
})
export class NotesModule {}
