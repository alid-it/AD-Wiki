'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';
import { RegisterSchema } from '@ad-wiki/shared-types';
import { ApiClientError } from '@ad-wiki/api-client';
import { AuthShell } from '@/components/auth/auth-shell';
import { useAuth } from '@/lib/auth-context';

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-4 py-3 text-base text-foreground transition-colors placeholder:text-muted focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20';

/** Reihenfolge und Felder des Registrierungsformulars. */
type FormState = {
  email: string;
  username: string;
  displayName: string;
  password: string;
  confirmPassword: string;
};

const EMPTY_FORM: FormState = {
  email: '',
  username: '',
  displayName: '',
  password: '',
  confirmPassword: '',
};

export default function RegisterPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { register } = useAuth();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const update = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [key]: e.target.value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    setFormError(null);
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    // Validierung als Single Source of Truth aus shared-types.
    const parsed = RegisterSchema.safeParse(form);
    if (!parsed.success) {
      const errors: Partial<Record<keyof FormState, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FormState;
        if (key && !errors[key]) errors[key] = registrationError(key, form, t);
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      await register(parsed.data);
      router.replace('/');
    } catch (err) {
      setFormError(err instanceof ApiClientError ? err.message : t('registerFailed'));
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title={t('registerTitle')}
      subtitle={t('registerSubtitle')}
      footer={
        <>
          {t('haveAccount')}{' '}
          <Link
            href="/login"
            className="font-medium text-accent-600 transition-colors hover:text-accent-700"
          >
            {t('signInLink')}
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {formError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <Field
          id="email"
          label={t('email')}
          type="email"
          autoComplete="email"
          placeholder={t('emailPlaceholder')}
          value={form.email}
          onChange={update('email')}
          error={fieldErrors.email}
          maxLength={254}
        />
        <Field
          id="username"
          label={t('username')}
          autoComplete="username"
          placeholder={t('usernamePlaceholder')}
          value={form.username}
          onChange={update('username')}
          error={fieldErrors.username}
          maxLength={50}
        />
        <Field
          id="displayName"
          label={t('displayName')}
          autoComplete="name"
          placeholder={t('displayNamePlaceholder')}
          value={form.displayName}
          onChange={update('displayName')}
          error={fieldErrors.displayName}
          maxLength={100}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            {t('password')}
          </label>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              maxLength={128}
              value={form.password}
              onChange={update('password')}
              placeholder={t('passwordMinPlaceholder')}
              className={`${inputClass} pr-11`}
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={fieldErrors.password ? 'register-password-error' : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t('hidePassword') : t('showPassword')}
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted transition-colors hover:text-foreground cursor-pointer"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {fieldErrors.password && (
            <p id="register-password-error" role="alert" className="text-xs text-danger-600">{fieldErrors.password}</p>
          )}
        </div>

        <Field
          id="confirmPassword"
          label={t('confirmPassword')}
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder={t('confirmPasswordPlaceholder')}
          value={form.confirmPassword}
          onChange={update('confirmPassword')}
          error={fieldErrors.confirmPassword}
          maxLength={128}
        />

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-soft-sm transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? t('registering') : t('registerSubmit')}
        </button>
      </form>
    </AuthShell>
  );
}

interface FieldProps {
  id: keyof FormState;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  maxLength?: number;
}

/** Einfaches, beschriftetes Eingabefeld mit optionaler Fehlermeldung. */
function Field({
  id,
  label,
  value,
  onChange,
  error,
  type = 'text',
  autoComplete,
  placeholder,
  maxLength,
}: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxLength={maxLength}
        className={inputClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-danger-600">{error}</p>}
    </div>
  );
}

function registrationError(
  field: keyof FormState,
  form: FormState,
  t: ReturnType<typeof useTranslations<'auth'>>,
): string {
  if (field === 'email') return form.email.trim() ? t('emailInvalid') : t('emailRequired');
  if (field === 'username') return form.username.trim() ? t('usernameLength') : t('usernameRequired');
  if (field === 'displayName') return form.displayName.trim() ? t('displayNameLength') : t('displayNameRequired');
  if (field === 'password') return form.password ? t('passwordLength') : t('passwordRequired');
  return form.confirmPassword ? t('passwordsMismatch') : t('confirmPasswordRequired');
}
