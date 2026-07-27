import { Module } from "@nestjs/common";
import { AuthModule } from "@/modules/auth/auth.module";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationEncryptionService } from "./integration-encryption.service";
import { MicrosoftGraphService } from "./microsoft-graph.service";
import { MicrosoftIntegrationService } from "./microsoft-integration.service";

@Module({
  imports: [AuthModule],
  controllers: [IntegrationsController],
  providers: [IntegrationEncryptionService, MicrosoftGraphService, MicrosoftIntegrationService],
  exports: [MicrosoftIntegrationService],
})
export class IntegrationsModule {}
