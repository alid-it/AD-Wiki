# Frontend-Regeln (Next.js)

## Framework
- Next.js App Router, KEINE Pages Router
- Server Components als Standard
- "use client" nur bei interaktiven Komponenten
- Bilder über next/image mit alt-Text

## Design & Styling
- IMMER zuerst design-system/MASTER.md lesen
- Prüfen ob design-system/pages/[seitenname].md existiert
  → wenn ja: dessen Regeln haben Vorrang vor MASTER.md
  → wenn nein: MASTER.md exklusiv befolgen
- Skill ui-ux-pro-max für alle UI-Entscheidungen
- Tailwind CSS v4, kein inline CSS, kein CSS Modules
- Schriftart: Inter (via next/font/google)
- Farben: über CSS-Variablen aus globals.css (@theme Block)
- Brand-Farbe Navbar: Orange (bg-brand-600, #ea580c)
- Akzentfarbe interaktive Elemente: Blau (accent-600, #2563eb)

## Responsive – MOBILE FIRST
- Immer vom kleinsten Bildschirm starten
- Breakpoints: sm (640px), md (768px), lg (1024px), xl (1280px)
- Touch-Targets: mindestens 44x44px
- Sidebar auf Mobile: Overlay, nicht nebeneinander
- Tabellen auf Mobile: horizontal scrollbar oder Card-Layout
- Texte: max-w-prose für Lesbarkeit

## Motion & Animation
- Seitenübergänge: sanftes Einblenden beim Navigieren
- Sidebar: animiertes Auf-/Zuklappen
- Karten/Listen: gestaffeltes Einblenden beim Laden
- Hover-Effekte: dezente Scale- oder Shadow-Änderung
- ABER: Artikel-Leseansicht → minimal bis keine Animation
- IMMER prefers-reduced-motion respektieren

## Komponenten
- Dateiname: PascalCase.tsx (z.B. WikiSidebar.tsx)
- Props-Interface immer definieren
- Eine Komponente pro Datei
- Pfad: components/[bereich]/[Name].tsx

## API-Aufrufe
- NUR über packages/api-client
- Nie direktes fetch() in Komponenten
- Loading-States: Skeleton-Loader statt Spinner
- Fehler: User-freundliche deutsche Meldung

## Sidebar (Kern-Feature)
- Kollabierbar mit Animation
- Desktop: offen, Mobile: geschlossen
- Baumstruktur: Kategorie → Ordner → Seite (via parent_id)
- Icons: lucide-react (FolderIcon, FileTextIcon, ChevronRight)
- Aktuell geöffnete Seite hervorheben

## Navbar
- Persistent top, Orange Brand-Farbe
- Tabs: Dashboard, Wiki, Media
- User-Menu rechts

## Zukunft: Mobile App
- Logik so schreiben, dass sie in React Native wiederverwendbar ist
- UI-Komponenten sauber von Business-Logik trennen
- API-Calls zentral in api-client, nicht in Komponenten
