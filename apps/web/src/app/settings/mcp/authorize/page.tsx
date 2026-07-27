'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Check, Loader2, ShieldCheck, X } from 'lucide-react';
import { mcpTokens, ApiClientError } from '@ad-wiki/api-client';
import type { McpOAuthAuthorizationRequest } from '@ad-wiki/shared-types';

export default function McpOAuthAuthorizePage() {
  const requestId = useSearchParams().get('request_id');
  const [request, setRequest] = useState<McpOAuthAuthorizationRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<'approve' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!requestId) {
      setError('Die OAuth-Anfrage ist unvollständig.');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    mcpTokens.oauthRequest(requestId, controller.signal)
      .then(setRequest)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof ApiClientError ? reason.message : 'Die OAuth-Anfrage konnte nicht geladen werden.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [requestId]);

  async function decide(action: 'approve' | 'deny') {
    if (!requestId) return;
    setSubmitting(action);
    setError(null);
    try {
      const result = action === 'approve'
        ? await mcpTokens.approveOAuth(requestId)
        : await mcpTokens.denyOAuth(requestId);
      window.location.assign(result.redirectUrl);
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : 'Die Entscheidung konnte nicht gespeichert werden.');
      setSubmitting(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground">MCP-Zugriff erlauben</h2>
          <p className="mt-1 text-sm text-muted">Prüfe, welcher Client auf dein AD-Wiki-Wissen zugreifen möchte.</p>
        </div>
      </div>

      {error && <div role="alert" className="flex gap-2 rounded-xl border border-danger-500/30 bg-danger-50 p-4 text-sm text-danger-600"><AlertCircle className="h-5 w-5 shrink-0" />{error}</div>}

      {loading ? (
        <div className="flex justify-center rounded-xl border border-border bg-surface py-16"><Loader2 className="h-7 w-7 animate-spin text-muted" /></div>
      ) : request ? (
        <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
          <h3 className="text-lg font-semibold text-foreground">{request.clientName}</h3>
          <p className="mt-1 break-all text-xs text-muted">Weiterleitung: {request.redirectUri}</p>
          <div className="mt-5 rounded-lg bg-background p-4">
            <p className="text-sm font-semibold text-foreground">Angeforderte Rechte</p>
            <ul className="mt-3 grid gap-2 text-sm text-muted">
              <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 text-success-600" />Sichtbare Wiki-Seiten, Notizen und Richtlinien lesen</li>
              {request.scopes.includes('mcp:write') && <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 text-warning-600" />Entwürfe und private Notizen über MCP erstellen oder bearbeiten</li>}
            </ul>
          </div>
          <p className="mt-4 text-xs text-muted">Es gelten immer deine aktuellen AD-Wiki-Berechtigungen. Du kannst den Zugriff später über deine MCP-Tokens widerrufen.</p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" disabled={submitting !== null} onClick={() => void decide('deny')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-60"><X className="h-4 w-4" />Ablehnen</button>
            <button type="button" disabled={submitting !== null} onClick={() => void decide('approve')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{submitting === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Zugriff erlauben</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
