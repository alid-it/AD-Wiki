'use client';

import { useEffect, useMemo, useReducer, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type Editor, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
  Link as LinkIcon,
  Image as ImageIcon,
  Loader2,
  Brackets,
} from 'lucide-react';
import { mediaIdFromUrl } from '@/lib/content';
import type { WikiLinkTarget } from '@/lib/wiki-links';
import { MediaPickerModal } from '@/components/editor/media-picker-modal';
import { AuthenticatedMediaImage } from '@/components/content/authenticated-media-image';

interface WysiwygEditorProps {
  value: string;
  onChange: (html: string) => void;
  wikiPages: WikiLinkTarget[];
  pageId?: string;
}

function ProtectedImageNode({ node }: NodeViewProps) {
  const attributes = node.attrs as { src?: string; alt?: string; title?: string };
  const mediaId = attributes.src ? mediaIdFromUrl(attributes.src) : null;
  return (
    <NodeViewWrapper className="my-4">
      {mediaId ? (
        <AuthenticatedMediaImage mediaId={mediaId} alt={attributes.alt ?? ''} title={attributes.title} className="max-w-full rounded-lg" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- externe Editor-Bildquelle
        <img src={attributes.src} alt={attributes.alt ?? ''} title={attributes.title} className="max-w-full rounded-lg" />
      )}
    </NodeViewWrapper>
  );
}

const ProtectedImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ProtectedImageNode);
  },
});

const btnBase =
  'flex h-9 w-9 items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

/** Ein Toolbar-Button mit Aktiv-Zustand. */
function ToolButton({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`${btnBase} ${
        active
          ? 'bg-accent-50 text-accent-700'
          : 'text-muted hover:bg-background hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Visueller (WYSIWYG) Editor auf Basis von Tiptap/ProseMirror.
 * Speichert intern als HTML (`editor.getHTML()`), das beim Anzeigen sanitisiert
 * wird. Link ist bereits in StarterKit v3 enthalten – deshalb nur Image ergänzt.
 */
export function WysiwygEditor({ value, onChange, wikiPages, pageId }: WysiwygEditorProps) {
  const t = useTranslations('editor.wysiwyg');
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [wikiQuery, setWikiQuery] = useState<string | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const suggestions = useMemo(() => wikiQuery === null ? [] : wikiPages.filter((page) => `${page.title} ${page.slug}`.toLowerCase().includes(wikiQuery.toLowerCase())).slice(0, 8), [wikiPages, wikiQuery]);
  const [, force] = useReducer((x: number) => x + 1, 0);

  const editor = useEditor({
    // Ohne diese Option warnt Next (SSR) vor Hydration-Mismatch.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer' } },
      }),
      ProtectedImage.configure({ inline: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'prose-content min-h-[65vh] px-4 py-4 focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => { onChange(editor.getHTML()); detectWikiQuery(editor); },
    onSelectionUpdate: ({ editor }) => detectWikiQuery(editor),
  });

  function detectWikiQuery(ed: Editor) {
    const { $from } = ed.state.selection;
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
    const match = before.match(/\[\[([^\]\n]*)$/);
    setWikiQuery(match ? match[1] : null);
    setActiveSuggestion(0);
  }

  function chooseWikiPage(page: WikiLinkTarget) {
    if (!editor || wikiQuery === null) return;
    const to = editor.state.selection.from;
    editor.chain().focus().deleteRange({ from: to - wikiQuery.length - 2, to }).insertContent(`[[${page.slug}]]`).run();
    setWikiQuery(null);
  }

  // Toolbar-Aktivzustände bei jeder Transaktion aktualisieren.
  useEffect(() => {
    if (!editor) return;
    const update = () => force();
    editor.on('transaction', update);
    editor.on('selectionUpdate', update);
    return () => {
      editor.off('transaction', update);
      editor.off('selectionUpdate', update);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor || wikiQuery === null) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setWikiQuery(null);
      } else if (suggestions.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        setActiveSuggestion((current) => (current + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
      } else if (suggestions.length > 0 && event.key === 'Enter') {
        event.preventDefault();
        chooseWikiPage(suggestions[activeSuggestion]);
      }
    };
    editor.view.dom.addEventListener('keydown', handleKeyDown);
    return () => editor.view.dom.removeEventListener('keydown', handleKeyDown);
  }, [editor, wikiQuery, suggestions, activeSuggestion]);

  if (!editor) {
    return (
      <div className="flex min-h-[480px] items-center justify-center rounded-xl border border-border bg-surface">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  function setLink(ed: Editor) {
    const previous = ed.getAttributes('link').href as string | undefined;
    const url = window.prompt(t('linkPrompt'), previous ?? 'https://');
    if (url === null) return;
    if (url === '') {
      ed.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    ed.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  return (
    <>
    <div className="relative flex flex-col rounded-xl border border-border bg-surface">
      {/* Toolbar – bleibt beim Scrollen unter der Navbar kleben */}
      <div className="sticky top-14 z-20 flex flex-wrap items-center gap-0.5 rounded-t-xl border-b border-border bg-surface/95 px-2 py-1.5 backdrop-blur-sm">
        <ToolButton label={t('bold')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-4 w-4" />
        </ToolButton>
        <ToolButton label={t('italic')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-4 w-4" />
        </ToolButton>

        <span className="mx-1 h-5 w-px bg-border" />

        <ToolButton label={t('heading1')} active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
          <Heading1 className="h-4 w-4" />
        </ToolButton>
        <ToolButton label={t('heading2')} active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton label={t('heading3')} active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="h-4 w-4" />
        </ToolButton>

        <span className="mx-1 h-5 w-px bg-border" />

        <ToolButton label={t('bulletList')} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-4 w-4" />
        </ToolButton>
        <ToolButton label={t('orderedList')} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-4 w-4" />
        </ToolButton>
        <ToolButton label={t('taskList')} active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>
          <ListChecks className="h-4 w-4" />
        </ToolButton>
        <ToolButton label={t('quote')} active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="h-4 w-4" />
        </ToolButton>
        <ToolButton label={t('codeBlock')} active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
          <Code2 className="h-4 w-4" />
        </ToolButton>

        <span className="mx-1 h-5 w-px bg-border" />

        <ToolButton label={t('link')} active={editor.isActive('link')} onClick={() => setLink(editor)}>
          <LinkIcon className="h-4 w-4" />
        </ToolButton>
        <ToolButton label={t('wikiLink')} onClick={() => { editor.chain().focus().insertContent('[[').run(); setWikiQuery(''); setActiveSuggestion(0); }}>
          <Brackets className="h-4 w-4" />
        </ToolButton>
        <ToolButton label={t('insertImage')} onClick={() => setMediaPickerOpen(true)}>
          <ImageIcon className="h-4 w-4" />
        </ToolButton>
      </div>

      <EditorContent editor={editor} />
      {wikiQuery !== null && <div className="absolute left-4 right-4 top-14 z-30 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-soft-lg">{suggestions.length === 0 ? <p className="px-3 py-2 text-sm text-muted">{t('noWikiPages')}</p> : suggestions.map((page, index) => <button key={page.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => chooseWikiPage(page)} className={`flex min-h-10 w-full flex-col justify-center rounded-lg px-3 text-left transition-colors cursor-pointer ${index === activeSuggestion ? 'bg-accent-50' : 'hover:bg-background'}`}><span className="text-sm font-medium text-foreground">{page.title}</span><span className="text-xs text-muted">[[{page.slug}]]</span></button>)}</div>}
    </div>
    {mediaPickerOpen && (
      <MediaPickerModal
        pageId={pageId}
        onClose={() => setMediaPickerOpen(false)}
        onSelect={(item, url) => editor.chain().focus().setImage({ src: url, alt: item.filename }).run()}
      />
    )}
    </>
  );
}
