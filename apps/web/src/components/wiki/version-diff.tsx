'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { diffLines, type Change } from 'diff';

export type DiffMode = 'split' | 'unified';

interface VersionDiffProps {
  oldText: string;
  newText: string;
  mode: DiffMode;
}

type CellType = 'ctx' | 'add' | 'del';

interface Cell {
  num: number | null;
  text: string;
  type: CellType;
}

interface SplitRow {
  left: Cell | null;
  right: Cell | null;
}

interface UnifiedRow {
  oldNum: number | null;
  newNum: number | null;
  text: string;
  type: CellType;
}

/** Zerlegt einen Diff-Abschnitt in einzelne Zeilen (ohne abschließende Leerzeile). */
function toLines(part: Change): string[] {
  const value = part.value.endsWith('\n') ? part.value.slice(0, -1) : part.value;
  // Leerer Abschnitt liefert keine Zeilen.
  return value === '' ? [] : value.split('\n');
}

/** Baut die Zeilen für die Unified-Ansicht. */
function buildUnified(changes: Change[]): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  let oldNum = 1;
  let newNum = 1;
  for (const part of changes) {
    const lines = toLines(part);
    for (const text of lines) {
      if (part.added) {
        rows.push({ oldNum: null, newNum: newNum++, text, type: 'add' });
      } else if (part.removed) {
        rows.push({ oldNum: oldNum++, newNum: null, text, type: 'del' });
      } else {
        rows.push({ oldNum: oldNum++, newNum: newNum++, text, type: 'ctx' });
      }
    }
  }
  return rows;
}

/** Baut die Zeilen für die Side-by-Side-Ansicht (paart Löschungen mit Ergänzungen). */
function buildSplit(changes: Change[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let oldNum = 1;
  let newNum = 1;

  for (let i = 0; i < changes.length; i += 1) {
    const part = changes[i];
    const lines = toLines(part);

    if (!part.added && !part.removed) {
      for (const text of lines) {
        rows.push({
          left: { num: oldNum++, text, type: 'ctx' },
          right: { num: newNum++, text, type: 'ctx' },
        });
      }
      continue;
    }

    if (part.removed) {
      const next = changes[i + 1];
      // Löschung direkt gefolgt von Ergänzung → Zeilen paaren.
      if (next?.added) {
        const removedLines = lines;
        const addedLines = toLines(next);
        const max = Math.max(removedLines.length, addedLines.length);
        for (let k = 0; k < max; k += 1) {
          rows.push({
            left:
              k < removedLines.length
                ? { num: oldNum++, text: removedLines[k], type: 'del' }
                : null,
            right:
              k < addedLines.length
                ? { num: newNum++, text: addedLines[k], type: 'add' }
                : null,
          });
        }
        i += 1; // Ergänzung wurde mitverarbeitet.
      } else {
        for (const text of lines) {
          rows.push({ left: { num: oldNum++, text, type: 'del' }, right: null });
        }
      }
      continue;
    }

    // reine Ergänzung
    for (const text of lines) {
      rows.push({ left: null, right: { num: newNum++, text, type: 'add' } });
    }
  }

  return rows;
}

const CELL_BG: Record<CellType, string> = {
  ctx: '',
  add: 'bg-success-50 text-success-600',
  del: 'bg-danger-50 text-danger-600',
};

const GUTTER_BG: Record<CellType, string> = {
  ctx: 'text-muted',
  add: 'bg-success-50 text-success-600',
  del: 'bg-danger-50 text-danger-600',
};

const SIGN: Record<CellType, string> = { ctx: ' ', add: '+', del: '-' };

/**
 * Zeilenweiser Diff zweier Texte – wahlweise unified oder side-by-side.
 * Bewusst im GitHub-Stil: Zeilennummern-Gutter, monospace, farbige Zeilen.
 */
export function VersionDiff({ oldText, newText, mode }: VersionDiffProps) {
  const t = useTranslations('versions');
  const changes = useMemo(() => diffLines(oldText, newText), [oldText, newText]);
  const hasChanges = useMemo(() => changes.some((c) => c.added || c.removed), [changes]);

  if (!hasChanges) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
        {t('diff.noDifferences')}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        {mode === 'unified' ? (
          <UnifiedView rows={buildUnified(changes)} />
        ) : (
          <SplitView rows={buildSplit(changes)} />
        )}
      </div>
    </div>
  );
}

function UnifiedView({ rows }: { rows: UnifiedRow[] }) {
  return (
    <table className="w-full border-collapse font-mono text-xs">
      <tbody>
        {rows.map((row, idx) => (
          <tr key={idx} className={CELL_BG[row.type]}>
            <td className="w-10 select-none border-r border-border px-2 py-0.5 text-right align-top text-muted">
              {row.oldNum ?? ''}
            </td>
            <td className="w-10 select-none border-r border-border px-2 py-0.5 text-right align-top text-muted">
              {row.newNum ?? ''}
            </td>
            <td className="w-5 select-none px-1 py-0.5 text-center align-top">{SIGN[row.type]}</td>
            <td className="whitespace-pre-wrap break-words px-2 py-0.5 align-top leading-5">
              {row.text || ' '}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SplitView({ rows }: { rows: SplitRow[] }) {
  return (
    <table className="w-full table-fixed border-collapse font-mono text-xs">
      <colgroup>
        <col className="w-10" />
        <col />
        <col className="w-10" />
        <col />
      </colgroup>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={idx}>
            <SideCells cell={row.left} border />
            <SideCells cell={row.right} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Rendert Zeilennummer + Inhalt einer Seite in der Split-Ansicht. */
function SideCells({ cell, border }: { cell: Cell | null; border?: boolean }) {
  if (!cell) {
    return (
      <>
        <td className={`select-none bg-background ${border ? 'border-r border-border' : ''}`} />
        <td className={`bg-background ${border ? 'border-r border-border' : ''}`} />
      </>
    );
  }
  return (
    <>
      <td
        className={`select-none px-2 py-0.5 text-right align-top ${GUTTER_BG[cell.type]} ${
          border ? 'border-r border-border' : ''
        }`}
      >
        {cell.num ?? ''}
      </td>
      <td
        className={`whitespace-pre-wrap break-words px-2 py-0.5 align-top leading-5 ${
          CELL_BG[cell.type]
        } ${border ? 'border-r border-border' : ''}`}
      >
        {cell.text || ' '}
      </td>
    </>
  );
}
