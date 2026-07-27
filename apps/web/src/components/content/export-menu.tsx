'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileText, Loader2 } from 'lucide-react';

export interface ExportOption<T extends string> {
  value: T;
  label: string;
  kind: 'pdf' | 'markdown';
}

export function ExportMenu<T extends string>({ label, options, busy, onSelect }: {
  label: string;
  options: ExportOption<T>[];
  busy?: T | null;
  onSelect: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={Boolean(busy)}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {label}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 min-w-56 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-soft-lg">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onSelect(option.value); }}
              className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-foreground transition-colors hover:bg-background"
            >
              {option.kind === 'pdf' ? <FileText className="h-4 w-4 text-danger-600" /> : <FileText className="h-4 w-4 text-accent-700" />}
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
