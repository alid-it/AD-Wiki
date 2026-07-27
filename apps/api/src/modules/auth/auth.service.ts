import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService, type JwtSignOptions } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "@/prisma/prisma.service";
import { AuditService } from "@/modules/audit/audit.service";
import { EffectiveRoleService } from "@/modules/auth/effective-role.service";
import { IdentitySynchronizationService } from "@/modules/auth/oidc/identity-synchronization.service";
import { SettingsService } from "@/modules/settings/settings.service";
import { SmtpService } from "@/modules/settings/smtp.service";
import { MonitoringService } from "@/health/monitoring.service";
import type { LoginDto } from "@/modules/auth/dto/login.dto";
import type { RegisterDto } from "@/modules/auth/dto/register.dto";
import type {
  AuthenticatedUser,
  JwtPayload,
} from "@/modules/auth/types/jwt-payload";
import {
  ACTIONS,
  AclEntrySchema,
  RESOURCES,
  isPermissionSupported,
  type UserRole,
} from "@ad-wiki/shared-types";

/** Salt-Rounds für bcrypt gemäß Sicherheitsvorgabe (siehe apps/api/CLAUDE.md). */
const SALT_ROUNDS = 12;

/**
 * Fester Vergleichswert für unbekannte Konten. So benötigt ein fehlgeschlagener
 * Login unabhängig davon, ob die E-Mail existiert, einen bcrypt-Vergleich.
 */
const UNKNOWN_USER_PASSWORD_HASH = "$2b$12$Dv5mPIaAjxMDKYpSmKuVyOmOrSKKkwTdX.EYLx6A1QZ1LB18MVVaS";

/** Standard-Rolle für neu registrierte User. */
const DEFAULT_ROLE = "viewer";

/**
 * Gültigkeitsdauern der Tokens (aus der Umgebung, mit sicheren Defaults).
 * Der Cast auf den `expiresIn`-Typ ist nötig, da `ms` ein Template-Literal
 * (StringValue) erwartet und `process.env` nur ein generisches `string` liefert.
 */
const ACCESS_TOKEN_TTL = (process.env.JWT_EXPIRES_IN ??
  "15m") as JwtSignOptions["expiresIn"];
const REFRESH_TOKEN_TTL = (process.env.JWT_REFRESH_EXPIRES_IN ??
  "7d") as JwtSignOptions["expiresIn"];

/** Kontextdaten des Clients für die Session-Ablage. */
export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

/** Bindet eine interne Sitzung an eine frisch geprüfte externe Identität. */
export interface ExternalSessionContext {
  externalIdentityId: string;
  verifiedAt: Date;
  recheckAfter: Date;
}

type RefreshRotationResult =
  | { status: "invalid" }
  | { status: "reused"; userId: string; familyId: string }
  | { status: "rotated"; accessToken: string; refreshToken: string };

/** Ergebnis eines erfolgreichen Logins bzw. einer Registrierung. */
export interface AuthResult {
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken: string;
}

/**
 * Zentrale Auth-Logik: Registrierung, Login, Token-Erneuerung und Logout.
 * Passwörter werden ausschließlich als bcrypt-Hash gespeichert.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly settingsService: SettingsService,
    private readonly audit: AuditService,
    private readonly smtpService: SmtpService,
    @Optional() private readonly monitoring?: MonitoringService,
    @Optional() private readonly effectiveRoles?: EffectiveRoleService,
    @Optional()
    private readonly identitySync?: IdentitySynchronizationService,
  ) {}

  /** Effective permissions: individual entries intentionally override role ACLs. */
  async getEffectivePermissions(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: { include: { acls: true } }, permissions: true },
    });
    if (!user) return [];
    if (user.isProtected) {
      return RESOURCES.flatMap((resource) =>
        ACTIONS.filter((action) => isPermissionSupported(resource, action)).map((action) => ({
          resource,
          action,
          allowed: true,
        })),
      );
    }
    const effectiveRole = await this.effectiveRoles?.resolveRole(userId);
    const roleAcls =
      effectiveRole && effectiveRole.id !== user.roleId
        ? await this.prisma.acl.findMany({
            where: { roleId: effectiveRole.id },
          })
        : user.role.acls;
    const entries = new Map<string, ReturnType<typeof AclEntrySchema.parse>>();
    for (const entry of roleAcls) {
      const parsed = AclEntrySchema.safeParse(entry);
      if (parsed.success) {
        entries.set(`${parsed.data.resource}:${parsed.data.action}`, parsed.data);
      }
    }
    for (const entry of user.permissions) {
      const parsed = AclEntrySchema.safeParse(entry);
      if (parsed.success) {
        entries.set(`${parsed.data.resource}:${parsed.data.action}`, parsed.data);
      }
    }
    return [...entries.values()];
  }

  /**
   * Legt einen neuen User mit der Default-Rolle "viewer" an,
   * hasht das Passwort und stellt sofort Tokens aus.
   */
  async register(dto: RegisterDto, context: RequestContext = {}): Promise<AuthResult> {
    // Selbstregistrierung kann per Setting deaktiviert sein.
    const allowRegistration = await this.settingsService.getValue("allow_registration", "true");
    if (allowRegistration !== "true") {
      throw new ForbiddenException("Die Registrierung ist derzeit deaktiviert.");
    }

    // Eindeutigkeit von E-Mail und Username prüfen.
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { username: dto.username }] },
      select: { email: true, username: true },
    });
    if (existing) {
      const feld = existing.email === dto.email ? "E-Mail" : "Benutzername";
      throw new ConflictException(`${feld} ist bereits vergeben.`);
    }

    // Standard-Rolle für neue User stammt aus den Settings (Fallback: viewer).
    const defaultRole = await this.settingsService.getValue("default_role", DEFAULT_ROLE);
    const role =
      (await this.prisma.role.findUnique({ where: { name: defaultRole } })) ??
      (await this.prisma.role.findUnique({ where: { name: DEFAULT_ROLE } }));
    if (!role) {
      throw new UnauthorizedException(`Standard-Rolle "${defaultRole}" fehlt.`);
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        username: dto.username,
        displayName: dto.displayName,
        password: passwordHash,
        roleId: role.id,
      },
      include: { role: true },
    });

    const effectiveUser =
      (await this.effectiveRoles?.resolveUser(user.id)) ?? user;
    const authUser = this.toAuthenticatedUser(
      effectiveUser,
      effectiveUser.role.name,
    );
    const tokens = await this.issueTokens(authUser, context);
    await this.audit.log(
      authUser.id,
      "user.registered",
      "user",
      authUser.id,
      { email: authUser.email, username: authUser.username },
      context.ipAddress,
    );
    return { user: authUser, ...tokens };
  }

  /**
   * Prüft E-Mail und Passwort, stellt Access- und Refresh-Token aus
   * und legt die Session (Refresh-Token) in der Datenbank ab.
   */
  async login(dto: LoginDto, context: RequestContext = {}): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { role: true },
    });
    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.password ?? UNKNOWN_USER_PASSWORD_HASH,
    );

    // Einheitliche Fehlermeldung – verrät nicht, ob die E-Mail existiert.
    if (!user || !passwordMatches) {
      this.monitoring?.recordLoginAttempt(false);
      throw new UnauthorizedException("E-Mail oder Passwort ist falsch.");
    }
    if (!user.isActive) {
      this.monitoring?.recordLoginAttempt(false);
      throw new UnauthorizedException("Dieser Account ist deaktiviert.");
    }
    const localLoginEnabled = await this.settingsService.getValue(
      "local_login_enabled",
      "true",
    );
    if (localLoginEnabled !== "true" && !user.isProtected) {
      this.monitoring?.recordLoginAttempt(false);
      throw new UnauthorizedException(
        "Die lokale Anmeldung ist für dieses Konto deaktiviert.",
      );
    }

    const authUser = this.toAuthenticatedUser(user, user.role.name);
    const tokens = await this.issueTokens(authUser, context);
    await this.audit.log(
      authUser.id,
      "user.login",
      "user",
      authUser.id,
      { email: authUser.email },
      context.ipAddress,
    );
    this.monitoring?.recordLoginAttempt(true);
    return { user: authUser, ...tokens };
  }

  /**
   * Stellt nach einer bereits vollständig geprüften externen Authentifizierung
   * dieselbe interne AD-Wiki-Sitzung wie beim lokalen Login aus.
   */
  async createSessionForUser(
    userId: string,
    context: RequestContext = {},
    externalSession?: ExternalSessionContext,
  ): Promise<AuthResult> {
    const user =
      (await this.effectiveRoles?.resolveUser(userId)) ??
      (await this.prisma.user.findUnique({
        where: { id: userId },
        include: { role: true },
      }));
    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        "Dieser Account ist nicht verfügbar.",
      );
    }
    const effectiveUser =
      (await this.effectiveRoles?.resolveUser(user.id)) ?? user;
    const authUser = this.toAuthenticatedUser(
      effectiveUser,
      effectiveUser.role.name,
    );
    const tokens = await this.issueTokens(authUser, context, externalSession);
    return { user: authUser, ...tokens };
  }

  /**
   * Validiert und rotiert einen Refresh-Token atomar. Bei Wiederverwendung
   * eines bereits rotierten Tokens wird die gesamte Token-Familie widerrufen.
   */
  async refreshToken(
    refreshToken: string,
    context: RequestContext = {},
  ): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException("Refresh-Token ist ungültig oder abgelaufen.");
    }

    // Ein expliziter Access-Token darf nie als Refresh-Token verwendet werden.
    if (payload.tokenType === "access") {
      throw new UnauthorizedException("Refresh-Token ist ungültig oder abgelaufen.");
    }

    const tokenHash = this.hashRefreshToken(refreshToken);
    const now = new Date();
    if (this.identitySync) {
      const candidate = await this.prisma.session.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          externalIdentityId: true,
          expiresAt: true,
          revokedAt: true,
          rotatedAt: true,
          providerRecheckAfter: true,
          externalIdentity: {
            select: { provider: { select: { isActive: true } } },
          },
        },
      });
      if (
        candidate?.externalIdentityId &&
        candidate.userId === payload.userId &&
        (payload.tokenId === undefined || payload.tokenId === candidate.id) &&
        candidate.expiresAt > now &&
        !candidate.revokedAt &&
        !candidate.rotatedAt &&
        candidate.providerRecheckAfter &&
        candidate.providerRecheckAfter > now &&
        candidate.externalIdentity?.provider.isActive
      ) {
        try {
          await this.identitySync.synchronizeStored(
            candidate.externalIdentityId,
            context,
          );
        } catch {
          throw new UnauthorizedException(
            "Die SSO-Berechtigungen konnten nicht aktualisiert werden. Bitte erneut anmelden.",
          );
        }
      }
    }
    const result = await this.prisma.$transaction(async (transaction): Promise<RefreshRotationResult> => {
      const session = await transaction.session.findUnique({
        where: { tokenHash },
        include: {
          user: { include: { role: true } },
          externalIdentity: {
            include: { provider: { select: { isActive: true } } },
          },
        },
      });

      if (
        !session ||
        session.expiresAt.getTime() < now.getTime() ||
        session.userId !== payload.userId ||
        (payload.tokenId !== undefined && payload.tokenId !== session.id) ||
        (session.externalIdentityId != null &&
          (!session.externalIdentity?.provider.isActive ||
            !session.providerRecheckAfter ||
            session.providerRecheckAfter <= now))
      ) {
        return { status: "invalid" };
      }

      if (session.rotatedAt) {
        await transaction.session.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        return { status: "reused", userId: session.userId, familyId: session.familyId };
      }

      if (session.revokedAt || !session.user.isActive) {
        return { status: "invalid" };
      }

      // Das bedingte Update verhindert, dass zwei parallele Requests denselben
      // Token erfolgreich rotieren. Der Verlierer wird als Reuse behandelt.
      const consumed = await transaction.session.updateMany({
        where: {
          id: session.id,
          rotatedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { rotatedAt: now, revokedAt: now },
      });
      if (consumed.count !== 1) {
        const current = await transaction.session.findUnique({
          where: { id: session.id },
          select: { rotatedAt: true },
        });
        if (current?.rotatedAt) {
          await transaction.session.updateMany({
            where: { familyId: session.familyId, revokedAt: null },
            data: { revokedAt: now },
          });
          return { status: "reused", userId: session.userId, familyId: session.familyId };
        }
        return { status: "invalid" };
      }

      const effectiveUser =
        (await this.effectiveRoles?.resolveUserInTransaction(
          transaction,
          session.userId,
        )) ?? session.user;
      const authUser = this.toAuthenticatedUser(
        effectiveUser,
        effectiveUser.role.name,
      );
      const jwtPayload: JwtPayload = {
        userId: authUser.id,
        email: authUser.email,
        roleId: authUser.roleId,
        role: authUser.role,
      };
      const replacementId = randomUUID();
      const [accessToken, replacementToken] = await Promise.all([
        this.signAccessToken(jwtPayload),
        this.signRefreshToken(jwtPayload, replacementId),
      ]);

      await transaction.session.create({
        data: {
          id: replacementId,
          userId: session.userId,
          tokenHash: this.hashRefreshToken(replacementToken),
          familyId: session.familyId,
          ipAddress: context.ipAddress ?? session.ipAddress,
          userAgent: context.userAgent ?? session.userAgent,
          expiresAt: this.refreshExpiryDate(replacementToken),
          externalIdentityId: session.externalIdentityId,
          providerVerifiedAt: session.providerVerifiedAt,
          providerRecheckAfter: session.providerRecheckAfter,
        },
      });

      return { status: "rotated", accessToken, refreshToken: replacementToken };
    });

    if (result.status === "reused") {
      await this.audit.log(
        result.userId,
        "security.refresh_token_reuse",
        "session",
        result.familyId,
        { familyId: result.familyId },
        context.ipAddress,
      );
    }
    if (result.status !== "rotated") {
      throw new UnauthorizedException("Sitzung ist ungültig oder abgelaufen.");
    }
    return { accessToken: result.accessToken, refreshToken: result.refreshToken };
  }

  /** Widerruft die gesamte Session-Familie zum Refresh-Token (idempotent). */
  async logout(refreshToken: string, ipAddress?: string): Promise<void> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      select: { userId: true, familyId: true },
    });
    if (session) {
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(session.userId, "user.logout", "user", session.userId, null, ipAddress);
    }
  }

  /**
   * Ändert das Passwort des Users nach Prüfung des aktuellen Passworts.
   * Alle bestehenden Sessions werden verworfen, damit ein evtl. kompromittierter
   * Zugang nach dem Wechsel nicht weiterläuft.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException("Benutzer nicht gefunden.");
    }
    if (!(await bcrypt.compare(currentPassword, user.password))) {
      throw new UnauthorizedException("Das aktuelle Passwort ist falsch.");
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password: passwordHash, hasLocalPassword: true },
      }),
      this.prisma.session.deleteMany({ where: { userId } }),
      this.prisma.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);
  }

  /** Öffentliche, kontenneutrale Anfrage einer Passwort-Reset-Mail. */
  async requestPasswordReset(email: string, ipAddress?: string): Promise<void> {
    const startedAt = Date.now();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, displayName: true, isActive: true },
    });
    if (user?.isActive) {
      // Versand bewusst entkoppeln: Die Antwortzeit verrät nicht, ob ein SMTP-Versand stattfand.
      void this.createAndSendPasswordReset(user)
        .then(() => this.audit.log(user.id, "password.reset_requested", "user", user.id, {
          channel: "email",
        }, ipAddress))
        .catch((error: unknown) => {
          // Die öffentliche Antwort bleibt neutral und verrät weder Konto- noch SMTP-Status.
          this.logger.warn(`Passwort-Reset-Mail konnte nicht versendet werden: ${safeErrorCode(error)}`);
        });
    }
    await waitAtLeast(startedAt, 175);
  }

  /** Sendet auf ausdrückliche Admin-Aktion einen Reset-Link an einen Benutzer. */
  async sendPasswordResetForUser(userId: string): Promise<{ recipient: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true, isActive: true, isProtected: true },
    });
    if (!user) throw new NotFoundException("Benutzer nicht gefunden.");
    if (user.isProtected) {
      throw new ForbiddenException("Das Passwort des geschützten Setup-Admin-Kontos kann nicht administrativ geändert werden.");
    }
    if (!user.isActive) {
      throw new BadRequestException("Für ein deaktiviertes Konto kann keine Reset-Mail gesendet werden.");
    }
    await this.createAndSendPasswordReset(user);
    return { recipient: user.email };
  }

  /** Verbraucht einen einmaligen Reset-Token und beendet sämtliche Sitzungen. */
  async resetPassword(token: string, newPassword: string, ipAddress?: string): Promise<void> {
    const tokenHash = this.hashResetToken(token);
    const now = new Date();
    const reset = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, isActive: true } } },
    });
    if (!reset || reset.usedAt || reset.expiresAt <= now || !reset.user.isActive) {
      throw new BadRequestException("Der Reset-Link ist ungültig oder abgelaufen.");
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.passwordResetToken.updateMany({
        where: { id: reset.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException("Der Reset-Link ist ungültig oder wurde bereits verwendet.");
      }
      await transaction.user.update({
        where: { id: reset.userId },
        data: { password: passwordHash, hasLocalPassword: true },
      });
      await transaction.session.deleteMany({ where: { userId: reset.userId } });
      await transaction.passwordResetToken.updateMany({
        where: { userId: reset.userId, usedAt: null },
        data: { usedAt: now },
      });
    });
    await this.audit.log(reset.userId, "password.reset_completed", "user", reset.userId, null, ipAddress);
  }

  /** Auditierter administrativer Passwortwechsel mit vollständigem Session-Widerruf. */
  async resetPasswordByAdmin(userId: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isProtected: true },
    });
    if (!user) throw new NotFoundException("Benutzer nicht gefunden.");
    if (user.isProtected) {
      throw new ForbiddenException("Das Passwort des geschützten Setup-Admin-Kontos kann nicht administrativ geändert werden.");
    }
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password: passwordHash, hasLocalPassword: true },
      }),
      this.prisma.session.deleteMany({ where: { userId } }),
      this.prisma.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: now },
      }),
    ]);
  }

  /**
   * Verifiziert einen Access-Token-String (Signatur + Ablauf) und liefert den
   * zugehörigen, aktiven User. Für den WebSocket-Handshake gedacht, bei dem der
   * Token nicht über den Authorization-Header, sondern beim Connect kommt.
   * Gibt `null` zurück, wenn der Token ungültig/abgelaufen oder der User inaktiv ist.
   */
  async verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      return await this.validateUser(payload);
    } catch {
      return null;
    }
  }

  /**
   * Lädt den User anhand des JWT-Payloads.
   * Wird von der JWT-Strategy zur Auflösung von `request.user` genutzt.
   */
  async validateUser(payload: JwtPayload): Promise<AuthenticatedUser | null> {
    if (payload.tokenType === "refresh") {
      return null;
    }
    const user =
      (await this.effectiveRoles?.resolveUser(payload.userId)) ??
      (await this.prisma.user.findUnique({
        where: { id: payload.userId },
        include: { role: true },
      }));
    if (!user || !user.isActive) {
      return null;
    }
    return this.toAuthenticatedUser(user, user.role.name);
  }

  // ── Private Helfer ───────────────────────────────────────

  /**
   * Erstellt Access- und Refresh-Token und speichert den Refresh-Token
   * als Session in der Datenbank.
   */
  private async issueTokens(
    user: AuthenticatedUser,
    context: RequestContext,
    externalSession?: ExternalSessionContext,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      roleId: user.roleId,
      role: user.role,
    };

    const sessionId = randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(payload),
      this.signRefreshToken(payload, sessionId),
    ]);

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: this.hashRefreshToken(refreshToken),
        familyId: sessionId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        expiresAt: this.refreshExpiryDate(refreshToken),
        externalIdentityId: externalSession?.externalIdentityId,
        providerVerifiedAt: externalSession?.verifiedAt,
        providerRecheckAfter: externalSession?.recheckAfter,
      },
    });

    return { accessToken, refreshToken };
  }

  /** Signiert einen Access-Token mit kurzer Gültigkeit. */
  private signAccessToken(payload: JwtPayload): Promise<string> {
    return this.jwtService.signAsync(
      {
        userId: payload.userId,
        email: payload.email,
        roleId: payload.roleId,
        role: payload.role,
        tokenType: "access",
      },
      { expiresIn: ACCESS_TOKEN_TTL },
    );
  }

  /** Signiert einen eindeutig einer Session zugeordneten Refresh-Token. */
  private signRefreshToken(payload: JwtPayload, tokenId: string): Promise<string> {
    return this.jwtService.signAsync(
      {
        userId: payload.userId,
        email: payload.email,
        roleId: payload.roleId,
        role: payload.role,
        tokenType: "refresh",
        tokenId,
      },
      { expiresIn: REFRESH_TOKEN_TTL },
    );
  }

  /** Erzeugt einen Einmal-Link; in der Datenbank verbleibt nur dessen Hash. */
  private async createAndSendPasswordReset(user: {
    id: string;
    email: string;
    displayName: string;
  }): Promise<void> {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresMinutes = resetTtlMinutes();
    const expiresAt = new Date(now.getTime() + expiresMinutes * 60_000);
    const reset = await this.prisma.$transaction(async (transaction) => {
      await transaction.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      return transaction.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.hashResetToken(token),
          expiresAt,
        },
        select: { id: true },
      });
    });

    try {
      await this.smtpService.sendPasswordReset({
        recipient: user.email,
        displayName: user.displayName,
        resetUrl: passwordResetUrl(token),
        expiresMinutes,
      });
    } catch (error) {
      await this.prisma.passwordResetToken.updateMany({
        where: { id: reset.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      throw error;
    }
  }

  private hashResetToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }

  /** Deterministischer Hash für DB-Lookups; der Klartext verlässt nie den Request. */
  private hashRefreshToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }

  /** Ablaufzeitpunkt der Session, passend zur Refresh-Token-Laufzeit. */
  private refreshExpiryDate(refreshToken: string): Date {
    const decoded = this.jwtService.decode<{ exp?: number }>(refreshToken);
    if (decoded?.exp !== undefined) {
      return new Date(decoded.exp * 1000);
    }
    const days = this.parseDays(REFRESH_TOKEN_TTL);
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  /** Wandelt einen Wert wie "7d" (oder Sekunden als Zahl) in Tage um (Fallback: 7). */
  private parseDays(ttl: JwtSignOptions["expiresIn"]): number {
    if (typeof ttl === "number") {
      return ttl / (24 * 60 * 60);
    }
    const match = typeof ttl === "string" ? /^(\d+)d$/.exec(ttl) : null;
    return match ? Number(match[1]) : 7;
  }

  /** Bereinigt einen Prisma-User zum sicheren, transportierbaren Objekt. */
  private toAuthenticatedUser(
    user: {
      id: string;
      email: string;
      username: string;
      displayName: string;
      roleId: string;
      isActive: boolean;
      isProtected?: boolean;
      hasLocalPassword: boolean;
    },
    roleName: string,
  ): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      roleId: user.roleId,
      role: roleName as UserRole,
      isActive: user.isActive,
      hasLocalPassword: user.hasLocalPassword,
      isProtected: user.isProtected ?? false,
    };
  }
}

function resetTtlMinutes(): number {
  const configured = Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? "30");
  return Number.isInteger(configured) && configured >= 5 && configured <= 1_440
    ? configured
    : 30;
}

function passwordResetUrl(token: string): string {
  const origin = process.env.WEB_URL?.trim() || process.env.APP_ORIGIN?.trim();
  if (!origin) {
    throw new Error("WEB_URL oder APP_ORIGIN fehlt für Passwort-Reset-Links.");
  }
  const url = new URL("/reset-password", origin);
  url.searchParams.set("token", token);
  return url.toString();
}

function safeErrorCode(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

async function waitAtLeast(startedAt: number, milliseconds: number): Promise<void> {
  const remaining = milliseconds - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  }
}
