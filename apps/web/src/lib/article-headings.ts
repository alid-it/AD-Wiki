import { isHtmlContent } from '@/lib/content';

export interface ArticleHeading {
  id: string;
  level: number;
  text: string;
}

const HTML_HEADING = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;

function plainText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => label ?? target)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function baseId(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('de-DE')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'abschnitt';
}

function withUniqueIds(headings: Array<Omit<ArticleHeading, 'id'>>): ArticleHeading[] {
  const counts = new Map<string, number>();
  return headings.map((heading) => {
    const base = baseId(heading.text);
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return { ...heading, id: count === 1 ? base : `${base}-${count}` };
  });
}

function htmlHeadings(content: string): ArticleHeading[] {
  const headings: Array<Omit<ArticleHeading, 'id'>> = [];
  for (const match of content.matchAll(HTML_HEADING)) {
    const text = plainText(match[2]);
    if (text) headings.push({ level: Number(match[1]), text });
  }
  return withUniqueIds(headings);
}

function markdownHeadings(content: string): ArticleHeading[] {
  const headings: Array<Omit<ArticleHeading, 'id'>> = [];
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let fenceMarker = '';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const atx = /^\s{0,3}(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (atx) {
      const text = plainText(atx[2]);
      if (text) headings.push({ level: atx[1].length, text });
      continue;
    }

    const next = lines[index + 1];
    if (line.trim() && next && /^\s{0,3}(=+|-+)\s*$/.test(next)) {
      const text = plainText(line);
      if (text) headings.push({ level: next.trim().startsWith('=') ? 1 : 2, text });
      index += 1;
    }
  }

  return withUniqueIds(headings);
}

/** Extrahiert die sichtbaren Überschriften in Dokumentreihenfolge. */
export function extractArticleHeadings(content: string): ArticleHeading[] {
  return isHtmlContent(content) ? htmlHeadings(content) : markdownHeadings(content);
}

/** Ergänzt sanitisiertes WYSIWYG-HTML um dieselben stabilen IDs wie das Inhaltsverzeichnis. */
export function addHeadingIdsToHtml(content: string, headings: ArticleHeading[]): string {
  let index = 0;
  return content.replace(/<h([1-4])\b([^>]*)>/gi, (tag, level: string, attributes: string) => {
    const heading = headings[index];
    index += 1;
    if (!heading || heading.level !== Number(level)) return tag;
    const withoutId = attributes.replace(/\s+id=(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
    return `<h${level}${withoutId} id="${heading.id}">`;
  });
}
