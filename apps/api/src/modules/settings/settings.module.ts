import { forwardRef, Module } from "@nestjs/common";
import { SettingsController } from "@/modules/settings/settings.controller";
import { SettingsService } from "@/modules/settings/settings.service";
import { SmtpCredentialEncryptionService } from "@/modules/settings/smtp-credential-encryption.service";
import { SmtpService } from "@/modules/settings/smtp.service";
import { AuthModule } from "@/modules/auth/auth.module";
import { HealthModule } from "@/health/health.module";

/** Modul für die plattformweiten Einstellungen. */
@Module({
  imports: [forwardRef(() => AuthModule), HealthModule],
  controllers: [SettingsController],
  providers: [SettingsService, SmtpCredentialEncryptionService, SmtpService],
  exports: [SettingsService, SmtpService],
})
export class SettingsModule {}
