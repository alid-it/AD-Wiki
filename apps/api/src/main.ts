// Lädt die Variablen aus .env in process.env, bevor die App startet.
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { RequestMethod } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { createApplicationLogger } from "@/common/logging/structured-logger";

/** Port, auf dem die API lauscht. */
const PORT = 4000;

/**
 * Einstiegspunkt der Anwendung.
 * Initialisiert die NestJS-App, konfiguriert globalen Prefix,
 * CORS und die Swagger-Dokumentation und startet den Server.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: createApplicationLogger() });

  const trustProxy = Number(process.env.TRUST_PROXY_HOPS ?? "0");
  if (Number.isSafeInteger(trustProxy) && trustProxy > 0) app.set("trust proxy", trustProxy);

  // Alle Routen unter /api/v1 verfügbar machen.
  app.setGlobalPrefix("api/v1", {
    exclude: [
      { path: "mcp", method: RequestMethod.ALL },
      { path: ".well-known/{*path}", method: RequestMethod.ALL },
      { path: "oauth/{*path}", method: RequestMethod.ALL },
    ],
  });

  // CORS aktivieren, damit Web- und spätere Mobile-Clients zugreifen können.
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? process.env.WEB_URL ?? "http://localhost:3000")
    .split(",").map((value) => value.trim().replace(/\/$/, "")).filter(Boolean);
  app.enableCors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin.replace(/\/$/, ""))),
    credentials: true,
    exposedHeaders: ["Mcp-Session-Id", "MCP-Protocol-Version", "Content-Disposition", "Content-Length", "X-Export-Items"],
  });

  // Swagger/OpenAPI-Dokumentation aufbauen.
  const swaggerConfig = new DocumentBuilder()
    .setTitle("AD-Wiki API")
    .setDescription("REST-API der AD-Wiki-Plattform")
    .setVersion("1.0")
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // Dokumentation erreichbar unter /api/docs.
  SwaggerModule.setup("api/docs", app, document);

  await app.listen(PORT);
}

void bootstrap();
