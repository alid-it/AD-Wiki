import { z } from 'zod';

export const SmtpSecuritySchema = z.enum(['starttls', 'tls']);
export type SmtpSecurity = z.infer<typeof SmtpSecuritySchema>;

const NullableEmailSchema = z.union([z.string().trim().email().max(254), z.null()]);
const NullableUsernameSchema = z.union([z.string().trim().min(1).max(254), z.null()]);

/** Sichere SMTP-Konfiguration ohne das gespeicherte Passwort. */
export const SmtpConfigurationSchema = z.object({
  host: z.string().max(253),
  port: z.number().int().min(1).max(65535),
  security: SmtpSecuritySchema,
  username: NullableUsernameSchema,
  fromEmail: z.union([z.literal(''), z.string().email().max(254)]),
  fromName: z.string().max(100),
  replyTo: NullableEmailSchema,
  isEnabled: z.boolean(),
  hasPassword: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
}).strict();
export type SmtpConfiguration = z.infer<typeof SmtpConfigurationSchema>;

/** Vollständiges SMTP-Update; ein fehlendes Passwort behält das gespeicherte Secret bei. */
export const UpdateSmtpConfigurationSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  security: SmtpSecuritySchema,
  username: NullableUsernameSchema,
  password: z.string().min(1).max(2000).optional(),
  clearPassword: z.boolean().default(false),
  fromEmail: z.string().trim().email().max(254),
  fromName: z.string().trim().min(1).max(100),
  replyTo: NullableEmailSchema,
  isEnabled: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.password && value.clearPassword) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['password'],
      message: 'Passwort und Passwort-Löschung dürfen nicht gleichzeitig gesetzt sein.',
    });
  }
  if (!value.username && value.password) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['username'],
      message: 'Für ein SMTP-Passwort ist ein Benutzername erforderlich.',
    });
  }
});
export type UpdateSmtpConfigurationInput = z.infer<typeof UpdateSmtpConfigurationSchema>;

export const SmtpTestResultSchema = z.object({
  recipient: z.string().email(),
  sentAt: z.string().datetime(),
}).strict();
export type SmtpTestResult = z.infer<typeof SmtpTestResultSchema>;
