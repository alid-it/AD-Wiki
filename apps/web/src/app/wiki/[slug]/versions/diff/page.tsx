'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Loader2, AlertCircle, Columns2, AlignLeft, ArrowRight } from 'lucide-react';
import { loadVersions, type CombinedVersion } from '@/lib/version-utils';
import { VersionDiff, type DiffMode } from '@/components/wiki/version-diff';

function DiffView() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations('versions');

  const [versions, setVersions] = useState<CombinedVersion[]>([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<DiffMode>('split');

  useEffect(() => {
    const controller = new AbortController();
    loadVersions(slug, controller.signal)
      .then(({ page, versions }) => {
        setVersions(versions);
        setTitle(page.title);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(t('loadFailed'));
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [slug]);

  // Von/Zu-Auswahl: aus der URL, mit sinnvollen Defaults (Vorgänger → aktuell).
  const fromParam = Number(params.get('from'));
  const toParam = Number(params.get('to'));

  const { fromVersion, toVersion } = useMemo(() => {
    if (versions.length === 0) return { fromVersion: 0, toVersion: 0 };
    const nums = versions.map((v) => v.version);
    const current = nums[0];
    const previous = nums[1] ?? current;
    const to = nums.includes(toParam) ? toParam : current;
    const from = nums.includes(fromParam) ? fromParam : previous;
    return { fromVersion: from, toVersion: to };
  }, [versions, fromParam, toParam]);

  function setSelection(from: number, to: number) {
    router.replace(`/wiki/${slug}/versions/diff?from=${from}&to=${to}`);
  }

  const fromV = versions.find((v) => v.version === fromVersion);
  const toV = versions.find((v) => v.version === toVersion);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <AlertCircle className="mx-auto mb-3 h-8 w-8 text-muted" />
        <p className="mb-4 text-sm text-foreground">{error}</p>
        <Link
          href={`/wiki/${slug}`}
          className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background cursor-pointer"
        >
          {t('backToArticle')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
      {/* Kopf */}
      <div className="mb-6">
        <Link
          href={`/wiki/${slug}/versions`}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('diff.backToHistory')}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('diff.title')}</h1>
        {title && <p className="mt-1 text-sm text-muted">{title}</p>}
      </div>

      {/* Steuerung: Von / Zu / Modus */}
      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-end">
          <VersionSelect
            label={t('diff.fromVersion')}
            value={fromVersion}
            versions={versions}
            onChange={(v) => setSelection(v, toVersion)}
          />
          <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted sm:mb-3 sm:block" />
          <VersionSelect
            label={t('diff.toVersion')}
            value={toVersion}
            versions={versions}
            onChange={(v) => setSelection(fromVersion, v)}
          />
        </div>

        {/* Modus-Toggle */}
        <div className="flex items-center gap-0.5 rounded-lg bg-background p-0.5">
          <ModeButton active={mode === 'split'} onClick={() => setMode('split')} icon={Columns2}>
            {t('diff.sideBySide')}
          </ModeButton>
          <ModeButton active={mode === 'unified'} onClick={() => setMode('unified')} icon={AlignLeft}>
            {t('diff.unified')}
          </ModeButton>
        </div>
      </div>

      {/* Legende */}
      <div className="mb-3 flex items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-danger-50 ring-1 ring-danger-500/30" />
          {t('diff.removed', { version: fromVersion })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-success-50 ring-1 ring-success-500/30" />
          {t('diff.added', { version: toVersion })}
        </span>
      </div>

      {fromV && toV ? (
        <VersionDiff oldText={fromV.content} newText={toV.content} mode={mode} />
      ) : (
        <p className="text-sm text-muted">{t('diff.selectTwo')}</p>
      )}
    </div>
  );
}

function VersionSelect({
  label,
  value,
  versions,
  onChange,
}: {
  label: string;
  value: number;
  versions: CombinedVersion[];
  onChange: (v: number) => void;
}) {
  const t = useTranslations('versions');
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground transition-colors focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20 sm:w-56 cursor-pointer"
      >
        {versions.map((v) => (
          <option key={v.version} value={v.version}>
            v{v.version}
            {v.isCurrent ? t('diff.currentSuffix') : ''} – {v.authorName}
          </option>
        ))}
      </select>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Columns2;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
        active ? 'bg-surface text-foreground shadow-soft-sm' : 'text-muted hover:text-foreground'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

export default function DiffPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      }
    >
      <DiffView />
    </Suspense>
  );
}
