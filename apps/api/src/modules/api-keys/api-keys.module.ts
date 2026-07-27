import { Global, Module } from "@nestjs/common";
import { ApiKeysController } from "@/modules/api-keys/api-keys.controller";
import { ApiKeysService } from "@/modules/api-keys/api-keys.service";
import { ApiKeyGuard } from "@/modules/api-keys/guards/api-key.guard";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";
import { HealthModule } from "@/health/health.module";

@Global()
@Module({
  imports: [HealthModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyGuard, JwtAuthGuard, JwtOrApiKeyGuard],
  exports: [ApiKeysService, ApiKeyGuard, JwtAuthGuard, JwtOrApiKeyGuard],
})
export class ApiKeysModule {}
