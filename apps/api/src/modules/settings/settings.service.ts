import { BadRequestException, ConflictException, Injectable, NotFoundException, type OnModuleInit } from "@nestjs/common";
import type { Setting as PrismaSetting } from "@prisma/client";
import type { BrandingSettings, Setting, UpdateSettingInput } from "@ad-wiki/shared-types";
import { PrismaService } from "@/prisma/prisma.service";

/** Definition eines Default-Settings (wird beim Start sichergestellt). */
interface DefaultSetting {
  key: string;
  value: string;
  type: "string" | "boolean" | "number";
  description: string;
}

/** Standard-Settings, die beim Start angelegt werden, falls sie fehlen. */
const DEFAULTS: DefaultSetting[] = [
  {
    key: "site_name",
    value: "AD-Wiki",
    type: "string",
    description: "Name der Plattform (Titel/Branding).",
  },
  {
    key: "allow_registration",
    value: "true",
    type: "boolean",
    description: "Ob sich neue Benutzer selbst registrieren dürfen.",
  },
  {
    key: "default_role",
    value: "viewer",
    type: "string",
    description: "Rolle, die neu registrierte Benutzer erhalten.",
  },
  {
    key: "local_login_enabled",
    value: "true",
    type: "boolean",
    description:
      "Lokale Anmeldung für normale Benutzer; das geschützte Notfallkonto bleibt immer lokal erreichbar.",
  },
];

/**
 * Verwaltung der plattformweiten Einstellungen (Key/Value-Store).
 * Legt beim Start fehlende Default-Settings idempotent an.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureDefaults();
  }

  /** Legt fehlende Default-Settings an (überschreibt bestehende nicht). */
  async ensureDefaults(): Promise<void> {
    for (const def of DEFAULTS) {
      await this.prisma.setting.upsert({
        where: { key: def.key },
        update: {},
        create: def,
      });
    }
  }

  /** Alle Settings auflisten. */
  async findAll(): Promise<Setting[]> {
    const settings = await this.prisma.setting.findMany({ orderBy: { key: "asc" } });
    return settings.map((s) => this.toApi(s));
  }

  /** Einen einzelnen Setting-Wert anhand des Schlüssels lesen (oder Fallback). */
  async getValue(key: string, fallback: string): Promise<string> {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    return setting?.value ?? fallback;
  }

  /** Liefert ausschließlich die öffentlich sichtbaren Branding-Werte. */
  async getBranding(): Promise<BrandingSettings> {
    return { siteName: await this.getValue("site_name", "AD-Wiki") };
  }

  /** Ein Setting ändern (nur der Wert; Typ/Beschreibung bleiben bestehen). */
  async update(key: string, input: UpdateSettingInput): Promise<Setting> {
    const existing = await this.prisma.setting.findUnique({ where: { key } });
    if (!existing) {
      throw new NotFoundException(`Setting "${key}" wurde nicht gefunden.`);
    }
    const value = key === "site_name" ? input.value.trim() : input.value;
    if (key === "site_name" && (value.length === 0 || value.length > 80)) {
      throw new BadRequestException("Der Seitenname muss zwischen 1 und 80 Zeichen lang sein.");
    }
    if (key === "default_role") {
      const role = await this.prisma.role.findUnique({
        where: { name: value },
        select: { id: true },
      });
      if (!role) {
        throw new BadRequestException("Die ausgewählte Standardrolle existiert nicht.");
      }
    }
    if (
      key === "local_login_enabled" &&
      value === "false" &&
      input.confirmRisk !== true
    ) {
      throw new ConflictException(
        "Das Deaktivieren der lokalen Anmeldung muss ausdrücklich bestätigt werden.",
      );
    }
    if (key === "local_login_enabled" && value === "false") {
      const activeProviders = await this.prisma.identityProvider.count({
        where: { isActive: true },
      });
      if (activeProviders === 0) {
        throw new BadRequestException(
          "Die lokale Anmeldung kann erst deaktiviert werden, wenn mindestens ein SSO-Anbieter aktiv ist.",
        );
      }
    }
    const updated = await this.prisma.setting.update({
      where: { key },
      data: { value },
    });
    return this.toApi(updated);
  }

  private toApi(setting: PrismaSetting): Setting {
    return {
      key: setting.key,
      value: setting.value,
      type: (setting.type as Setting["type"]) ?? "string",
      description: setting.description,
    };
  }
}
