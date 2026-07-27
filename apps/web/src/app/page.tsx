import { DashboardView } from '@/components/dashboard/dashboard-view';

// Kennzahlen sollen bei jedem Aufruf frisch geladen werden.
export const dynamic = 'force-dynamic';

/** Dashboard: lädt die Kennzahlen serverseitig und rendert die übersetzte Ansicht. */
export default function DashboardPage() {
  return <DashboardView />;
}
