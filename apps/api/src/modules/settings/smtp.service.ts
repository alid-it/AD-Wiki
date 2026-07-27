import {
  BadRequestException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { SmtpConfiguration as PrismaSmtpConfiguration } from "@prisma/client";
import { isIP } from "node:net";
import { createTransport, type Transporter } from "nodemailer";
import type {
  SmtpConfiguration,
  SmtpSecurity,
  SmtpTestResult,
  UpdateSmtpConfigurationInput,
} from "@ad-wiki/shared-types";
import { PrismaService } from "@/prisma/prisma.service";
import { SettingsService } from "@/modules/settings/settings.service";
import { SmtpCredentialEncryptionService } from "@/modules/settings/smtp-credential-encryption.service";
import { MonitoringService } from "@/health/monitoring.service";

const SMTP_CONFIGURATION_ID = "default";
const SMTP_TIMEOUT_MS = 15_000;

interface PasswordResetMail {
  recipient: string;
  displayName: string;
  resetUrl: string;
  expiresMinutes: number;
}

@Injectable()
export class SmtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly encryption: SmtpCredentialEncryptionService,
    @Optional() private readonly monitoring?: MonitoringService,
  ) {}

  async configuration(): Promise<SmtpConfiguration> {
    const configuration = await this.prisma.smtpConfiguration.findUnique({
      where: { id: SMTP_CONFIGURATION_ID },
    });
    return configuration ? this.toApi(configuration) : {
      host: "",
      port: 587,
      security: "starttls",
      username: null,
      fromEmail: "",
      fromName: await this.settings.getValue("site_name", "AD-Wiki"),
      replyTo: null,
      isEnabled: false,
      hasPassword: false,
      updatedAt: null,
    };
  }

  async update(input: UpdateSmtpConfigurationInput): Promise<SmtpConfiguration> {
    const existing = await this.prisma.smtpConfiguration.findUnique({
      where: { id: SMTP_CONFIGURATION_ID },
      select: { encryptedPassword: true },
    });
    const encryptedPassword = input.clearPassword
      ? null
      : input.password
        ? this.encryption.encrypt(input.password)
        : existing?.encryptedPassword ?? null;

    if (input.isEnabled && input.username && !encryptedPassword) {
      throw new BadRequestException("Für den SMTP-Benutzernamen muss ein Passwort hinterlegt sein.");
    }

    const configuration = await this.prisma.smtpConfiguration.upsert({
      where: { id: SMTP_CONFIGURATION_ID },
      create: {
        id: SMTP_CONFIGURATION_ID,
        host: input.host,
        port: input.port,
        security: input.security,
        username: input.username,
        encryptedPassword,
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        replyTo: input.replyTo,
        isEnabled: input.isEnabled,
      },
      update: {
        host: input.host,
        port: input.port,
        security: input.security,
        username: input.username,
        encryptedPassword,
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        replyTo: input.replyTo,
        isEnabled: input.isEnabled,
      },
    });
    return this.toApi(configuration);
  }

  async test(recipient: string): Promise<SmtpTestResult> {
    try {
      const configuration = await this.requiredConfiguration(false);
      const transporter = this.transporter(configuration);
      try {
        await transporter.verify();
        await transporter.sendMail({
          from: { name: configuration.fromName, address: configuration.fromEmail },
          to: recipient,
          replyTo: configuration.replyTo ?? undefined,
          subject: "SMTP-Test von AD-Wiki",
          text: "Die SMTP-Konfiguration von AD-Wiki funktioniert.",
          html: "<p>Die SMTP-Konfiguration von <strong>AD-Wiki</strong> funktioniert.</p>",
        });
      } finally {
        transporter.close();
      }
      this.monitoring?.recordSmtpDelivery(true);
    } catch (error) {
      this.monitoring?.recordSmtpDelivery(false);
      throw error;
    }
    return { recipient, sentAt: new Date().toISOString() };
  }

  async sendPasswordReset(input: PasswordResetMail): Promise<void> {
    try {
      const configuration = await this.requiredConfiguration(true);
      const siteName = await this.settings.getValue("site_name", "AD-Wiki");
      const transporter = this.transporter(configuration);
      const safeName = escapeHtml(input.displayName);
      const safeSiteName = escapeHtml(siteName);
      const safeUrl = escapeHtml(input.resetUrl);
      try {
        await transporter.sendMail({
          from: { name: configuration.fromName, address: configuration.fromEmail },
          to: input.recipient,
          replyTo: configuration.replyTo ?? undefined,
          subject: `Passwort für ${siteName} zurücksetzen`,
          text: [
            `Hallo ${input.displayName},`,
            "",
            `über diesen Link kannst du dein Passwort für ${siteName} zurücksetzen:`,
            input.resetUrl,
            "",
            `Der Link ist ${input.expiresMinutes} Minuten gültig und kann nur einmal verwendet werden.`,
            "Wenn du die Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.",
          ].join("\n"),
          html: [
            `<p>Hallo ${safeName},</p>`,
            `<p>über den folgenden Link kannst du dein Passwort für <strong>${safeSiteName}</strong> zurücksetzen:</p>`,
            `<p><a href="${safeUrl}">Passwort zurücksetzen</a></p>`,
            `<p>Der Link ist ${input.expiresMinutes} Minuten gültig und kann nur einmal verwendet werden.</p>`,
            "<p>Wenn du die Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.</p>",
          ].join(""),
        });
      } finally {
        transporter.close();
      }
      this.monitoring?.recordSmtpDelivery(true);
    } catch (error) {
      this.monitoring?.recordSmtpDelivery(false);
      throw error;
    }
  }

  private async requiredConfiguration(requireEnabled: boolean): Promise<PrismaSmtpConfiguration> {
    const configuration = await this.prisma.smtpConfiguration.findUnique({
      where: { id: SMTP_CONFIGURATION_ID },
    });
    if (!configuration || (requireEnabled && !configuration.isEnabled)) {
      throw new ServiceUnavailableException("SMTP ist noch nicht vollständig konfiguriert und aktiviert.");
    }
    return configuration;
  }

  private transporter(configuration: PrismaSmtpConfiguration): Transporter {
    const password = configuration.encryptedPassword
      ? this.encryption.decrypt(configuration.encryptedPassword)
      : undefined;
    const security = configuration.security as SmtpSecurity;
    return createTransport({
      host: configuration.host,
      port: configuration.port,
      secure: security === "tls",
      requireTLS: security === "starttls",
      auth: configuration.username
        ? { user: configuration.username, pass: password ?? "" }
        : undefined,
      tls: {
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        ...(isIP(configuration.host) === 0 ? { servername: configuration.host } : {}),
      },
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });
  }

  private toApi(configuration: PrismaSmtpConfiguration): SmtpConfiguration {
    return {
      host: configuration.host,
      port: configuration.port,
      security: configuration.security as SmtpSecurity,
      username: configuration.username,
      fromEmail: configuration.fromEmail,
      fromName: configuration.fromName,
      replyTo: configuration.replyTo,
      isEnabled: configuration.isEnabled,
      hasPassword: configuration.encryptedPassword !== null,
      updatedAt: configuration.updatedAt.toISOString(),
    };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
