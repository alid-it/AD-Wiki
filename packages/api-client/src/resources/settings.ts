import { z } from 'zod';
import {
  BrandingSettingsSchema,
  SettingSchema,
  SmtpConfigurationSchema,
  SmtpTestResultSchema,
  SystemInfoSchema,
  type BrandingSettings,
  type Setting,
  type SmtpConfiguration,
  type SmtpTestResult,
  type SystemInfo,
  type UpdateSettingInput,
  type UpdateSmtpConfigurationInput,
} from '@ad-wiki/shared-types';
import { requestData } from '../http';

/** Öffentliches Plattform-Branding lesen (`GET /settings/branding`). */
export function getBranding(signal?: AbortSignal): Promise<BrandingSettings> {
  return requestData(BrandingSettingsSchema, '/settings/branding', { signal });
}

/** Alle Settings auflisten (`GET /settings`, Admin). */
export function list(signal?: AbortSignal): Promise<Setting[]> {
  return requestData(z.array(SettingSchema), '/settings', { auth: true, signal });
}

/** Ein Setting ändern (`PATCH /settings/:key`, Admin). */
export function update(key: string, input: UpdateSettingInput): Promise<Setting> {
  return requestData(SettingSchema, `/settings/${key}`, {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}

/** SMTP-Konfiguration ohne geheimes Passwort lesen. */
export function getSmtp(signal?: AbortSignal): Promise<SmtpConfiguration> {
  return requestData(SmtpConfigurationSchema, '/settings/smtp', { auth: true, signal });
}

/** SMTP-Konfiguration speichern. */
export function updateSmtp(input: UpdateSmtpConfigurationInput): Promise<SmtpConfiguration> {
  return requestData(SmtpConfigurationSchema, '/settings/smtp', {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}

/** Verbindung prüfen und Testmail an den angemeldeten Admin senden. */
export function testSmtp(): Promise<SmtpTestResult> {
  return requestData(SmtpTestResultSchema, '/settings/smtp/test', {
    method: 'POST',
    auth: true,
  });
}

/** Geschützte Betriebsübersicht für die Admin-Oberfläche lesen. */
export function getSystemInfo(signal?: AbortSignal): Promise<SystemInfo> {
  return requestData(SystemInfoSchema, '/settings/system-info', { auth: true, signal });
}
