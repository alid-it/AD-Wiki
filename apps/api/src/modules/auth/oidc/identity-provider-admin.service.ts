import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  IdentityProviderClientAuthMethod,
  Prisma,
} from "@prisma/client";
import slugify from "slugify";
import type {
  CreateIdentityProviderGroupMappingInput,
  CreateIdentityProviderInput,
  CreateIdentityProviderRoleMappingInput,
  DeleteIdentityProviderInput,
  IdentityProvider,
  IdentityProviderAdmin,
  IdentityProviderDetails,
  IdentitySyncHistoryEntry,
  IdentitySyncStatus,
  UpdateIdentityProviderInput,
} from "@ad-wiki/shared-types";
import { OidcSecretEncryptionService } from "@/modules/auth/oidc/oidc-secret-encryption.service";
import { isSafeJitDefaultRole } from "@/modules/auth/oidc/oidc-jit-policy";
import { PrismaService } from "@/prisma/prisma.service";

const providerSelect = {
  id: true,
  slug: true,
  name: true,
  type: true,
  issuer: true,
  discoveryUrl: true,
  clientId: true,
  clientAuthMethod: true,
  encryptedClientSecret: true,
  scopes: true,
  claimMapping: true,
  isActive: true,
  displayOrder: true,
  allowJitProvisioning: true,
  defaultRoleId: true,
  groupSyncMode: true,
  groupClaim: true,
  roleClaim: true,
  allowAdminRoleMapping: true,
  maxSessionAgeMinutes: true,
  entraGraphFallbackEnabled: true,
  entraGraphMembershipMode: true,
  entraGraphCacheTtlMinutes: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      externalIdentities: true,
      groupMappings: true,
      roleMappings: true,
    },
  },
} satisfies Prisma.IdentityProviderSelect;

type ProviderRow = Prisma.IdentityProviderGetPayload<{
  select: typeof providerSelect;
}>;

@Injectable()
export class IdentityProviderAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: OidcSecretEncryptionService,
  ) {}

  async findAll(): Promise<IdentityProviderAdmin[]> {
    const providers = await this.prisma.identityProvider.findMany({
      select: providerSelect,
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
    return providers.map(toAdminProvider);
  }

  async findOne(id: string): Promise<IdentityProviderDetails> {
    const [provider, groupMappings, roleMappings] = await Promise.all([
      this.findProvider(id),
      this.prisma.identityProviderGroupMapping.findMany({
        where: { providerId: id },
        orderBy: [{ externalGroupName: "asc" }, { externalGroupId: "asc" }],
      }),
      this.prisma.identityProviderRoleMapping.findMany({
        where: { providerId: id },
        orderBy: [{ priority: "asc" }, { externalValue: "asc" }],
      }),
    ]);
    return {
      provider: toAdminProvider(provider),
      groupMappings: groupMappings.map((mapping) => ({
        ...mapping,
        createdAt: mapping.createdAt.toISOString(),
        updatedAt: mapping.updatedAt.toISOString(),
      })),
      roleMappings: roleMappings.map((mapping) => ({
        ...mapping,
        createdAt: mapping.createdAt.toISOString(),
        updatedAt: mapping.updatedAt.toISOString(),
      })),
    };
  }

  async create(input: CreateIdentityProviderInput): Promise<IdentityProviderAdmin> {
    this.assertClientConfiguration(input);
    await this.assertJitConfiguration(
      input.isActive && input.allowJitProvisioning,
      input.defaultRoleId ?? null,
    );
    const slug = await this.uniqueSlug(input.name);
    try {
      const provider = await this.prisma.identityProvider.create({
        data: {
          name: input.name,
          slug,
          type: input.type,
          issuer: normalizedUrl(input.issuer),
          discoveryUrl: input.discoveryUrl
            ? normalizedUrl(input.discoveryUrl)
            : null,
          clientId: input.clientId,
          clientAuthMethod: input.clientAuthMethod,
          encryptedClientSecret: input.clientSecret
            ? this.encryption.encrypt(input.clientSecret)
            : null,
          scopes: input.scopes,
          claimMapping: input.claimMapping as Prisma.InputJsonObject,
          isActive: input.isActive,
          displayOrder: input.displayOrder,
          allowJitProvisioning: input.allowJitProvisioning,
          defaultRoleId: input.defaultRoleId ?? null,
          groupSyncMode: input.groupSyncMode,
          groupClaim: input.groupClaim ?? null,
          roleClaim: input.roleClaim ?? null,
          allowAdminRoleMapping: input.allowAdminRoleMapping,
          maxSessionAgeMinutes: input.maxSessionAgeMinutes,
          entraGraphFallbackEnabled: input.entraGraphFallbackEnabled,
          entraGraphMembershipMode: input.entraGraphMembershipMode,
          entraGraphCacheTtlMinutes: input.entraGraphCacheTtlMinutes,
        },
        select: providerSelect,
      });
      return toAdminProvider(provider);
    } catch (error) {
      rethrowProviderConflict(error);
    }
  }

  async update(
    id: string,
    input: UpdateIdentityProviderInput,
  ): Promise<IdentityProviderAdmin> {
    const current = await this.findProvider(id);
    await this.assertJitConfiguration(
      (input.isActive ?? current.isActive) &&
        (input.allowJitProvisioning ?? current.allowJitProvisioning),
      input.defaultRoleId !== undefined
        ? input.defaultRoleId
        : current.defaultRoleId,
    );
    if (
      current.isActive &&
      input.isActive === false &&
      !input.confirmLastActiveProvider &&
      (await this.activeProviderCount()) === 1
    ) {
      throw new ConflictException(
        "Der letzte aktive SSO-Anbieter muss ausdrücklich bestätigt werden.",
      );
    }
    const nextAuthMethod =
      input.clientAuthMethod ?? current.clientAuthMethod;
    const hasSecret =
      input.clearClientSecret === true
        ? false
        : Boolean(input.clientSecret || current.encryptedClientSecret);
    if (
      nextAuthMethod !== IdentityProviderClientAuthMethod.NONE &&
      !hasSecret
    ) {
      throw new BadRequestException(
        "Für diese Client-Authentifizierung ist ein Client-Secret erforderlich.",
      );
    }
    if (
      nextAuthMethod === IdentityProviderClientAuthMethod.NONE &&
      (hasSecret || input.clientSecret)
    ) {
      throw new BadRequestException(
        "Ein öffentlicher OIDC-Client darf kein Client-Secret besitzen.",
      );
    }

    const data: Prisma.IdentityProviderUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.type !== undefined) data.type = input.type;
    if (input.issuer !== undefined) data.issuer = normalizedUrl(input.issuer);
    if (input.discoveryUrl !== undefined) {
      data.discoveryUrl = input.discoveryUrl
        ? normalizedUrl(input.discoveryUrl)
        : null;
    }
    if (input.clientId !== undefined) data.clientId = input.clientId;
    if (input.clientAuthMethod !== undefined) {
      data.clientAuthMethod = input.clientAuthMethod;
    }
    if (input.clientSecret !== undefined) {
      data.encryptedClientSecret = this.encryption.encrypt(input.clientSecret);
    } else if (input.clearClientSecret) {
      data.encryptedClientSecret = null;
    }
    if (input.scopes !== undefined) data.scopes = input.scopes;
    if (input.claimMapping !== undefined) {
      data.claimMapping = input.claimMapping as Prisma.InputJsonObject;
    }
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.displayOrder !== undefined) data.displayOrder = input.displayOrder;
    if (input.allowJitProvisioning !== undefined) {
      data.allowJitProvisioning = input.allowJitProvisioning;
    }
    if (input.defaultRoleId !== undefined) {
      data.defaultRole =
        input.defaultRoleId === null
          ? { disconnect: true }
          : { connect: { id: input.defaultRoleId } };
    }
    if (input.groupSyncMode !== undefined) {
      data.groupSyncMode = input.groupSyncMode;
    }
    if (input.groupClaim !== undefined) data.groupClaim = input.groupClaim;
    if (input.roleClaim !== undefined) data.roleClaim = input.roleClaim;
    if (input.allowAdminRoleMapping !== undefined) {
      data.allowAdminRoleMapping = input.allowAdminRoleMapping;
    }
    if (input.maxSessionAgeMinutes !== undefined) {
      data.maxSessionAgeMinutes = input.maxSessionAgeMinutes;
    }
    if (input.entraGraphFallbackEnabled !== undefined) {
      data.entraGraphFallbackEnabled = input.entraGraphFallbackEnabled;
    }
    if (input.entraGraphMembershipMode !== undefined) {
      data.entraGraphMembershipMode = input.entraGraphMembershipMode;
    }
    if (input.entraGraphCacheTtlMinutes !== undefined) {
      data.entraGraphCacheTtlMinutes = input.entraGraphCacheTtlMinutes;
    }
    try {
      return toAdminProvider(
        await this.prisma.identityProvider.update({
          where: { id },
          data,
          select: providerSelect,
        }),
      );
    } catch (error) {
      rethrowProviderConflict(error);
    }
  }

  async remove(
    id: string,
    input: DeleteIdentityProviderInput,
  ): Promise<{ id: string; name: string }> {
    const provider = await this.findProvider(id);
    if (
      provider.isActive &&
      !input.confirmLastActiveProvider &&
      (await this.activeProviderCount()) === 1
    ) {
      throw new ConflictException(
        "Das Löschen des letzten aktiven SSO-Anbieters muss ausdrücklich bestätigt werden.",
      );
    }
    await this.prisma.identityProvider.delete({ where: { id } });
    return { id: provider.id, name: provider.name };
  }

  async referenceData() {
    const [groups, roles] = await Promise.all([
      this.prisma.group.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      this.prisma.role.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, isSystem: true },
      }),
    ]);
    return { groups, roles };
  }

  async createGroupMapping(
    providerId: string,
    input: CreateIdentityProviderGroupMappingInput,
  ) {
    await this.findProvider(providerId);
    try {
      const mapping = await this.prisma.identityProviderGroupMapping.create({
        data: {
          providerId,
          externalGroupId: input.externalGroupId,
          externalGroupPath: input.externalGroupPath ?? null,
          externalGroupName: input.externalGroupName ?? null,
          groupId: input.groupId,
        },
      });
      return {
        ...mapping,
        createdAt: mapping.createdAt.toISOString(),
        updatedAt: mapping.updatedAt.toISOString(),
      };
    } catch (error) {
      rethrowMappingConflict(error);
    }
  }

  async createRoleMapping(
    providerId: string,
    input: CreateIdentityProviderRoleMappingInput,
  ) {
    await this.findProvider(providerId);
    try {
      const mapping = await this.prisma.identityProviderRoleMapping.create({
        data: { providerId, ...input },
      });
      return {
        ...mapping,
        createdAt: mapping.createdAt.toISOString(),
        updatedAt: mapping.updatedAt.toISOString(),
      };
    } catch (error) {
      rethrowMappingConflict(error);
    }
  }

  async removeGroupMapping(providerId: string, mappingId: string) {
    const mapping = await this.prisma.identityProviderGroupMapping.findFirst({
      where: { id: mappingId, providerId },
    });
    if (!mapping) throw new NotFoundException("Gruppen-Mapping nicht gefunden.");
    await this.prisma.identityProviderGroupMapping.delete({
      where: { id: mappingId },
    });
    return { id: mapping.id, externalValue: mapping.externalGroupId };
  }

  async removeRoleMapping(providerId: string, mappingId: string) {
    const mapping = await this.prisma.identityProviderRoleMapping.findFirst({
      where: { id: mappingId, providerId },
    });
    if (!mapping) throw new NotFoundException("Rollen-Mapping nicht gefunden.");
    await this.prisma.identityProviderRoleMapping.delete({
      where: { id: mappingId },
    });
    return { id: mapping.id, externalValue: mapping.externalValue };
  }

  async synchronizationStatus(providerId: string): Promise<IdentitySyncStatus[]> {
    await this.findProvider(providerId);
    const identities = await this.prisma.externalIdentity.findMany({
      where: { providerId },
      orderBy: [{ lastGroupSyncAt: "desc" }, { createdAt: "desc" }],
      include: { user: { select: { displayName: true, isActive: true } } },
    });
    return identities.map((identity) => ({
      id: identity.id,
      userId: identity.userId,
      userDisplayName: identity.user.displayName,
      userActive: identity.user.isActive,
      email: identity.email,
      username: identity.username,
      lastLoginAt: identity.lastLoginAt?.toISOString() ?? null,
      lastGroupSyncAt: identity.lastGroupSyncAt?.toISOString() ?? null,
      lastSyncErrorCode: identity.lastSyncErrorCode,
      groupClaimCount: identity.lastGroupClaims.length,
      roleClaimCount: identity.lastRoleClaims.length,
    }));
  }

  async synchronizationHistory(
    providerId: string,
  ): Promise<IdentitySyncHistoryEntry[]> {
    const identities = await this.prisma.externalIdentity.findMany({
      where: { providerId },
      select: { id: true },
    });
    const identityIds = identities.map((identity) => identity.id);
    if (identityIds.length === 0) return [];
    const rows = await this.prisma.auditLog.findMany({
      where: {
        resource: "external_identity",
        resourceId: { in: identityIds },
        action: { in: ["identity.groups_synced", "identity.sync_failed"] },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map((row) => ({
      id: row.id,
      externalIdentityId: row.resourceId ?? "",
      action: row.action as IdentitySyncHistoryEntry["action"],
      createdAt: row.createdAt.toISOString(),
      details: (row.details ?? null) as Record<string, unknown> | null,
    }));
  }

  private async findProvider(id: string): Promise<ProviderRow> {
    const provider = await this.prisma.identityProvider.findUnique({
      where: { id },
      select: providerSelect,
    });
    if (!provider) throw new NotFoundException("SSO-Anbieter nicht gefunden.");
    return provider;
  }

  private activeProviderCount(): Promise<number> {
    return this.prisma.identityProvider.count({ where: { isActive: true } });
  }

  private async assertJitConfiguration(
    allowJitProvisioning: boolean,
    defaultRoleId: string | null,
  ): Promise<void> {
    if (!allowJitProvisioning) return;
    if (!defaultRoleId) {
      throw new BadRequestException(
        "Für die automatische Kontoanlage muss eine sichere Standardrolle ausgewählt werden.",
      );
    }
    const role = await this.prisma.role.findUnique({
      where: { id: defaultRoleId },
      include: {
        acls: {
          where: { allowed: true },
          select: { resource: true },
        },
      },
    });
    if (!isSafeJitDefaultRole(role)) {
      throw new BadRequestException(
        "Die Standardrolle für die automatische Kontoanlage darf keine administrativen Rechte enthalten.",
      );
    }
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name, { lower: true, strict: true, trim: true }) || "sso";
    for (let index = 0; index < 100; index += 1) {
      const slug = index === 0 ? base : `${base}-${index + 1}`;
      if (!(await this.prisma.identityProvider.findUnique({ where: { slug } }))) {
        return slug;
      }
    }
    throw new ConflictException("Für den Provider konnte kein eindeutiger Slug erzeugt werden.");
  }

  private assertClientConfiguration(input: CreateIdentityProviderInput): void {
    if (
      input.clientAuthMethod !== IdentityProviderClientAuthMethod.NONE &&
      !input.clientSecret
    ) {
      throw new BadRequestException(
        "Für einen vertraulichen OIDC-Client ist ein Client-Secret erforderlich.",
      );
    }
    if (
      input.clientAuthMethod === IdentityProviderClientAuthMethod.NONE &&
      input.clientSecret
    ) {
      throw new BadRequestException(
        "Ein öffentlicher OIDC-Client darf kein Client-Secret besitzen.",
      );
    }
  }
}

function toAdminProvider(row: ProviderRow): IdentityProviderAdmin {
  const provider: IdentityProvider = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    issuer: row.issuer,
    discoveryUrl: row.discoveryUrl,
    clientId: row.clientId,
    clientAuthMethod: row.clientAuthMethod,
    clientSecretConfigured: row.encryptedClientSecret !== null,
    scopes: row.scopes,
    claimMapping: row.claimMapping as IdentityProvider["claimMapping"],
    isActive: row.isActive,
    displayOrder: row.displayOrder,
    allowJitProvisioning: row.allowJitProvisioning,
    defaultRoleId: row.defaultRoleId,
    groupSyncMode: row.groupSyncMode,
    groupClaim: row.groupClaim,
    roleClaim: row.roleClaim,
    allowAdminRoleMapping: row.allowAdminRoleMapping,
    maxSessionAgeMinutes: row.maxSessionAgeMinutes,
    entraGraphFallbackEnabled: row.entraGraphFallbackEnabled,
    entraGraphMembershipMode: row.entraGraphMembershipMode,
    entraGraphCacheTtlMinutes: row.entraGraphCacheTtlMinutes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  return {
    ...provider,
    counts: {
      identities: row._count.externalIdentities,
      groupMappings: row._count.groupMappings,
      roleMappings: row._count.roleMappings,
    },
  };
}

function normalizedUrl(value: string): string {
  const url = new URL(value);
  return url.toString().replace(/\/$/, "");
}

function rethrowProviderConflict(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    throw new ConflictException(
      "Name, Issuer oder Client-ID wird bereits von einem Provider verwendet.",
    );
  }
  throw error;
}

function rethrowMappingConflict(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    throw new ConflictException(
      "Dieser externe Wert oder diese Priorität ist bereits zugeordnet.",
    );
  }
  throw error;
}
