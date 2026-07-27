-- GIN-Index für die Volltextsuche (PostgreSQL FTS).
-- Beschleunigt die Suche in search.service.ts drastisch, da der Ausdruck
-- exakt der dortigen `to_tsvector('german', title || ' ' || content)`-Abfrage
-- entspricht und so vom Query-Planer genutzt werden kann.
-- Prisma kann funktionale GIN-Indizes nicht automatisch generieren, daher manuell.
CREATE INDEX "idx_pages_fts" ON "pages"
  USING GIN (to_tsvector('german', title || ' ' || content));
