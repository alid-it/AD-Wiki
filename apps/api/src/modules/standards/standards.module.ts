import { Module } from "@nestjs/common";
import { StandardsController } from "./standards.controller";
import { StandardsService } from "./standards.service";
import { SpacesModule } from "@/modules/spaces/spaces.module";
import { ResourceAclsModule } from "@/modules/resource-acls/resource-acls.module";

@Module({ imports: [SpacesModule, ResourceAclsModule], controllers: [StandardsController], providers: [StandardsService], exports: [StandardsService] })
export class StandardsModule {}
