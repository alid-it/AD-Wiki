import { Module } from "@nestjs/common";
import { AuthModule } from "@/modules/auth/auth.module";
import { SpacesController } from "@/modules/spaces/spaces.controller";
import { SpacesService } from "@/modules/spaces/spaces.service";
import { ResourceAclsModule } from "@/modules/resource-acls/resource-acls.module";

@Module({
  imports: [AuthModule, ResourceAclsModule],
  controllers: [SpacesController],
  providers: [SpacesService],
  exports: [SpacesService],
})
export class SpacesModule {}
