import { PublicPageClient } from '@/components/content/public-page-client';

export default async function PublicWikiPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicPageClient slug={slug} />;
}
