import { forwardRef, Module } from "@nestjs/common";
import { JwtModule, type JwtSignOptions } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { getJwtSecret } from "@/common/config/jwt.config";
import { PrismaModule } from "@/prisma/prisma.module";
import { SettingsModule } from "@/modules/settings/settings.module";
import { AuthController } from "@/modules/auth/auth.controller";
import { AuthService } from "@/modules/auth/auth.service";
import { JwtStrategy } from "@/modules/auth/strategies/jwt.strategy";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import { HealthModule } from "@/health/health.module";
import { OidcController } from "@/modules/auth/oidc/oidc.controller";
import { IdentityProviderAdminController } from "@/modules/auth/oidc/identity-provider-admin.controller";
import { EntraGroupCacheService } from "@/modules/auth/oidc/entra-group-cache.service";
import { EntraGroupResolverService } from "@/modules/auth/oidc/entra-group-resolver.service";
import { IdentitySynchronizationService } from "@/modules/auth/oidc/identity-synchronization.service";
import { IdentityProviderOperationService } from "@/modules/auth/oidc/identity-provider-operation.service";
import { IdentityProviderAdminService } from "@/modules/auth/oidc/identity-provider-admin.service";
import { OidcSecretEncryptionService } from "@/modules/auth/oidc/oidc-secret-encryption.service";
import { OidcService } from "@/modules/auth/oidc/oidc.service";

/**
 * Auth-Modul: Registrierung, Login, Token-Erneuerung und Logout.
 *
 * JWT-Secret stammt aus JWT_SECRET (Pflicht, kein Fallback – siehe
 * getJwtSecret). Access-Tokens laufen nach 15min ab,
 * Refresh-Tokens (als Session in der DB) nach 7 Tagen – die konkrete
 * Refresh-Laufzeit wird beim Signieren im AuthService gesetzt.
 */
@Module({
  imports: [
    PrismaModule,
    HealthModule,
    forwardRef(() => SettingsModule),
    PassportModule,
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: {
        expiresIn: (process.env.JWT_EXPIRES_IN ?? "15m") as JwtSignOptions["expiresIn"],
      },
    }),
  ],
  controllers: [AuthController, OidcController, IdentityProviderAdminController],
  providers: [
    AuthService,
    OidcService,
    EntraGroupCacheService,
    EntraGroupResolverService,
    IdentityProviderOperationService,
    IdentityProviderAdminService,
    IdentitySynchronizationService,
    OidcSecretEncryptionService,
    JwtStrategy,
    AclGuard,
  ],
  exports: [
    AuthService,
    OidcSecretEncryptionService,
    IdentitySynchronizationService,
    AclGuard,
  ],
})
export class AuthModule {}
