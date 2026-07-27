import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/**
 * Globales Modul, das den PrismaService bereitstellt.
 * Durch @Global muss es nur einmal importiert werden und ist
 * anschließend in allen Feature-Modulen ohne erneuten Import verfügbar.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
