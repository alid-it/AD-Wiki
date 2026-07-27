import { z } from 'zod';

/** Datentyp eines Settings-Werts (steuert die UI-Darstellung). */
export const SettingType = z.enum(['string', 'boolean', 'number']);
export type SettingType = z.infer<typeof SettingType>;

/** Ein einzelnes Setting, wie es die API ausliefert. */
export const SettingSchema = z.object({
  key: z.string(),
  value: z.string(),
  type: SettingType,
  description: z.string().nullable(),
});
export type Setting = z.infer<typeof SettingSchema>;

/** Öffentlich lesbare Branding-Einstellungen der Plattform. */
export const BrandingSettingsSchema = z.object({
  siteName: z.string().trim().min(1).max(80),
});
export type BrandingSettings = z.infer<typeof BrandingSettingsSchema>;

/** Eingabe zum Ändern eines Settings (`PATCH /settings/:key`). */
export const UpdateSettingSchema = z.object({
  value: z.string(),
  confirmRisk: z.boolean().optional(),
});
export type UpdateSettingInput = z.infer<typeof UpdateSettingSchema>;

/** Bekannte Setting-Schlüssel (Default-Settings). */
export const SETTING_KEYS = {
  siteName: 'site_name',
  allowRegistration: 'allow_registration',
  defaultRole: 'default_role',
  localLoginEnabled: 'local_login_enabled',
} as const;
