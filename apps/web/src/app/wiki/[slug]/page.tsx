import { ArticlePageClient } from '@/components/content/article-page-client';

interface Props {
  params: Promise<{ slug: string }>;
}

export const dynamic = 'force-dynamic';

export default async function WikiArticlePage({ params }: Props) {
  const { slug } = await params;
  return <ArticlePageClient slug={slug} />;
}
