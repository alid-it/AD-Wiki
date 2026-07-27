'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Bold,
  Italic,
  Heading,
  Link as LinkIcon,
  Code,
  List,
  Image as ImageIcon,
  Eye,
  Pencil,
  Columns2,
  Brackets,
} from 'lucide-react';
import { MarkdownView } from '@/components/content/markdown-view';
import type { WikiLinkTarget } from '@/lib/wiki-links';
import { MediaPickerModal } from '@/components/editor/media-picker-modal';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  wikiPages: WikiLinkTarget[];
  pageId?: string;
}

type ViewMode = 'edit' | 'preview' | 'split';

const toolbarButton =
  'flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * Schlanker Markdown-Editor: Monospace-Textarea mit Tab-Einrückung, Toolbar
 * für gängige Formatierungen und umschaltbarer Vorschau (react-markdown).
 * Bilder werden direkt hochgeladen und als Markdown-Bild eingefügt.
 */
export function MarkdownEditor({ value, onChange, wikiPages, pageId }: MarkdownEditorProps) {
  const t = useTranslations('editor.md');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<ViewMode>('edit');
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [wikiQuery, setWikiQuery] = useState<string | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const suggestions = useMemo(() => wikiQuery === null ? [] : wikiPages.filter((page) => `${page.title} ${page.slug}`.toLowerCase().includes(wikiQuery.toLowerCase())).slice(0, 8), [wikiPages, wikiQuery]);

  // Textarea wächst mit dem Inhalt mit, damit man endlos nach unten schreiben
  // kann, ohne einen inneren Scrollbalken – die Seite selbst scrollt (wie Wiki.js).
  function autoGrow(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }
  useEffect(() => { autoGrow(textareaRef.current); }, [value, mode]);

  function detectWikiQuery(next: string, cursor: number) {
    const match = next.slice(0, cursor).match(/\[\[([^\]\n]*)$/);
    setWikiQuery(match ? match[1] : null);
    setActiveSuggestion(0);
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.target.value);
    detectWikiQuery(event.target.value, event.target.selectionStart);
  }

  function chooseWikiPage(page: WikiLinkTarget) {
    const element = textareaRef.current;
    if (!element || wikiQuery === null) return;
    const cursor = element.selectionStart;
    const start = cursor - wikiQuery.length - 2;
    const insertion = `[[${page.slug}]]`;
    onChange(value.slice(0, start) + insertion + value.slice(cursor));
    setWikiQuery(null);
    requestAnimationFrame(() => { const position = start + insertion.length; element.focus(); element.setSelectionRange(position, position); });
  }

  /** Ersetzt die aktuelle Auswahl und stellt Fokus/Cursor wieder her. */
  function replaceSelection(transform: (selected: string) => { text: string; cursor?: number }) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    const { text, cursor } = transform(selected);
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    // Cursor nach dem eingefügten Text (oder an vorgegebener Position) setzen.
    const pos = cursor ?? start + text.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  const wrap = (before: string, after = before, placeholder = '') =>
    replaceSelection((s) => {
      const inner = s || placeholder;
      return { text: `${before}${inner}${after}`, cursor: undefined };
    });

  const linePrefix = (prefix: string) =>
    replaceSelection((s) => {
      const lines = (s || 'Text').split('\n');
      return { text: lines.map((l) => `${prefix}${l}`).join('\n') };
    });

  function startWikiLink() {
    replaceSelection(() => ({ text: '[[' }));
    setWikiQuery('');
    setActiveSuggestion(0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (wikiQuery !== null) {
      if (e.key === 'Escape') { e.preventDefault(); setWikiQuery(null); return; }
    }
    if (wikiQuery !== null && suggestions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActiveSuggestion((current) => (current + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length); return; }
      if (e.key === 'Enter') { e.preventDefault(); chooseWikiPage(suggestions[activeSuggestion]); return; }
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      // Zwei Leerzeichen einrücken (bei Auswahl davor eingefügt).
      replaceSelection((s) => ({ text: `  ${s}` }));
    }
  }

  const modeButton = (target: ViewMode, extra = '') =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${extra} ${
      mode === target
        ? 'bg-surface text-foreground shadow-soft-sm'
        : 'text-muted hover:text-foreground'
    }`;

  return (
    <>
    <div className="flex flex-col rounded-xl border border-border bg-surface">
      {/* Toolbar – bleibt beim Scrollen unter der Navbar kleben */}
      <div className="sticky top-14 z-20 flex flex-wrap items-center justify-between gap-2 rounded-t-xl border-b border-border bg-surface/95 px-2 py-1.5 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-0.5">
          <button type="button" className={toolbarButton} onClick={() => wrap('**', '**', t('boldPlaceholder'))} aria-label={t('bold')} title={t('bold')}>
            <Bold className="h-4 w-4" />
          </button>
          <button type="button" className={toolbarButton} onClick={() => wrap('*', '*', t('italicPlaceholder'))} aria-label={t('italic')} title={t('italic')}>
            <Italic className="h-4 w-4" />
          </button>
          <button type="button" className={toolbarButton} onClick={() => linePrefix('## ')} aria-label={t('heading')} title={t('heading')}>
            <Heading className="h-4 w-4" />
          </button>
          <button type="button" className={toolbarButton} onClick={() => wrap('[', '](https://)', t('linkText'))} aria-label={t('link')} title={t('link')}>
            <LinkIcon className="h-4 w-4" />
          </button>
          <button type="button" className={toolbarButton} onClick={startWikiLink} aria-label={t('wikiLink')} title={t('wikiLink')}>
            <Brackets className="h-4 w-4" />
          </button>
          <button type="button" className={toolbarButton} onClick={() => wrap('`', '`', t('codePlaceholder'))} aria-label={t('code')} title={t('code')}>
            <Code className="h-4 w-4" />
          </button>
          <button type="button" className={toolbarButton} onClick={() => linePrefix('- ')} aria-label={t('list')} title={t('list')}>
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={toolbarButton}
            onClick={() => setMediaPickerOpen(true)}
            aria-label={t('insertImage')}
            title={t('insertImage')}
          >
            <ImageIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Ansicht umschalten */}
        <div className="flex items-center gap-0.5 rounded-lg bg-background p-0.5">
          <button type="button" className={modeButton('edit')} onClick={() => setMode('edit')}>
            <Pencil className="h-3.5 w-3.5" />
            {t('edit')}
          </button>
          <button type="button" className={modeButton('preview')} onClick={() => setMode('preview')}>
            <Eye className="h-3.5 w-3.5" />
            {t('preview')}
          </button>
          <button type="button" className={modeButton('split', 'hidden lg:flex')} onClick={() => setMode('split')}>
            <Columns2 className="h-3.5 w-3.5" />
            {t('split')}
          </button>
        </div>
      </div>

      {/* Editor / Vorschau */}
      <div className={mode === 'split' ? 'grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-border' : ''}>
        {mode !== 'preview' && (
          <div className="relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onClick={(event) => detectWikiQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            placeholder={t('editorPlaceholder')}
            className="min-h-[65vh] w-full resize-none overflow-hidden bg-transparent p-4 font-mono text-sm leading-6 text-foreground placeholder:text-muted focus:outline-none"
          />
          {wikiQuery !== null && <WikiSuggestions suggestions={suggestions} active={activeSuggestion} onChoose={chooseWikiPage} empty={t('noWikiPages')} />}
          </div>
        )}
        {mode !== 'edit' && (
          <div className="min-h-[65vh] p-4">
            {value.trim() ? (
              <MarkdownView content={value} />
            ) : (
              <p className="text-sm text-muted">{t('noPreview')}</p>
            )}
          </div>
        )}
      </div>
    </div>
    {mediaPickerOpen && (
      <MediaPickerModal
        pageId={pageId}
        onClose={() => setMediaPickerOpen(false)}
        onSelect={(item, url) => replaceSelection(() => ({ text: `![${item.filename}](${url})` }))}
      />
    )}
    </>
  );
}

function WikiSuggestions({ suggestions, active, onChoose, empty }: { suggestions: WikiLinkTarget[]; active: number; onChoose: (page: WikiLinkTarget) => void; empty: string }) {
  return <div className="absolute left-4 right-4 top-14 z-30 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-soft-lg">{suggestions.length === 0 ? <p className="px-3 py-2 text-sm text-muted">{empty}</p> : suggestions.map((page, index) => <button key={page.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onChoose(page)} className={`flex min-h-10 w-full flex-col justify-center rounded-lg px-3 text-left transition-colors cursor-pointer ${index === active ? 'bg-accent-50' : 'hover:bg-background'}`}><span className="text-sm font-medium text-foreground">{page.title}</span><span className="text-xs text-muted">[[{page.slug}]]</span></button>)}</div>;
}
