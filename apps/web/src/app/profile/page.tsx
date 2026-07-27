'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Loader2,
  Save,
  AlertCircle,
  Check,
  Mail,
  AtSign,
  Shield,
  KeyRound,
  Palette,
  Languages,
} from 'lucide-react';
import { users as usersApi, auth as authApi, ApiClientError } from '@ad-wiki/api-client';
import { ChangePasswordSchema } from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useTheme, type ThemeMode } from '@/lib/theme-context';
import { useLocaleSwitcher, type Locale } from '@/lib/i18n-context';
import { ApiKeysSection } from '@/components/profile/api-keys-section';
import { ExternalIdentitiesSection } from '@/components/profile/external-identities-section';

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground transition-colors placeholder:text-muted focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2);
  return letters.toUpperCase();
}

export default function ProfilePage() {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const { user, updateUser, isLoading } = useAuth();
  const router = useRouter();

  /** Übersetztes Rollen-Label. */
  const roleLabel = (role: string): string => {
    if (role === 'admin') return t('roleAdmin');
    if (role === 'editor') return t('roleEditor');
    if (role === 'viewer') return t('roleViewer');
    return role;
  };

  const [displayName, setDisplayName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState<string | null>(null);

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [savingPw, setSavingPw] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);

  useEffect(() => {
    if (user) setDisplayName(user.displayName);
  }, [user]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  async function saveName(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNameMsg(null);
    setNameErr(null);
    if (!displayName.trim()) {
      setNameErr(t('enterDisplayName'));
      return;
    }
    setSavingName(true);
    try {
      const updated = await usersApi.updateMe({ displayName: displayName.trim() });
      updateUser(updated);
      setNameMsg(t('saved'));
    } catch (err) {
      setNameErr(err instanceof ApiClientError ? err.message : t('saveFailed'));
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPwErr(null);
    const parsed = ChangePasswordSchema.safeParse(pw);
    if (!parsed.success) {
      setPwErr(t('invalidInput'));
      return;
    }
    setSavingPw(true);
    try {
      await authApi.changePassword(parsed.data);
      // Server hat alle Sessions verworfen → neu anmelden.
      router.replace('/login');
    } catch (err) {
      setPwErr(err instanceof ApiClientError ? err.message : t('passwordChangeFailed'));
      setSavingPw(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8">
      {/* Kopf mit Avatar */}
      <div className="mb-6 flex items-center gap-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-600 text-xl font-semibold text-white">
          {initials(user.displayName)}
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {user.displayName}
          </h1>
          <p className="text-sm text-muted">@{user.username}</p>
        </div>
      </div>

      {/* Stammdaten (read-only) */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ReadItem icon={Mail} label={t('email')} value={user.email} />
        <ReadItem icon={AtSign} label={t('username')} value={user.username} />
        <ReadItem icon={Shield} label={t('role')} value={roleLabel(user.role)} />
      </div>

      {/* Einstellungen: Erscheinungsbild und Sprache (pro Browser) */}
      <PreferencesCard />

      {/* Anzeigename ändern */}
      <form
        onSubmit={saveName}
        className="mb-6 flex flex-col gap-4 rounded-xl border border-border bg-surface p-5"
      >
        <h2 className="text-sm font-semibold text-foreground">{t('editProfile')}</h2>
        {nameErr && <Alert>{nameErr}</Alert>}
        {nameMsg && (
          <p className="flex items-center gap-1.5 text-sm text-success-600">
            <Check className="h-4 w-4" /> {nameMsg}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="displayName" className="text-sm font-medium text-foreground">
            {t('displayName')}
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingName}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-soft-sm transition-colors hover:bg-brand-700 disabled:opacity-70 cursor-pointer"
          >
            {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {tc('save')}
          </button>
        </div>
      </form>

      <ExternalIdentitiesSection />

      {/* Passwort ändern */}
      {user.hasLocalPassword && (
        <form
          onSubmit={savePassword}
          className="mb-6 flex flex-col gap-4 rounded-xl border border-border bg-surface p-5"
        >
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <KeyRound className="h-4 w-4 text-muted" />
          {t('changePassword')}
        </h2>
        <p className="-mt-2 text-xs text-muted">{t('changePasswordHint')}</p>
        {pwErr && <Alert>{pwErr}</Alert>}

        <PwField
          id="currentPassword"
          label={t('currentPassword')}
          value={pw.currentPassword}
          onChange={(v) => setPw((p) => ({ ...p, currentPassword: v }))}
        />
        <PwField
          id="newPassword"
          label={t('newPassword')}
          value={pw.newPassword}
          onChange={(v) => setPw((p) => ({ ...p, newPassword: v }))}
        />
        <PwField
          id="confirmPassword"
          label={t('confirmNewPassword')}
          value={pw.confirmPassword}
          onChange={(v) => setPw((p) => ({ ...p, confirmPassword: v }))}
        />

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingPw}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-background disabled:opacity-70 cursor-pointer"
          >
            {savingPw ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {t('changePassword')}
          </button>
        </div>
        </form>
      )}

      <ApiKeysSection />
    </div>
  );
}

/** Erscheinungsbild- und Sprach-Einstellung (pro Browser, sofort wirksam). */
function PreferencesCard() {
  const t = useTranslations('profile');
  const tt = useTranslations('theme');
  const tl = useTranslations('language');
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocaleSwitcher();
  const selectClass = `${inputClass} cursor-pointer`;

  return (
    <div className="mb-6 flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-foreground">{t('preferences')}</h2>
      <p className="-mt-2 text-xs text-muted">{t('preferencesHint')}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="pref-theme"
            className="flex items-center gap-1.5 text-sm font-medium text-foreground"
          >
            <Palette className="h-4 w-4 text-muted" />
            {t('appearance')}
          </label>
          <select
            id="pref-theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemeMode)}
            className={selectClass}
          >
            <option value="light">{tt('light')}</option>
            <option value="dark">{tt('dark')}</option>
            <option value="system">{tt('system')}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="pref-lang"
            className="flex items-center gap-1.5 text-sm font-medium text-foreground"
          >
            <Languages className="h-4 w-4 text-muted" />
            {t('language')}
          </label>
          <select
            id="pref-lang"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            className={selectClass}
          >
            <option value="de">{tl('de')}</option>
            <option value="en">{tl('en')}</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function ReadItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="mb-1 flex items-center gap-1.5 text-xs text-muted">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className="truncate text-sm font-medium text-foreground" title={value}>
        {value}
      </p>
    </div>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function PwField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        type="password"
        autoComplete={id === 'currentPassword' ? 'current-password' : 'new-password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  );
}
