'use client';

import { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Monitor, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme, type ThemeMode } from '@/lib/theme-context';

/**
 * Kompakter Theme-Umschalter für die Navbar: ein kleiner Icon-Button, der ein
 * schlankes Menü mit den drei Modi Hell / Dunkel / System öffnet. Das Icon zeigt
 * das aktuell aktive Erscheinungsbild.
 */
export function ThemeToggle() {
  const t = useTranslations('theme');
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const options: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
    { mode: 'light', label: t('light'), icon: Sun },
    { mode: 'dark', label: t('dark'), icon: Moon },
    { mode: 'system', label: t('system'), icon: Monitor },
  ];

  const CurrentIcon = theme === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('toggle')}
        title={t('label')}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer"
      >
        <CurrentIcon className="h-5 w-5" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-40 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-soft-lg"
        >
          {options.map((option) => {
            const active = theme === option.mode;
            return (
              <button
                key={option.mode}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setTheme(option.mode);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground transition-colors hover:bg-background cursor-pointer"
              >
                <option.icon className="h-4 w-4 text-muted" />
                <span className="flex-1 text-left">{option.label}</span>
                {active && <Check className="h-4 w-4 text-accent-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
