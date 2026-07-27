export interface WikiLinkTarget {
  id: string;
  title: string;
  slug: string;
}

export function wikiLinkMarkdown(content: string): string {
  return content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => {
    const slug = slugFromWikiTarget(target);
    return slug ? `[${(label || target).trim()}](/wiki/${slug})` : _match;
  });
}

export function wikiLinkHtml(content: string): string {
  return content.replace(/\[\[([^<>\]|]+)(?:\|([^<>\]]+))?\]\]/g, (_match, target: string, label?: string) => {
    const slug = slugFromWikiTarget(target);
    if (!slug) return _match;
    return `<a href="/wiki/${slug}">${escapeHtml((label || target).trim())}</a>`;
  });
}

function slugFromWikiTarget(value: string): string {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
