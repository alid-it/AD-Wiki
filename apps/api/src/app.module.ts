import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";
import { getThrottlerConfig } from "@/common/config/throttler.config";
import { AppThrottlerGuard } from "@/common/guards/throttler.guard";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { AuditModule } from "@/modules/audit/audit.module";
import { WebsocketModule } from "@/modules/websocket/websocket.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { CategoriesModule } from "@/modules/categories/categories.module";
import { PagesModule } from "@/modules/pages/pages.module";
import { MediaModule } from "@/modules/media/media.module";
import { SearchModule } from "@/modules/search/search.module";
import { UsersModule } from "@/modules/users/users.module";
import { AclsModule } from "@/modules/acls/acls.module";
import { SettingsModule } from "@/modules/settings/settings.module";
import { NotesModule } from "@/modules/notes/notes.module";
import { StandardsModule } from "@/modules/standards/standards.module";
import { McpModule } from "@/modules/mcp/mcp.module";
import { IntegrationsModule } from "@/modules/integrations/integrations.module";
import { ExportModule } from "@/modules/export/export.module";
import { ApiKeysModule } from "@/modules/api-keys/api-keys.module";
import { BackupsModule } from "@/modules/backups/backups.module";
import { BackupCoordinationModule } from "@/modules/backups/backup-coordination.module";
import { BackupWriteBarrierInterceptor } from "@/modules/backups/backup-write-barrier.interceptor";
import { RequestLoggingInterceptor } from "@/common/logging/request-logging.interceptor";
import { PublicApiErrorFilter } from "@/common/public-api-error.filter";
import { GroupsModule } from "@/modules/groups/groups.module";
import { PermissionsModule } from "@/modules/auth/permissions.module";
import { SpacesModule } from "@/modules/spaces/spaces.module";
import { ResourceAclsModule } from "@/modules/resource-acls/resource-acls.module";

/**
 * Wurzel-Modul der Anwendung.
 * Bindet die globalen Infrastruktur- sowie die Feature-Module ein.
 */
@Module({
  imports: [
    // Globales Rate-Limiting (konfigurierbar über THROTTLE_TTL / THROTTLE_LIMIT).
    ThrottlerModule.forRoot([
      { ...getThrottlerConfig() },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    PermissionsModule,
    BackupCoordinationModule,
    HealthModule,
    AuditModule,
    WebsocketModule,
    AuthModule,
    CategoriesModule,
    PagesModule,
    MediaModule,
    SearchModule,
    UsersModule,
    AclsModule,
    SettingsModule,
    NotesModule,
    StandardsModule,
    McpModule,
    IntegrationsModule,
    ExportModule,
    ApiKeysModule,
    BackupsModule,
    GroupsModule,
    SpacesModule,
    ResourceAclsModule,
    // Weitere Feature-Module folgen:
    // TagsModule, ...
  ],
  providers: [
    // Rate-Limiting global aktivieren (pro Benutzer bzw. pro IP).
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_FILTER, useClass: PublicApiErrorFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: BackupWriteBarrierInterceptor },
  ],
})
export class AppModule {}
