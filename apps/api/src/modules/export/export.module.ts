import { Module } from "@nestjs/common";
import { AuthModule } from "@/modules/auth/auth.module";
import { ExportController } from "@/modules/export/export.controller";
import { ExportService } from "@/modules/export/export.service";
import { ResourceAclsModule } from "@/modules/resource-acls/resource-acls.module";

@Module({
  imports: [AuthModule, ResourceAclsModule],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
