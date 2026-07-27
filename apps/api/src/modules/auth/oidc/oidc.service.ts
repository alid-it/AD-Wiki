import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  type IdentityProvider,
  IdentityProviderClientAuthMethod,
  IdentityProviderType,
  OidcAuthorizationIntent,
  Prisma,
} from "@prisma/client";
import * as bcrypt from "bcrypt";
import {
  ClientSecretBasic,
  ClientSecretPost,
  None,
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  enableNonRepudiationChecks,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type ClientAuth,
  type Configuration,
} from "openid-client";
import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type {
  AuthResult,
  ExternalSessionContext,
  RequestContext,
} from "@/modules/auth/auth.service";
import { AuthService } from "@/modules/auth/auth.service";
import { OidcSecretEncryptionService } from "@/modules/auth/oidc/oidc-secret-encryption.service";
import {
  EntraGroupResolutionError,
  EntraGroupResolverService,
} from "@/modules/auth/oidc/entra-group-resolver.service";
import {
  IdentitySyncError,
  IdentitySynchronizationService,
} from "@/modules/auth/oidc/identity-synchronization.service";
import { AuditService } from "@/modules/audit/audit.service";
import { MonitoringService } from "@/health/monitoring.service";
import { PrismaService } from "@/prisma/prisma.service";
import {
  IdentityProviderClaimMappingSchema,
  OidcProvisioningProfileSchema,
} from "@ad-wiki/shared-types";
import { assertSafeOidcUrl } from "@/modules/auth/oidc/oidc-url-security";
import {
  acceptsEmailVerificationClaim,
  supportsPkceS256,
} from "@/modules/auth/oidc/oidc-provider-compatibility";
import { isSafeJitDefaultRole } from "@/modules/auth/oidc/oidc-jit-policy";

const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const LOGIN_CODE_TTL_MS = 60 * 1000;
const OIDC_HTTP_TIMEOUT_SECONDS = 10;
const OIDC_VALUE_PATTERN = /^[A-Za-z0-9_-]{32,512}$/;
const ACCOUNT_REAUTH_MAX_AGE_SECONDS = 5 * 60;
const JIT_PASSWORD_BYTES = 48;
const JIT_SALT_ROUNDS = 12;

const oidcProviderSelect = {
  id: true,
  name: true,
  slug: true,
  type: true,
  issuer: true,
  discoveryUrl: true,
  clientId: true,
  clientAuthMethod: true,
  encryptedClientSecret: true,
  scopes: true,
  isActive: true,
  claimMapping: true,
  allowJitProvisioning: true,
  defaultRoleId: true,
  maxSessionAgeMinutes: true,
  groupClaim: true,
  entraGraphFallbackEnabled: true,
  entraGraphMembershipMode: true,
  entraGraphCacheTtlMinutes: true,
} satisfies Prisma.IdentityProviderSelect;

type OidcProvider = Prisma.IdentityProviderGetPayload<{
  select: typeof oidcProviderSelect;
}>;

export type OidcLoginErrorCode =
  | "invalid_request"
  | "provider_unavailable"
  | "account_not_linked"
  | "account_unavailable"
  | "account_conflict"
  | "claims_invalid"
  | "jit_unavailable"
  | "sync_failed"
  | "group_overage_unresolved";

export class OidcLoginError extends Error {
  constructor(
    readonly code: OidcLoginErrorCode,
    options?: ErrorOptions,
    readonly accountAction = false,
  ) {
    super(code, options);
    this.name = "OidcLoginError";
  }
}

interface OidcLoginStart {
  authorizationUrl: string;
  bindingCookieName: string;
  browserBinding: string;
}

export type OidcCompletion =
  | { kind: "login"; loginCode: string }
  | { kind: "account"; result: "linked" | "unlinked" };

interface AuthorizationPurpose {
  intent: OidcAuthorizationIntent;
  userId?: string;
  unlinkTargetId?: string;
}

interface MappedOidcProfile {
  subject: string;
  email: string;
  username: string;
  displayName: string;
}

interface LoginIdentity {
  id: string;
  user: {
    id: string;
    isActive: boolean;
    isProtected: boolean;
  };
}

/** Providerneutraler OIDC-Code-Flow mit PKCE, Nonce und Einmalcode-Austausch. */
@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly encryption: OidcSecretEncryptionService,
    private readonly audit: AuditService,
    @Optional() private readonly monitoring?: MonitoringService,
    @Optional()
    private readonly identitySync?: IdentitySynchronizationService,
    @Optional()
    private readonly entraGroups?: EntraGroupResolverService,
  ) {}

  async getLoginProviders() {
    if (!this.encryption.isConfigured()) {
      return [];
    }
    return this.prisma.identityProvider.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: {
        slug: true,
        name: true,
        type: true,
      },
    });
  }

  async startLogin(providerSlug: string): Promise<OidcLoginStart> {
    return this.startAuthorization(providerSlug, {
      intent: OidcAuthorizationIntent.LOGIN,
    });
  }

  async getLinkedIdentities(userId: string) {
    return this.prisma.externalIdentity.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        lastLoginAt: true,
        createdAt: true,
        provider: {
          select: { slug: true, name: true, type: true },
        },
      },
    }).then((identities) =>
      identities.map((identity) => ({
        ...identity,
        lastLoginAt: identity.lastLoginAt?.toISOString() ?? null,
        createdAt: identity.createdAt.toISOString(),
      })),
    );
  }

  async startLink(
    providerSlug: string,
    userId: string,
  ): Promise<OidcLoginStart> {
    return this.startAuthorization(providerSlug, {
      intent: OidcAuthorizationIntent.LINK,
      userId,
    });
  }

  async startUnlink(
    identityId: string,
    userId: string,
  ): Promise<OidcLoginStart> {
    const identity = await this.prisma.externalIdentity.findFirst({
      where: { id: identityId, userId },
      include: {
        provider: { select: { slug: true, isActive: true } },
        user: {
          select: {
            hasLocalPassword: true,
            isActive: true,
            isProtected: true,
            _count: { select: { externalIdentities: true } },
          },
        },
      },
    });
    if (!identity?.provider.isActive) {
      throw new NotFoundException("Verknüpfte SSO-Identität nicht gefunden.");
    }
    if (
      !identity.user.isActive ||
      identity.user.isProtected ||
      (!identity.user.hasLocalPassword &&
        identity.user._count.externalIdentities <= 1)
    ) {
      throw new ConflictException(
        "Die letzte verfügbare Anmeldemethode kann nicht entfernt werden.",
      );
    }
    return this.startAuthorization(identity.provider.slug, {
      intent: OidcAuthorizationIntent.UNLINK,
      userId,
      unlinkTargetId: identity.id,
    });
  }

  private async startAuthorization(
    providerSlug: string,
    purpose: AuthorizationPurpose,
  ): Promise<OidcLoginStart> {
    this.requireEncryption();
    if (purpose.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: purpose.userId },
        select: { isActive: true, isProtected: true },
      });
      if (!user?.isActive || user.isProtected) {
        throw new ConflictException(
          "Dieses Konto kann nicht mit SSO verknüpft werden.",
        );
      }
    }
    const provider = await this.findActiveProvider(providerSlug);
    const redirectUri = oidcCallbackUrl(provider.slug);
    const configuration = await this.discover(provider, redirectUri);

    const state = randomState();
    const nonce = randomNonce();
    const codeVerifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
    const browserBinding = randomBytes(32).toString("base64url");
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.oidcAuthorizationRequest.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
      this.prisma.oidcLoginCode.deleteMany({
        where: {
          OR: [{ expiresAt: { lte: now } }, { usedAt: { not: null } }],
        },
      }),
      this.prisma.oidcAuthorizationRequest.create({
        data: {
          providerId: provider.id,
          stateHash: hashOidcValue("state", state),
          browserBindingHash: hashOidcValue("binding", browserBinding),
          encryptedCodeVerifier: this.encryption.encrypt(codeVerifier),
          encryptedNonce: this.encryption.encrypt(nonce),
          redirectUri,
          intent: purpose.intent,
          userId: purpose.userId,
          unlinkTargetId: purpose.unlinkTargetId,
          expiresAt: new Date(now.getTime() + AUTHORIZATION_TTL_MS),
        },
      }),
    ]);

    const accountAction = purpose.intent !== OidcAuthorizationIntent.LOGIN;
    const authorizationUrl = buildAuthorizationUrl(configuration, {
      redirect_uri: redirectUri,
      scope: provider.scopes.join(" "),
      response_type: "code",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
      max_age: String(
        accountAction
          ? ACCOUNT_REAUTH_MAX_AGE_SECONDS
          : provider.maxSessionAgeMinutes * 60,
      ),
      ...(accountAction ? { prompt: "login" } : {}),
    });

    return {
      authorizationUrl: authorizationUrl.toString(),
      bindingCookieName: oidcBindingCookieName(state),
      browserBinding,
    };
  }

  async completeLogin(
    providerSlug: string,
    currentUrl: URL,
    browserBinding: string | undefined,
    context: RequestContext = {},
  ): Promise<OidcCompletion> {
    this.requireEncryption();
    const state = currentUrl.searchParams.get("state");
    if (!state || !OIDC_VALUE_PATTERN.test(state) || !browserBinding) {
      this.recordFailure();
      throw new OidcLoginError("invalid_request");
    }

    const request = await this.consumeAuthorizationRequest(
      providerSlug,
      state,
      browserBinding,
    );

    try {
      const configuration = await this.discover(
        request.provider,
        request.redirectUri,
      );
      const tokens = await authorizationCodeGrant(configuration, currentUrl, {
        expectedState: state,
        expectedNonce: this.encryption.decrypt(request.encryptedNonce),
        pkceCodeVerifier: this.encryption.decrypt(
          request.encryptedCodeVerifier,
        ),
        maxAge:
          request.intent === OidcAuthorizationIntent.LOGIN
            ? request.provider.maxSessionAgeMinutes * 60
            : ACCOUNT_REAUTH_MAX_AGE_SECONDS,
      });
      const claims = tokens.claims();
      const issuer = claims?.iss;
      if (!claims || !issuer) {
        throw new OidcLoginError("provider_unavailable");
      }
      const profile = mappedProfile(
        request.provider.type,
        request.provider.claimMapping,
        claims,
      );

      if (request.intent === OidcAuthorizationIntent.LINK) {
        if (!request.userId) throw new OidcLoginError("invalid_request");
        await this.linkIdentity(
          request.provider,
          request.userId,
          issuer,
          profile,
          context,
        );
        return { kind: "account", result: "linked" };
      }
      if (request.intent === OidcAuthorizationIntent.UNLINK) {
        if (!request.userId || !request.unlinkTargetId) {
          throw new OidcLoginError("invalid_request");
        }
        await this.unlinkIdentity(
          request.provider.id,
          request.userId,
          request.unlinkTargetId,
          issuer,
          profile.subject,
          context,
        );
        return { kind: "account", result: "unlinked" };
      }

      let identity: LoginIdentity | null =
        await this.prisma.externalIdentity.findUnique({
        where: {
          providerId_issuer_subject: {
            providerId: request.provider.id,
            issuer,
            subject: profile.subject,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              isActive: true,
              isProtected: true,
            },
          },
        },
        });
      if (!identity) {
        if (request.provider.allowJitProvisioning) {
          identity = await this.provisionIdentity(
            request.provider,
            issuer,
            profile,
            context,
          );
        } else {
          await this.audit.log(
            null,
            "user.login",
            "user",
            null,
            {
              authenticationMethod: "oidc",
              providerId: request.provider.id,
              result: "account_not_linked",
            },
            context.ipAddress,
          );
          this.recordFailure();
          throw new OidcLoginError("account_not_linked");
        }
      }
      if (!identity.user.isActive || identity.user.isProtected) {
        this.recordFailure();
        throw new OidcLoginError("account_unavailable");
      }
      let synchronizationClaims: Record<string, unknown> = { ...claims };
      if (this.entraGroups) {
        try {
          synchronizationClaims = await this.entraGroups.resolveClaims(
            request.provider,
            synchronizationClaims,
            tokens.access_token,
          );
        } catch (error) {
          if (error instanceof EntraGroupResolutionError) {
            throw new OidcLoginError("group_overage_unresolved", {
              cause: error,
            });
          }
          throw error;
        }
      }
      if (this.identitySync) {
        try {
          await this.identitySync.synchronize(
            identity.id,
            synchronizationClaims,
            context,
          );
        } catch (error) {
          if (error instanceof IdentitySyncError) {
            throw new OidcLoginError("sync_failed", { cause: error });
          }
          throw error;
        }
      }

      const loginCode = randomBytes(32).toString("base64url");
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.externalIdentity.update({
          where: { id: identity.id },
          data: externalProfileUpdate(profile, now),
        }),
        this.prisma.oidcLoginCode.create({
          data: {
            tokenHash: hashOidcValue("login-code", loginCode),
            userAgentHash: hashUserAgent(context.userAgent),
            userId: identity.user.id,
            providerId: request.provider.id,
            externalIdentityId: identity.id,
            expiresAt: new Date(now.getTime() + LOGIN_CODE_TTL_MS),
          },
        }),
      ]);
      return { kind: "login", loginCode };
    } catch (error) {
      if (error instanceof OidcLoginError) {
        if (request.intent !== OidcAuthorizationIntent.LOGIN) {
          throw new OidcLoginError(
            error.code,
            { cause: error },
            true,
          );
        }
        throw error;
      }
      this.logger.warn(
        `OIDC-Callback fehlgeschlagen (${request.provider.id}): ${safeErrorName(error)}`,
      );
      this.recordFailure();
      throw new OidcLoginError(
        "provider_unavailable",
        { cause: error },
        request.intent !== OidcAuthorizationIntent.LOGIN,
      );
    }
  }

  async exchangeLoginCode(
    code: string,
    context: RequestContext = {},
  ): Promise<AuthResult> {
    const tokenHash = hashOidcValue("login-code", code);
    const now = new Date();
    const loginCode = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.oidcLoginCode.findUnique({
        where: { tokenHash },
        include: {
          user: { select: { id: true, isActive: true } },
          provider: {
            select: { id: true, name: true, maxSessionAgeMinutes: true },
          },
          externalIdentity: { select: { id: true } },
        },
      });
      if (
        !existing ||
        existing.usedAt ||
        existing.expiresAt <= now ||
        !existing.user.isActive ||
        !safeHashEqual(
          existing.userAgentHash,
          hashUserAgent(context.userAgent),
        )
      ) {
        return null;
      }

      const consumed = await transaction.oidcLoginCode.updateMany({
        where: {
          id: existing.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      return consumed.count === 1 ? existing : null;
    });

    if (!loginCode) {
      this.recordFailure();
      throw new UnauthorizedException(
        "Der SSO-Anmeldecode ist ungültig oder abgelaufen.",
      );
    }

    try {
      const verifiedAt = loginCode.createdAt;
      const externalSession: ExternalSessionContext = {
        externalIdentityId: loginCode.externalIdentity.id,
        verifiedAt,
        recheckAfter: new Date(
          verifiedAt.getTime() +
            loginCode.provider.maxSessionAgeMinutes * 60_000,
        ),
      };
      const result = await this.auth.createSessionForUser(
        loginCode.user.id,
        context,
        externalSession,
      );
      await this.audit.log(
        result.user.id,
        "user.login",
        "user",
        result.user.id,
        {
          authenticationMethod: "oidc",
          providerId: loginCode.provider.id,
          providerName: loginCode.provider.name,
        },
        context.ipAddress,
      );
      this.monitoring?.recordLoginAttempt(true);
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private async linkIdentity(
    provider: OidcProvider,
    userId: string,
    issuer: string,
    profile: MappedOidcProfile,
    context: RequestContext,
  ): Promise<void> {
    try {
      const identityId = await this.prisma.$transaction(
        async (transaction) => {
          const user = await transaction.user.findUnique({
            where: { id: userId },
            select: { isActive: true, isProtected: true },
          });
          if (!user?.isActive || user.isProtected) {
            throw new OidcLoginError("account_unavailable");
          }

          const claimed = await transaction.externalIdentity.findUnique({
            where: {
              providerId_issuer_subject: {
                providerId: provider.id,
                issuer,
                subject: profile.subject,
              },
            },
            select: { id: true, userId: true },
          });
          if (claimed && claimed.userId !== userId) {
            throw new OidcLoginError("account_conflict");
          }

          const providerLink = await transaction.externalIdentity.findUnique({
            where: { providerId_userId: { providerId: provider.id, userId } },
            select: { id: true, issuer: true, subject: true },
          });
          if (
            providerLink &&
            (providerLink.issuer !== issuer ||
              providerLink.subject !== profile.subject)
          ) {
            throw new OidcLoginError("account_conflict");
          }

          const now = new Date();
          if (claimed) {
            await transaction.externalIdentity.update({
              where: { id: claimed.id },
              data: externalProfileUpdate(profile, now),
            });
            return claimed.id;
          }
          const created = await transaction.externalIdentity.create({
            data: {
              providerId: provider.id,
              userId,
              issuer,
              subject: profile.subject,
              email: profile.email,
              username: profile.username,
              displayName: profile.displayName,
              lastLoginAt: now,
            },
            select: { id: true },
          });
          return created.id;
        },
      );
      await this.audit.log(
        userId,
        "identity.linked",
        "external_identity",
        identityId,
        { providerId: provider.id },
        context.ipAddress,
      );
    } catch (error) {
      if (
        error instanceof OidcLoginError ||
        isPrismaUniqueConflict(error)
      ) {
        throw error instanceof OidcLoginError
          ? error
          : new OidcLoginError("account_conflict", { cause: error });
      }
      throw error;
    }
  }

  private async unlinkIdentity(
    providerId: string,
    userId: string,
    identityId: string,
    issuer: string,
    subject: string,
    context: RequestContext,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const identity = await transaction.externalIdentity.findFirst({
        where: { id: identityId, userId, providerId },
        include: {
          user: {
            select: {
              isProtected: true,
              hasLocalPassword: true,
              _count: { select: { externalIdentities: true } },
            },
          },
        },
      });
      if (
        !identity ||
        identity.issuer !== issuer ||
        identity.subject !== subject ||
        identity.user.isProtected
      ) {
        throw new OidcLoginError("account_conflict");
      }
      if (
        !identity.user.hasLocalPassword &&
        identity.user._count.externalIdentities <= 1
      ) {
        throw new OidcLoginError("account_conflict");
      }
      const now = new Date();
      await transaction.session.updateMany({
        where: { externalIdentityId: identity.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.externalIdentity.delete({ where: { id: identity.id } });
    });
    await this.audit.log(
      userId,
      "identity.unlinked",
      "external_identity",
      identityId,
      { providerId },
      context.ipAddress,
    );
  }

  private async provisionIdentity(
    provider: OidcProvider,
    issuer: string,
    profile: MappedOidcProfile,
    context: RequestContext,
  ): Promise<LoginIdentity> {
    if (!provider.defaultRoleId) {
      throw new OidcLoginError("jit_unavailable");
    }
    const role = await this.prisma.role.findUnique({
      where: { id: provider.defaultRoleId },
      include: {
        acls: {
          where: { allowed: true },
          select: { resource: true },
        },
      },
    });
    if (!isSafeJitDefaultRole(role)) {
      throw new OidcLoginError("jit_unavailable");
    }

    const passwordHash = await bcrypt.hash(
      randomBytes(JIT_PASSWORD_BYTES).toString("base64url"),
      JIT_SALT_ROUNDS,
    );
    try {
      const identity = await this.prisma.$transaction(
        async (transaction): Promise<LoginIdentity> => {
          const emailConflict = await transaction.user.findFirst({
            where: {
              email: { equals: profile.email, mode: "insensitive" },
            },
            select: { id: true },
          });
          if (emailConflict) {
            throw new OidcLoginError("account_conflict");
          }

          const username = await availableJitUsername(
            transaction,
            profile.username,
            issuer,
            profile.subject,
          );
          const user = await transaction.user.create({
            data: {
              email: profile.email.toLowerCase(),
              username,
              displayName: profile.displayName,
              password: passwordHash,
              hasLocalPassword: false,
              roleId: role.id,
            },
            select: { id: true, isActive: true, isProtected: true },
          });
          const externalIdentity =
            await transaction.externalIdentity.create({
              data: {
                providerId: provider.id,
                userId: user.id,
                issuer,
                subject: profile.subject,
                email: profile.email,
                username: profile.username,
                displayName: profile.displayName,
                lastLoginAt: new Date(),
              },
              select: { id: true },
            });
          return { id: externalIdentity.id, user };
        },
      );
      await this.audit.log(
        identity.user.id,
        "user.jit_provisioned",
        "user",
        identity.user.id,
        {
          authenticationMethod: "oidc",
          providerId: provider.id,
          roleId: role.id,
        },
        context.ipAddress,
      );
      await this.audit.log(
        identity.user.id,
        "identity.linked",
        "external_identity",
        identity.id,
        { providerId: provider.id, source: "jit" },
        context.ipAddress,
      );
      return identity;
    } catch (error) {
      if (
        error instanceof OidcLoginError ||
        isPrismaUniqueConflict(error)
      ) {
        throw error instanceof OidcLoginError
          ? error
          : new OidcLoginError("account_conflict", { cause: error });
      }
      throw error;
    }
  }

  private async consumeAuthorizationRequest(
    providerSlug: string,
    state: string,
    browserBinding: string,
  ) {
    const stateHash = hashOidcValue("state", state);
    const request = await this.prisma.oidcAuthorizationRequest.findUnique({
      where: { stateHash },
      include: { provider: { select: oidcProviderSelect } },
    });
    const now = new Date();
    if (
      !request ||
      request.expiresAt <= now ||
      request.provider.slug !== providerSlug ||
      !request.provider.isActive ||
      !safeHashEqual(
        request.browserBindingHash,
        hashOidcValue("binding", browserBinding),
      )
    ) {
      if (request?.expiresAt && request.expiresAt <= now) {
        await this.prisma.oidcAuthorizationRequest.deleteMany({
          where: { id: request.id },
        });
      }
      this.recordFailure();
      throw new OidcLoginError("invalid_request");
    }

    const consumed = await this.prisma.oidcAuthorizationRequest.deleteMany({
      where: { id: request.id, expiresAt: { gt: now } },
    });
    if (consumed.count !== 1) {
      this.recordFailure();
      throw new OidcLoginError("invalid_request");
    }
    return request;
  }

  private async findActiveProvider(slug: string): Promise<OidcProvider> {
    const provider = await this.prisma.identityProvider.findUnique({
      where: { slug },
      select: oidcProviderSelect,
    });
    if (!provider?.isActive) {
      throw new NotFoundException("SSO-Anbieter nicht gefunden.");
    }
    return provider;
  }

  private async discover(
    provider: OidcProvider,
    redirectUri: string,
  ): Promise<Configuration> {
    const issuer = validatedIssuer(provider.issuer);
    const discoveryTarget = provider.discoveryUrl
      ? validatedIssuer(provider.discoveryUrl)
      : issuer;
    await Promise.all([
      assertSafeOidcUrl(issuer, "OIDC-Issuer"),
      assertSafeOidcUrl(discoveryTarget, "OIDC-Discovery"),
    ]);
    const clientSecret = provider.encryptedClientSecret
      ? this.encryption.decrypt(provider.encryptedClientSecret)
      : undefined;
    const clientAuthentication = this.clientAuthentication(
      provider,
      clientSecret,
    );
    const allowHttp =
      issuer.protocol === "http:" || discoveryTarget.protocol === "http:";
    const configuration = await discovery(
      discoveryTarget,
      provider.clientId,
      {
        client_secret: clientSecret,
        redirect_uris: [redirectUri],
        response_types: ["code"],
      },
      clientAuthentication,
      {
        timeout: OIDC_HTTP_TIMEOUT_SECONDS,
        execute: allowHttp
          ? [allowInsecureRequests, enableNonRepudiationChecks]
          : [enableNonRepudiationChecks],
      },
    );

    const metadata = configuration.serverMetadata();
    if (
      metadata.issuer !== provider.issuer ||
      !metadata.authorization_endpoint ||
      !metadata.token_endpoint ||
      !metadata.jwks_uri ||
      !supportsPkceS256(
        provider.type,
        metadata.code_challenge_methods_supported,
      )
    ) {
      throw new ServiceUnavailableException(
        "Der SSO-Anbieter erfüllt die erforderlichen OIDC-Sicherheitsmerkmale nicht.",
      );
    }
    await Promise.all(
      [
        metadata.authorization_endpoint,
        metadata.token_endpoint,
        metadata.jwks_uri,
        metadata.end_session_endpoint,
      ]
        .filter((value): value is string => typeof value === "string")
        .map((value) =>
          assertSafeOidcUrl(value, "OIDC-Metadaten-Endpunkt"),
        ),
    );
    return configuration;
  }

  private clientAuthentication(
    provider: Pick<
      IdentityProvider,
      "clientAuthMethod" | "id"
    >,
    clientSecret: string | undefined,
  ): ClientAuth {
    if (provider.clientAuthMethod === IdentityProviderClientAuthMethod.NONE) {
      if (clientSecret) {
        throw new ServiceUnavailableException(
          "Die OIDC-Clientkonfiguration ist widersprüchlich.",
        );
      }
      return None();
    }
    if (!clientSecret) {
      throw new ServiceUnavailableException(
        "Für den aktiven SSO-Anbieter fehlt das Client-Secret.",
      );
    }
    return provider.clientAuthMethod ===
      IdentityProviderClientAuthMethod.CLIENT_SECRET_BASIC
      ? ClientSecretBasic(clientSecret)
      : ClientSecretPost(clientSecret);
  }

  private requireEncryption(): void {
    if (!this.encryption.isConfigured()) {
      throw new ServiceUnavailableException(
        "SSO ist nicht vollständig konfiguriert.",
      );
    }
  }

  private recordFailure(): void {
    this.monitoring?.recordLoginAttempt(false);
  }
}

function mappedProfile(
  providerType: IdentityProviderType,
  rawMapping: Prisma.JsonValue,
  claims: Record<string, unknown>,
): MappedOidcProfile {
  const mapping = IdentityProviderClaimMappingSchema.safeParse(rawMapping);
  if (!mapping.success) {
    throw new OidcLoginError("claims_invalid");
  }
  const verified = claimAtPath(claims, mapping.data.emailVerified);
  if (!acceptsEmailVerificationClaim(providerType, verified)) {
    throw new OidcLoginError("claims_invalid");
  }
  const parsed = OidcProvisioningProfileSchema.safeParse({
    subject: claimAtPath(claims, mapping.data.subject),
    email: claimAtPath(claims, mapping.data.email),
    username: claimAtPath(claims, mapping.data.username),
    displayName: claimAtPath(claims, mapping.data.displayName),
  });
  if (!parsed.success) {
    throw new OidcLoginError("claims_invalid");
  }
  return {
    ...parsed.data,
    email: parsed.data.email.toLowerCase(),
  };
}

function claimAtPath(
  claims: Record<string, unknown>,
  path: string,
): unknown {
  let current: unknown = claims;
  for (const segment of path.split(".")) {
    if (
      !segment ||
      segment === "__proto__" ||
      segment === "prototype" ||
      segment === "constructor" ||
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function externalProfileUpdate(
  profile: MappedOidcProfile,
  now: Date,
): Prisma.ExternalIdentityUpdateInput {
  return {
    email: profile.email,
    username: profile.username,
    displayName: profile.displayName,
    lastLoginAt: now,
    lastSyncErrorCode: null,
  };
}

async function availableJitUsername(
  transaction: Prisma.TransactionClient,
  preferred: string,
  issuer: string,
  subject: string,
): Promise<string> {
  const base = normalizeUsername(preferred);
  const existing = await transaction.user.findFirst({
    where: { username: { equals: base, mode: "insensitive" } },
    select: { id: true },
  });
  if (!existing) return base;

  const suffix = createHash("sha256")
    .update(`${issuer}\u0000${subject}`, "utf8")
    .digest("hex")
    .slice(0, 8);
  const candidate = `${base.slice(0, 41)}-${suffix}`;
  const collision = await transaction.user.findFirst({
    where: { username: { equals: candidate, mode: "insensitive" } },
    select: { id: true },
  });
  if (collision) {
    throw new OidcLoginError("account_conflict");
  }
  return candidate;
}

function normalizeUsername(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 50);
  if (normalized.length >= 3) return normalized;
  const suffix = createHash("sha256")
    .update(value, "utf8")
    .digest("hex")
    .slice(0, 8);
  return `user-${suffix}`;
}

function isPrismaUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export function oidcBindingCookieName(state: string): string {
  return `ad_wiki_oidc_${hashOidcValue("cookie", state).slice(0, 16)}`;
}

export function oidcCallbackUrl(providerSlug: string): string {
  const origin = oidcApiOrigin();
  return new URL(
    `/api/v1/auth/oidc/${encodeURIComponent(providerSlug)}/callback`,
    origin,
  ).toString();
}

export function oidcWebLoginUrl(
  parameter: "oidc_code" | "oidc_error",
  value: string,
): string {
  const webUrl = requiredOrigin(
    process.env.WEB_URL ?? process.env.APP_ORIGIN,
    "WEB_URL oder APP_ORIGIN",
  );
  const target = new URL("/login", webUrl);
  target.hash = new URLSearchParams({ [parameter]: value }).toString();
  return target.toString();
}

export function oidcWebProfileUrl(
  parameter: "oidc_link" | "oidc_error",
  value: string,
): string {
  const webUrl = requiredOrigin(
    process.env.WEB_URL ?? process.env.APP_ORIGIN,
    "WEB_URL oder APP_ORIGIN",
  );
  const target = new URL("/profile", webUrl);
  target.hash = new URLSearchParams({ [parameter]: value }).toString();
  return target.toString();
}

function oidcApiOrigin(): URL {
  const configured = process.env.OIDC_PUBLIC_API_URL;
  if (configured) {
    return requiredOrigin(configured, "OIDC_PUBLIC_API_URL");
  }
  if (process.env.NODE_ENV === "production") {
    return requiredOrigin(
      process.env.APP_ORIGIN ?? process.env.WEB_URL,
      "APP_ORIGIN oder WEB_URL",
    );
  }
  return new URL("http://localhost:4000");
}

function requiredOrigin(value: string | undefined, name: string): URL {
  if (!value) {
    throw new ServiceUnavailableException(`${name} fehlt.`);
  }
  const parsed = new URL(value);
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  ) {
    throw new ServiceUnavailableException(
      `${name} muss eine reine Origin-URL sein.`,
    );
  }
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && process.env.NODE_ENV !== "production")
  ) {
    throw new ServiceUnavailableException(`${name} muss HTTPS verwenden.`);
  }
  return parsed;
}

function validatedIssuer(value: string): URL {
  const issuer = new URL(value);
  if (issuer.username || issuer.password || issuer.search || issuer.hash) {
    throw new ServiceUnavailableException(
      "Der konfigurierte OIDC-Issuer ist ungültig.",
    );
  }
  if (issuer.protocol === "https:") {
    return issuer;
  }
  if (
    issuer.protocol === "http:" &&
    process.env.NODE_ENV !== "production" &&
    process.env.OIDC_ALLOW_INSECURE_HTTP === "true"
  ) {
    return issuer;
  }
  throw new ServiceUnavailableException(
    "Der konfigurierte OIDC-Issuer muss HTTPS verwenden.",
  );
}

function hashOidcValue(domain: string, value: string): string {
  return createHash("sha256")
    .update(`ad-wiki:oidc:${domain}:`, "utf8")
    .update(value, "utf8")
    .digest("hex");
}

function hashUserAgent(userAgent: string | undefined): string {
  return hashOidcValue("user-agent", userAgent?.trim() ?? "");
}

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
