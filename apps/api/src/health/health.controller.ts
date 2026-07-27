import { Controller, Get, Headers, HttpCode, Res, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { PrismaService } from "@/prisma/prisma.service";
import { MonitoringService } from "./monitoring.service";

/**
 * Health-Check-Endpoint.
 * Dient dazu, schnell zu prüfen, ob die API erreichbar ist und läuft.
 */
@ApiTags("Health")
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly monitoring: MonitoringService) {}

  /** Liefert den aktuellen Status der API samt Zeitstempel. */
  @Get()
  @ApiOperation({ summary: "Prüft, ob die API läuft" })
  check(): { status: string; timestamp: string } {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("live")
  live(): { status: string; timestamp: string } { return this.check(); }

  @Get("ready")
  async ready(): Promise<{ status: string; timestamp: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.check();
    } catch {
      throw new ServiceUnavailableException("Datenbank ist nicht bereit.");
    }
  }

  @Get("metrics")
  @HttpCode(200)
  async metrics(@Headers("authorization") authorization: string | undefined, @Res() res: Response): Promise<void> {
    requireMonitoringToken(authorization);
    res.type("text/plain; version=0.0.4; charset=utf-8").send(await this.monitoring.prometheus());
  }
}

function requireMonitoringToken(authorization: string | undefined): void {
  const expected = process.env.MONITORING_TOKEN?.trim();
  if (!expected && process.env.NODE_ENV !== "production") return;
  if (!expected || !authorization?.startsWith("Bearer ")) throw new UnauthorizedException();
  const left = Buffer.from(authorization.slice(7));
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new UnauthorizedException();
}
