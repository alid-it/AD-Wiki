import { z } from 'zod';

/**
 * Rollen sind persistente Datensätze und deshalb nicht auf die drei
 * mitgelieferten Systemrollen beschränkt.
 */
export const UserRole = z.string().trim().min(2).max(50);
export type UserRole = z.infer<typeof UserRole>;

export const RoleOptionSchema = z.object({
  id: z.string().uuid(),
  name: UserRole,
  isSystem: z.boolean(),
});
export type RoleOption = z.infer<typeof RoleOptionSchema>;

export const RoleSchema = RoleOptionSchema.extend({
  description: z.string().nullable(),
  userCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type Role = z.infer<typeof RoleSchema>;

export const CreateRoleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Rollennamen dürfen nur Kleinbuchstaben, Zahlen, _ und - enthalten.'),
  description: z.string().trim().max(300).optional().default(''),
}).strict();
export type CreateRoleInput = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(50)
      .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Rollennamen dürfen nur Kleinbuchstaben, Zahlen, _ und - enthalten.')
      .optional(),
    description: z.string().trim().max(300).nullable().optional(),
  })
  .strict()
  .refine((input) => input.name !== undefined || input.description !== undefined, {
    message: 'Es muss mindestens ein Feld geändert werden.',
  });
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  username: z.string().min(3).max(50),
  displayName: z.string().min(1).max(100),
  roleId: z.string().uuid(),
  role: UserRole,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type User = z.infer<typeof UserSchema>;

/**
 * Authentifizierter Benutzer, wie ihn Auth-Endpunkte ausliefern
 * (`/auth/login`, `/auth/register`, `/auth/me`). Enthält `isActive`,
 * aber keine Zeitstempel – bewusst schlanker als {@link UserSchema}.
 */
export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  username: z.string().min(3).max(50),
  displayName: z.string().min(1).max(100),
  roleId: z.string().uuid(),
  role: UserRole,
  isActive: z.boolean(),
  hasLocalPassword: z.boolean().default(true),
});

export type AuthUser = z.infer<typeof AuthUserSchema>;

/** Ergebnis von Login und Registrierung: User plus Token-Paar. */
export const AuthResultSchema = z.object({
  user: AuthUserSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
});

export type AuthResult = z.infer<typeof AuthResultSchema>;

/** Antwort von `POST /auth/refresh`: vollständig rotiertes Token-Paar. */
export const RefreshResultSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export type RefreshResult = z.infer<typeof RefreshResultSchema>;

const EmailInputSchema = z.string().trim().min(1).max(254).email();
const PasswordInputSchema = z.string().min(8).max(128);

export const LoginSchema = z.object({
  email: EmailInputSchema,
  password: PasswordInputSchema,
}).strict();

export type LoginInput = z.infer<typeof LoginSchema>;

export const RegisterSchema = z
  .object({
    email: EmailInputSchema,
    username: z.string().trim().min(3).max(50),
    displayName: z.string().trim().min(1).max(100),
    password: PasswordInputSchema,
    confirmPassword: z.string().min(1).max(128),
  })
  .strict()
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwörter stimmen nicht überein',
    path: ['confirmPassword'],
  });

export type RegisterInput = z.infer<typeof RegisterSchema>;

/** Neuen Benutzer durch einen Administrator anlegen. */
export const CreateUserSchema = z
  .object({
    email: EmailInputSchema,
    username: z.string().trim().min(3).max(50),
    displayName: z.string().trim().min(1).max(100),
    roleId: z.string().uuid(),
    password: PasswordInputSchema,
    confirmPassword: z.string().min(1).max(128),
  })
  .strict()
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwörter stimmen nicht überein',
    path: ['confirmPassword'],
  });
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

/** Neutrale öffentliche Anfrage einer Passwort-Reset-Mail. */
export const RequestPasswordResetSchema = z.object({
  email: EmailInputSchema,
}).strict();
export type RequestPasswordResetInput = z.infer<typeof RequestPasswordResetSchema>;

/** Neues Passwort mit einem einmalig verwendbaren Reset-Token setzen. */
export const ResetPasswordSchema = z
  .object({
    token: z.string().min(32).max(512),
    newPassword: PasswordInputSchema,
    confirmPassword: z.string().min(1).max(128),
  })
  .strict()
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwörter stimmen nicht überein',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

/** Passwort eines Benutzers als Administrator direkt neu setzen. */
export const AdminResetPasswordSchema = z
  .object({
    newPassword: PasswordInputSchema,
    confirmPassword: z.string().min(1).max(128),
  })
  .strict()
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwörter stimmen nicht überein',
    path: ['confirmPassword'],
  });
export type AdminResetPasswordInput = z.infer<typeof AdminResetPasswordSchema>;

export const MessageResultSchema = z.object({ message: z.string() }).strict();
export type MessageResult = z.infer<typeof MessageResultSchema>;

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1).max(8192),
}).strict();

export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;

/** Eingabe zum Bearbeiten des eigenen Profils (aktuell nur Anzeigename). */
export const UpdateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
}).strict();

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

/** Eingabe zum Ändern des Passworts. */
export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: PasswordInputSchema,
    confirmPassword: z.string().min(1).max(128),
  })
  .strict()
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwörter stimmen nicht überein',
    path: ['confirmPassword'],
  });

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

/**
 * Benutzer aus Admin-Sicht (Liste/Detail) – inkl. Aktiv-Status, Zeitstempel
 * und Anzahl erstellter Seiten. Antwort von GET /users bzw. GET /users/:id.
 */
export const AdminUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  username: z.string(),
  displayName: z.string(),
  roleId: z.string().uuid(),
  role: UserRole,
  isActive: z.boolean(),
  isProtected: z.boolean(),
  pageCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});

export type AdminUser = z.infer<typeof AdminUserSchema>;

/** Eingabe zum Bearbeiten normaler Kontofelder durch die Benutzerverwaltung. */
export const UpdateUserSchema = z
  .object({
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((d) => d.isActive !== undefined, {
    message: 'Es muss mindestens ein Feld geändert werden.',
  });

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

/** Sensible Rollenvergabe, bewusst getrennt von normalen Kontofeldern. */
export const AssignUserRoleSchema = z.object({
  roleId: z.string().uuid(),
}).strict();

export type AssignUserRoleInput = z.infer<typeof AssignUserRoleSchema>;
