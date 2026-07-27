import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import { LoginSchema } from "@ad-wiki/shared-types";
import { publicErrorFromException } from "../../dist/common/public-api-error.filter.js";
import { ZodValidationPipe } from "../../dist/common/pipes/zod-validation.pipe.js";
import { AuthService } from "../../dist/modules/auth/auth.service.js";

type AuthPrisma = ConstructorParameters<typeof AuthService>[0];
type JwtDependency = ConstructorParameters<typeof AuthService>[1];
type SettingsDependency = ConstructorParameters<typeof AuthService>[2];
type AuditDependency = ConstructorParameters<typeof AuthService>[3];
type SmtpDependency = ConstructorParameters<typeof AuthService>[4];

test("Zod-Validierung liefert nur bewusst formulierte Feldmeldungen", () => {
  const pipe = new ZodValidationPipe(LoginSchema);
  let caught: unknown;
  try {
    pipe.transform({ email: "keine-mail", password: "kurz" });
  } catch (error) {
    caught = error;
  }

  const result = publicErrorFromException(caught);
  const serialized = JSON.stringify(result.body);
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, "VALIDATION_FAILED");
  assert.match(serialized, /gültige E-Mail-Adresse/);
  assert.match(serialized, /mindestens 8 Zeichen/);
  assert.doesNotMatch(serialized, /String must contain|Invalid input|Zod|expected|received/i);
});

test("interne und Framework-Fehler werden in API-Antworten vollständig verborgen", () => {
  const internal = publicErrorFromException(
    new InternalServerErrorException("Prisma P2002 at database.internal:5432"),
  );
  const malformed = publicErrorFromException(
    new BadRequestException("Expected property name or '}' in JSON at position 1 (line 1 column 2)"),
  );

  assert.equal(internal.body.error.message, "Die Anfrage konnte gerade nicht verarbeitet werden. Bitte versuche es später erneut.");
  assert.doesNotMatch(JSON.stringify(internal.body), /Prisma|database|5432|P2002/);
  assert.equal(malformed.body.error.message, "Die Anfrage enthält ungültige oder unvollständige Angaben.");
  assert.doesNotMatch(JSON.stringify(malformed.body), /Expected property|JSON|position|line 1|column 2/);
});

test("typische SQL-Injection-Payloads scheitern bereits am Login-Vertrag", () => {
  const payloads = [
    "' OR 1=1 --",
    "admin@example.com' OR '1'='1",
    "admin@example.com; DROP TABLE users;--",
  ];
  for (const email of payloads) {
    assert.equal(LoginSchema.safeParse({ email, password: "gueltig123" }).success, false);
  }
  assert.equal(
    LoginSchema.safeParse({ email: "admin@example.com", password: "' OR 1=1 --" }).success,
    true,
    "Passwörter dürfen Sonderzeichen enthalten und werden ausschließlich per bcrypt verglichen.",
  );
});

test("Login übergibt selbst ungeprüfte Werte nur als Prisma-Filterwert", async () => {
  const injection = "' OR 1=1 --";
  let receivedWhere: unknown;
  const prisma = {
    user: {
      findUnique: async (input: { where: unknown }) => {
        receivedWhere = input.where;
        return null;
      },
    },
  } as unknown as AuthPrisma;
  const service = new AuthService(
    prisma,
    {} as JwtDependency,
    {} as SettingsDependency,
    {} as AuditDependency,
    {} as SmtpDependency,
  );

  await assert.rejects(
    service.login({ email: injection, password: "gueltig123" }),
    UnauthorizedException,
  );
  assert.deepEqual(receivedWhere, { email: injection });
});

test("API-Quellcode verwendet keine unsicheren Prisma-Raw-Abfragen", async () => {
  const sources = await readTypeScriptFiles(fileURLToPath(new URL("../../src", import.meta.url)));
  const completeSource = sources.join("\n");
  assert.doesNotMatch(completeSource, /\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.raw\s*\(/);
});

async function readTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await readTypeScriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) results.push(await readFile(path, "utf8"));
  }
  return results;
}
