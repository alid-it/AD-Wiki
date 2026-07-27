export interface DashboardStats {
  pages: number;
  published: number;
  drafts: number;
  notes: number;
  captured: number;
  shared: number;
  standards: number;
  activeStandards: number;
  reviewStandards: number;
  mcpVisible: number;
}

export interface RecentKnowledge {
  id: string;
  title: string;
  kind: 'wiki' | 'note' | 'standard';
  href: string;
  status: string;
  updatedAt: string;
}
