import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import * as bcrypt from "bcrypt";
import { Prisma, type ApiKey as PrismaApiKey } from "@prisma/client";
import {
  ApiKeyPermissionSchema,
  type AdminApiKey,
  type ApiKey,
  type ApiKeyPermission,
  type CreateApiKeyInput,
  type CreatedApiKey,
} from "@ad-wiki/shared-types";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { PrismaService } from "@/prisma/prisma.service";

const KEY_PREFIX = "ad_wiki_";
const BCRYPT_ROUNDS = 12;
const KEY_PATTERN = /^ad_wiki_[A-Za-z0-9_-]{48}$/;

type ApiKeyRow = Pick<
  PrismaApiKey,
  "id" | "name" | "permissions" | "lastUsedAt" | "expiresAt" | "createdAt" | "isActive"
>;

export interface VerifiedApiKey {
  apiKeyId: string;
  permissions: ApiKeyPermission[] | null;
  user: AuthenticatedUser;
}

/** Verwaltet API Keys, ohne ihren Klartext jemals zu persistieren. */
@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<ApiKey[]> {
    const rows = await this.prisma.apiKey.findMany({
      where: { userId },
      select: this.safeSelect(),
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toApi(row));
  }

  async listAll(): Promise<AdminApiKey[]> {
    const rows = await this.prisma.apiKey.findMany({
      select: {
        ...this.safeSelect(),
        user: {
          select: { id: true, displayName: true, username: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({ ...this.toApi(row), user: row.user }));
  }

  async create(userId: string, input: CreateApiKeyInput): Promise<CreatedApiKey> {
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("Das Ablaufdatum muss in der Zukunft liegen.");
    }

    const secret = randomBytes(36).toString("base64url");
    const key = `${KEY_PREFIX}${secret}`;
    const row = await this.prisma.apiKey.create({
      data: {
        userId,
        name: input.name,
        key: this.lookupHash(key),
        keyHash: await bcrypt.hash(key, BCRYPT_ROUNDS),
        permissions: this.permissionsForCreate(input.permissions),
        expiresAt,
      },
      select: this.safeSelect(),
    });
    return { ...this.toApi(row), key };
  }

  /** DELETE deaktiviert den Key sofort; Metadaten bleiben fuer Nachvollziehbarkeit erhalten. */
  async deactivate(userId: string, id: string): Promise<ApiKey> {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("API Key wurde nicht gefunden.");

    const row = await this.prisma.apiKey.update({
      where: { id },
      data: { isActive: false },
      select: this.safeSelect(),
    });
    return this.toApi(row);
  }

  /** Lookup per SHA-256, abschliessende geheime Pruefung immer per bcrypt. */
  async verify(rawKey: string): Promise<VerifiedApiKey | null> {
    if (!KEY_PATTERN.test(rawKey)) return null;

    const row = await this.prisma.apiKey.findUnique({
      where: { key: this.lookupHash(rawKey) },
      include: { user: { include: { role: true } } },
    });
    if (
      !row ||
      !row.isActive ||
      (row.expiresAt && row.expiresAt.getTime() <= Date.now()) ||
      !row.user.isActive ||
      !(await bcrypt.compare(rawKey, row.keyHash))
    ) {
      return null;
    }

    await this.prisma.apiKey.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
      select: { id: true },
    });

    const permissions = this.parsePermissions(row.permissions);
    return {
      apiKeyId: row.id,
      permissions,
      user: {
        id: row.user.id,
        email: row.user.email,
        username: row.user.username,
        displayName: row.user.displayName,
        roleId: row.user.role.id,
        role: row.user.role.name as AuthenticatedUser["role"],
        isActive: row.user.isActive,
        authenticationMethod: "apiKey",
        apiKeyId: row.id,
        apiKeyPermissions: permissions,
      },
    };
  }

  private safeSelect() {
    return {
      id: true,
      name: true,
      permissions: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
      isActive: true,
    } satisfies Prisma.ApiKeySelect;
  }

  private permissionsForCreate(
    permissions: ApiKeyPermission[] | null | undefined,
  ): Prisma.InputJsonValue | Prisma.NullTypes.DbNull | undefined {
    if (permissions === undefined) return undefined;
    if (permissions === null) return Prisma.DbNull;
    return permissions;
  }

  private parsePermissions(value: Prisma.JsonValue): ApiKeyPermission[] | null {
    if (value === null) return null;
    const parsed = ApiKeyPermissionSchema.array().safeParse(value);
    return parsed.success ? parsed.data : [];
  }

  private toApi(row: ApiKeyRow): ApiKey {
    const expired = Boolean(row.expiresAt && row.expiresAt.getTime() <= Date.now());
    return {
      id: row.id,
      name: row.name,
      permissions: this.parsePermissions(row.permissions),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      isActive: row.isActive,
      status: !row.isActive ? "inactive" : expired ? "expired" : "active",
    };
  }

  private lookupHash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
