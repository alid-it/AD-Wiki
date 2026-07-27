'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Network } from 'lucide-react';
import { pages } from '@ad-wiki/api-client';
import { InteractiveGraph } from '@/components/wiki/interactive-graph';
import { ACCESS_CONTROL_UPDATED_EVENT } from '@/lib/access-control-events';

type Graph = Awaited<ReturnType<typeof pages.graph>>;
export default function GraphPage() {
  const t = useTranslations('graph');
  const [mode, setMode] = useState<'wiki' | 'mcp'>('wiki');
  const [graph, setGraph] = useState<Graph | null>(null);
  const [accessRevision, setAccessRevision] = useState(0);
  useEffect(() => { const controller = new AbortController(); pages.graph(mode, controller.signal).then(setGraph).catch(() => setGraph(null)); return () => controller.abort(); }, [accessRevision, mode]);
  useEffect(() => {
    const reloadForAccessChange = () => setAccessRevision((value) => value + 1);
    window.addEventListener(ACCESS_CONTROL_UPDATED_EVENT, reloadForAccessChange);
    return () => window.removeEventListener(ACCESS_CONTROL_UPDATED_EVENT, reloadForAccessChange);
  }, []);
  return <div className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground"><Network className="h-6 w-6 text-brand-600" />{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div><div className="flex rounded-lg border border-border bg-surface p-1">{(['wiki','mcp'] as const).map((item) => <button key={item} type="button" onClick={() => setMode(item)} aria-pressed={mode === item} className={`min-h-9 rounded-md px-3 text-sm font-medium transition-colors cursor-pointer ${mode === item ? 'bg-accent-600 text-white' : 'text-muted hover:bg-background'}`}>{t(item)}</button>)}</div></div>{!graph ? <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div> : graph.nodes.length === 0 ? <div className="rounded-xl border border-border bg-surface py-20 text-center text-sm text-muted">{t('empty')}</div> : <InteractiveGraph graph={graph} mode={mode} />}</div>;
}
