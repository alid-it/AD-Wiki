import { WikiSidebar } from '@/components/layout/sidebar';

/**
 * Server-Layout des Wiki-Bereichs: lädt die Kategorie-Baumstruktur einmalig
 * serverseitig und übergibt sie an die interaktive Sidebar.
 */
export default function WikiLayout({ children }: { children: React.ReactNode }) {
  return (
    <WikiSidebar categories={[]}>
      {children}
    </WikiSidebar>
  );
}
