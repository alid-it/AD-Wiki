import { Global, Module } from "@nestjs/common";
import { EffectiveRoleService } from "@/modules/auth/effective-role.service";
import { PermissionService } from "@/modules/auth/permission.service";

/** Globale Auswertung der Rollenrechte, User-Overrides und API-Key-Grenzen. */
@Global()
@Module({
  providers: [EffectiveRoleService, PermissionService],
  exports: [EffectiveRoleService, PermissionService],
})
export class PermissionsModule {}
