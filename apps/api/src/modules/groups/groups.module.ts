import { Module } from "@nestjs/common";
import { AuthModule } from "@/modules/auth/auth.module";
import { GroupsController } from "@/modules/groups/groups.controller";
import { GroupsService } from "@/modules/groups/groups.service";

/** Gruppen und Mitgliedschaften als Grundlage für Ressourcen-ACLs. */
@Module({
  imports: [AuthModule],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}
