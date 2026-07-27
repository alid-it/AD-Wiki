/**
 * Hilfsfunktionen rund um Seiteninhalte und Medien-URLs.
 * Bewusst ohne React – nutzbar in Server- und Client-Komponenten.
 */

/** Basis-URL der API (mit `/api/v1`). */
function apiBase(): string {
  return (
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) ||
    'http://localhost:4000/api/v1'
  );
}

/**
 * Baut die geschuetzte Stream-URL eines Mediums. Die Datei wird nie direkt aus
 * dem Upload-Verzeichnis ausgeliefert.
 */
export function mediaUrl(mediaId: string): string {
  return `${apiBase()}/media/${encodeURIComponent(mediaId)}/file`;
}

/** Extrahiert die Medien-ID aus einer API-Stream-URL. */
export function mediaIdFromUrl(url: string): string | null {
  return /\/api\/v1\/media\/([0-9a-f-]{36})\/file(?:[?#]|$)/i.exec(url)?.[1] ?? null;
}

/** True, wenn der Mimetype ein im Browser darstellbares Bild ist. */
export function isImageMime(mimetype: string): boolean {
  return ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimetype);
}

/** True, wenn der Mimetype ein PDF ist. */
export function isPdfMime(mimetype: string): boolean {
  return mimetype === 'application/pdf';
}

/**
 * True, wenn es sich um eine Markdown-Datei handelt. Prüft Mimetype UND
 * Dateiendung, da Browser für `.md` oft einen unspezifischen Mimetype senden.
 */
export function isMarkdownFile(mimetype: string, filename: string): boolean {
  return (
    mimetype === 'text/markdown' ||
    mimetype === 'text/x-markdown' ||
    /\.(md|markdown)$/i.test(filename)
  );
}

/**
 * Heuristik: Handelt es sich beim Inhalt um HTML (aus dem WYSIWYG-Editor) oder
 * um Markdown? Der WYSIWYG-Editor liefert stets ein umschließendes Tag am Anfang.
 * Bewusst konservativ – Grenzfälle (Markdown, das mit `<` beginnt) sind selten.
 */
export function isHtmlContent(content: string): boolean {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('<')) return false;
  return /<([a-z][a-z0-9]*)\b[^>]*>/i.test(trimmed);
}

/** Kürzt Inhalt zu einem reinen Text-Auszug (für Excerpts). */
export function toExcerpt(content: string, max = 200): string {
  const text = content
    .replace(/<[^>]+>/g, ' ') // HTML-Tags
    .replace(/[#>*_`~\-]/g, ' ') // Markdown-Zeichen
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // Bilder
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // Links → Linktext
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
