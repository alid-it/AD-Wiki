import { Module } from "@nestjs/common";
import { AclsController } from "@/modules/acls/acls.controller";
import { AclsService } from "@/modules/acls/acls.service";

/** Modul für rollenbasierte ACLs und individuelle User-Permissions. */
@Module({
  controllers: [AclsController],
  providers: [AclsService],
  exports: [AclsService],
})
export class AclsModule {}
