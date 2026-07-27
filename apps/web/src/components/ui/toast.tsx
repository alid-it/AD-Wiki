'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react';

/** Toast-Typ – steuert Farbe und Icon. */
export type ToastType = 'success' | 'info' | 'warning' | 'error';

/** Optionale, beschriftete Aktion innerhalb eines Toasts (z. B. „Neu laden"). */
interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  /** Optionaler Klick-Handler (z. B. Navigation zur betroffenen Seite). */
  onClick?: () => void;
  /** Optionale, explizit beschriftete Aktion (eigener Button im Toast). */
  action?: ToastAction;
}

/** Öffentliche API des Toast-Systems. */
interface ToastApi {
  success: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
  warning: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  dismiss: (id: string) => void;
}

interface ToastOptions {
  onClick?: () => void;
  action?: ToastAction;
}

const AUTO_DISMISS_MS = 5000;

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Stellt das Toast-System bereit und rendert den fixierten Container unten rechts.
 * Bewusst ohne externe Library – schlank und an das Design-System angelehnt.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((type: ToastType, message: string, options?: ToastOptions) => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [
      ...prev,
      { id, type, message, onClick: options?.onClick, action: options?.action },
    ]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, options) => push('success', message, options),
      info: (message, options) => push('info', message, options),
      warning: (message, options) => push('warning', message, options),
      error: (message, options) => push('error', message, options),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/** Zugriff auf das Toast-System. `const toast = useToast(); toast.success('…')`. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast muss innerhalb von <ToastProvider> verwendet werden.');
  }
  return ctx;
}

// ── Darstellung ─────────────────────────────────────────────────────

const TOAST_STYLES: Record<
  ToastType,
  { icon: typeof CheckCircle2; ring: string; iconColor: string }
> = {
  success: { icon: CheckCircle2, ring: 'border-success-500/30', iconColor: 'text-success-600' },
  info: { icon: Info, ring: 'border-accent-500/30', iconColor: 'text-accent-600' },
  warning: { icon: AlertTriangle, ring: 'border-warning-500/40', iconColor: 'text-warning-500' },
  error: { icon: XCircle, ring: 'border-danger-500/30', iconColor: 'text-danger-600' },
};

/** Fixierter Container unten rechts; neueste Toasts unten. */
function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-80"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const t = useTranslations('notifications');
  const { icon: Icon, ring, iconColor } = TOAST_STYLES[toast.type];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-Dismiss nach 5 Sekunden.
  useEffect(() => {
    timerRef.current = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, onDismiss]);

  const clickable = typeof toast.onClick === 'function';

  return (
    <div
      role="status"
      onClick={() => {
        if (clickable) {
          toast.onClick?.();
          onDismiss(toast.id);
        }
      }}
      className={`animate-toast-in pointer-events-auto flex items-start gap-3 rounded-xl border ${ring} bg-surface p-3.5 shadow-soft-lg ${
        clickable ? 'cursor-pointer transition-colors hover:bg-background' : ''
      }`}
    >
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconColor}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{toast.message}</p>
        {toast.action && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toast.action?.onClick();
              onDismiss(toast.id);
            }}
            className="mt-1.5 text-sm font-medium text-accent-600 transition-colors hover:text-accent-700 cursor-pointer"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(toast.id);
        }}
        aria-label={t('close')}
        className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground cursor-pointer"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
