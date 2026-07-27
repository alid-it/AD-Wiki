import { Module, type OnModuleInit } from "@nestjs/common";
import { PrismaModule } from "@/prisma/prisma.module";
import { MediaController } from "@/modules/media/media.controller";
import { MediaService } from "@/modules/media/media.service";
import { ensureUploadDir } from "@/modules/media/media.config";
import { PagesModule } from "@/modules/pages/pages.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { MediaFileGuard } from "@/modules/media/guards/media-file.guard";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";
import { ResourceAclsModule } from "@/modules/resource-acls/resource-acls.module";

/** Modul für Datei-Uploads und deren Verwaltung. */
@Module({
  imports: [PrismaModule, PagesModule, AuthModule, ResourceAclsModule],
  controllers: [MediaController],
  providers: [MediaService, MediaFileGuard, JwtAuthGuard],
  exports: [MediaService],
})
export class MediaModule implements OnModuleInit {
  /** Stellt beim Start sicher, dass der Upload-Ordner existiert. */
  onModuleInit(): void {
    ensureUploadDir();
  }
}
