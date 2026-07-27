import { Module } from "@nestjs/common";
import { AuthModule } from "@/modules/auth/auth.module";
import { ResourceAccessService } from "@/modules/resource-acls/resource-access.service";
import { ResourceAclService } from "@/modules/resource-acls/resource-acl.service";
import { ResourceAclsController } from "@/modules/resource-acls/resource-acls.controller";
import { ResourceTargetService } from "@/modules/resource-acls/resource-target.service";

@Module({
  imports: [AuthModule],
  controllers: [ResourceAclsController],
  providers: [ResourceAclService, ResourceAccessService, ResourceTargetService],
  exports: [ResourceAccessService, ResourceTargetService],
})
export class ResourceAclsModule {}
