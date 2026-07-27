import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Zentraler Datenbank-Zugriff.
 * Erweitert den PrismaClient und verwaltet dessen Verbindungs-Lifecycle
 * über die NestJS-Lifecycle-Hooks.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // Prisma 7 nutzt Driver-Adapter statt der internen Engine. Die
    // Verbindungs-URL steht in der schema.prisma nicht im datasource-Block,
    // sondern in prisma.config.ts (nur CLI) – zur Laufzeit muss sie daher
    // über den PostgreSQL-Adapter explizit übergeben werden.
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }

  /** Baut die Datenbankverbindung beim Start des Moduls auf. */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /** Schließt die Datenbankverbindung beim Herunterfahren sauber. */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
