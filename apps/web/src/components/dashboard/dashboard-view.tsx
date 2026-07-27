'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Activity,
  ArrowRight,
  BookOpen,
  Bot,
  Clock,
  FileText,
  LayoutDashboard,
  Loader2,
  NotebookPen,
  Plus,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { notes, pages, standards } from '@ad-wiki/api-client';
import {
  SOCKET_EVENTS,
  type NoteChangedEvent,
  type StandardChangedEvent,
  type WikiNotification,
} from '@ad-wiki/shared-types';
import type { DashboardStats, RecentKnowledge } from '@/lib/dashboard-data';
import { useLocaleSwitcher } from '@/lib/i18n-context';
import { DashboardActivity } from '@/components/dashboard/activity-widget';
import { useAuth } from '@/lib/auth-context';
import { useSocketEvent } from '@/lib/socket-context';
import { ACCESS_CONTROL_UPDATED_EVENT } from '@/lib/access-control-events';
import {
  KnowledgePageHeader,
  knowledgeHeaderPrimaryAction,
  knowledgeHeaderSecondaryAction,
} from '@/components/ui/knowledge-page-header';

const EMPTY_STATS: DashboardStats = {
  pages: 0,
  published: 0,
  drafts: 0,
  notes: 0,
  captured: 0,
  shared: 0,
  standards: 0,
  activeStandards: 0,
  reviewStandards: 0,
  mcpVisible: 0,
};

async function loadOptional<T>(enabled: boolean, request: () => Promise<T>) {
  if (!enabled) return { value: null as T | null, failed: false };
  try {
    return { value: await request(), failed: false };
  } catch {
    return { value: null as T | null, failed: true };
  }
}

function RecentKnowledgeList({ recent }: { recent: RecentKnowledge[] }) {
  const t = useTranslations('dashboard');
  const { locale } = useLocaleSwitcher();
  const kindConfig = {
    wiki: { icon: FileText, label: t('kindWiki'), tone: 'bg-accent-50 text-accent-700' },
    note: { icon: NotebookPen, label: t('kindNote'), tone: 'bg-brand-50 text-brand-700' },
    standard: { icon: ShieldCheck, label: t('kindStandard'), tone: 'bg-success-50 text-success-600' },
  } as const;
  const formatDate = (iso: string) => new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-US', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));

  if (recent.length === 0) {
    return <div className="flex flex-col items-center justify-center px-6 py-16 text-center"><BookOpen className="h-8 w-8 text-muted" /><p className="mt-3 text-sm font-medium text-foreground">{t('noKnowledgeTitle')}</p><p className="mt-1 max-w-sm text-sm text-muted">{t('noKnowledgeHint')}</p></div>;
  }

  return <ul className="divide-y divide-border">{recent.map((item) => {
    const config = kindConfig[item.kind];
    const Icon = config.icon;
    return <li key={`${item.kind}:${item.id}`}><Link href={item.href} className="group flex items-center gap-3 px-5 py-3 transition-colors duration-200 hover:bg-background cursor-pointer"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${config.tone}`}><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{item.title}</span><span className="mt-0.5 flex items-center gap-2 text-xs text-muted"><span>{config.label}</span><span aria-hidden="true">·</span><span>{t(`recentStatus_${item.kind}_${item.status}`)}</span></span></span><span className="hidden shrink-0 text-xs text-muted sm:block">{formatDate(item.updatedAt)}</span><ArrowRight className="h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-accent-700" /></Link></li>;
  })}</ul>;
}

export function DashboardView() {
  const t = useTranslations('dashboard');
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canReadPages = hasPermission('pages', 'read');
  const canReadNotes = hasPermission('notes', 'read');
  const canReadStandards = hasPermission('standards', 'read');
  const canCreatePages = hasPermission('pages', 'create');
  const canCreateNotes = hasPermission('notes', 'create');
  const canCreateStandards = hasPermission('standards', 'create');
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [recent, setRecent] = useState<RecentKnowledge[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (authLoading) return;
    setLoading(true);
    const [wiki, published, drafts, noteResult, standardResult, mcpGraph] = await Promise.all([
      loadOptional(canReadPages, () => pages.list({ page: 1, perPage: 100, type: 'page' }, signal)),
      loadOptional(canReadPages, () => pages.list({ page: 1, perPage: 1, status: 'published', type: 'page' }, signal)),
      loadOptional(canReadPages, () => pages.list({ page: 1, perPage: 1, status: 'draft', type: 'page' }, signal)),
      loadOptional(canReadNotes, () => notes.list({ scope: 'all' }, signal)),
      loadOptional(canReadStandards, () => standards.list({}, signal)),
      loadOptional(canReadPages, () => pages.graph('mcp', signal)),
    ]);
    if (signal?.aborted) return;

    const wikiPages = wiki.value?.data.filter((page) => page.type === 'page') ?? [];
    const noteItems = noteResult.value ?? [];
    const standardItems = standardResult.value ?? [];
    const graphMcpCount = mcpGraph.value?.nodes.filter((node) => ['page', 'note', 'standard'].includes(node.type)).length;
    const fallbackMcpCount = wikiPages.filter((page) => page.mcpVisible).length + noteItems.filter((note) => note.mcpVisible).length + standardItems.filter((standard) => standard.mcpVisible && standard.status === 'active').length;

    setStats({
      pages: wiki.value?.meta.total ?? 0,
      published: published.value?.meta.total ?? 0,
      drafts: drafts.value?.meta.total ?? 0,
      notes: noteItems.length,
      captured: noteItems.filter((note) => note.status === 'captured').length,
      shared: noteItems.filter((note) => !note.isOwner).length,
      standards: standardItems.length,
      activeStandards: standardItems.filter((standard) => standard.status === 'active').length,
      reviewStandards: standardItems.filter((standard) => standard.status === 'review').length,
      mcpVisible: graphMcpCount ?? fallbackMcpCount,
    });

    setRecent([
      ...wikiPages.map((page): RecentKnowledge => ({ id: page.id, title: page.title, kind: 'wiki', href: `/wiki/${page.slug}`, status: page.status, updatedAt: page.updatedAt })),
      ...noteItems.map((note): RecentKnowledge => ({ id: note.id, title: note.title?.trim() || t('untitledNote'), kind: 'note', href: '/notes', status: note.status, updatedAt: note.updatedAt })),
      ...standardItems.map((standard): RecentKnowledge => ({ id: standard.id, title: standard.title, kind: 'standard', href: `/standards?standard=${standard.id}`, status: standard.status, updatedAt: standard.updatedAt })),
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8));
    setFailed([wiki, published, drafts, noteResult, standardResult, mcpGraph].some((result) => result.failed));
    setLoading(false);
  }, [authLoading, canReadNotes, canReadPages, canReadStandards, t]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useSocketEvent<WikiNotification>(SOCKET_EVENTS.notification, (event) => {
    if (event.resource === 'page' || event.resource === 'category') void load();
  });
  useSocketEvent<NoteChangedEvent>(SOCKET_EVENTS.notesChanged, () => void load());
  useSocketEvent<StandardChangedEvent>(SOCKET_EVENTS.standardsChanged, () => void load());
  useEffect(() => {
    const reloadForAccessChange = () => void load();
    window.addEventListener(ACCESS_CONTROL_UPDATED_EVENT, reloadForAccessChange);
    return () => window.removeEventListener(ACCESS_CONTROL_UPDATED_EVENT, reloadForAccessChange);
  }, [load]);

  const metrics = useMemo(() => [
    ...(canReadPages ? [{ key: 'wiki', label: t('wikiPages'), value: stats.pages, detail: t('wikiBreakdown', { published: stats.published, drafts: stats.drafts }), rank: 2, href: '/wiki', icon: BookOpen, tone: 'bg-accent-50 text-accent-700' }] : []),
    ...(canReadNotes ? [{ key: 'notes', label: t('notes'), value: stats.notes, detail: t('notesBreakdown', { captured: stats.captured, shared: stats.shared }), rank: 3, href: '/notes', icon: NotebookPen, tone: 'bg-brand-50 text-brand-700' }] : []),
    ...(canReadStandards ? [{ key: 'standards', label: t('standards'), value: stats.standards, detail: t('standardsBreakdown', { active: stats.activeStandards, review: stats.reviewStandards }), rank: 1, href: '/standards', icon: ShieldCheck, tone: 'bg-success-50 text-success-600' }] : []),
    ...((canReadPages || canReadNotes || canReadStandards) ? [{ key: 'mcp', label: t('mcpKnowledge'), value: stats.mcpVisible, detail: t('mcpKnowledgeHint'), rank: null, href: '/wiki/graph', icon: Bot, tone: 'bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300' }] : []),
  ], [canReadNotes, canReadPages, canReadStandards, stats, t]);

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
      <KnowledgePageHeader
        icon={LayoutDashboard}
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<>
          {canCreateStandards && <Link href="/standards?new=1" className={knowledgeHeaderSecondaryAction}><ShieldCheck className="h-4 w-4" />{t('newStandard')}</Link>}
          {canCreateNotes && <Link href="/notes?new=1" className={knowledgeHeaderSecondaryAction}><NotebookPen className="h-4 w-4" />{t('newNote')}</Link>}
          {canCreatePages && <Link href="/wiki/new" className={knowledgeHeaderPrimaryAction}><Plus className="h-4 w-4" />{t('newPage')}</Link>}
        </>}
      />

      {failed && <div className="mt-6 flex items-center gap-3 rounded-xl border border-warning-500/30 bg-warning-50 px-4 py-3 text-sm text-warning-700"><WifiOff className="h-5 w-5 shrink-0" /><span>{t('partialDataUnavailable')}</span></div>}

      {authLoading || loading ? <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div> : <>
        <section className="mt-6" aria-labelledby="knowledge-overview-title">
          <div className="mb-3 flex items-center justify-between gap-3"><div><h2 id="knowledge-overview-title" className="text-sm font-semibold text-foreground">{t('knowledgeOverview')}</h2><p className="mt-0.5 text-xs text-muted">{t('knowledgeOverviewHint')}</p></div></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map((metric, index) => <Link key={metric.key} href={metric.href} style={{ animationDelay: `${index * 60}ms` }} className="group animate-fade-in-up rounded-xl border border-border bg-surface p-5 transition-colors duration-200 hover:border-accent-300 hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 cursor-pointer"><div className="flex items-start justify-between gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-lg ${metric.tone}`}><metric.icon className="h-5 w-5" /></span>{metric.rank !== null && <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-muted">{t('knowledgeRank', { rank: metric.rank })}</span>}</div><p className="mt-4 text-3xl font-semibold tracking-tight text-foreground">{metric.value}</p><div className="mt-1 flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold text-foreground">{metric.label}</p><p className="mt-0.5 truncate text-xs text-muted">{metric.detail}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-accent-700" /></div></Link>)}</div>
        </section>

        <div className="mt-6 grid grid-cols-12 gap-4">
          <section className="col-span-12 rounded-xl border border-border bg-surface lg:col-span-8"><div className="flex items-center gap-2 border-b border-border px-5 py-4"><Clock className="h-4 w-4 text-muted" /><h2 className="text-sm font-semibold text-foreground">{t('recentKnowledge')}</h2></div><RecentKnowledgeList recent={recent} /></section>
          <section className="col-span-12 rounded-xl border border-border bg-surface lg:col-span-4"><div className="flex items-center gap-2 border-b border-border px-5 py-4"><Activity className="h-4 w-4 text-muted" /><h2 className="text-sm font-semibold text-foreground">{t('activity')}</h2></div><DashboardActivity /></section>
        </div>
      </>}
    </div>
  );
}
