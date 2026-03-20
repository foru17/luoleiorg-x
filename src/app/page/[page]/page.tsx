import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ArticleList } from "@/components/article-list";
import { CategoryNav } from "@/components/category-nav";
import { PaginationNav } from "@/components/pagination-nav";
import { RouteTransitionComplete } from "@/components/route-transition-complete";
import { getPostListing } from "@/lib/content/listings";
import { getAllPosts } from "@/lib/content/posts";
import { articlePageSize, siteConfig } from "@/lib/site-config";

interface PagePageProps {
  params: Promise<{ page: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  const totalPages = Math.max(1, Math.ceil(getAllPosts().length / articlePageSize));

  return Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => ({
    page: String(index + 2),
  }));
}

export async function generateMetadata({
  params,
}: PagePageProps): Promise<Metadata> {
  const { page } = await params;
  const pageNum = parseInt(page, 10);

  return {
    alternates: {
      canonical: `${siteConfig.siteUrl}/page/${pageNum}`,
    },
    title: `第 ${pageNum} 页`,
  };
}

export default async function PagePage({ params }: PagePageProps) {
  const { page } = await params;
  const pageNum = parseInt(page, 10);

  if (isNaN(pageNum) || pageNum < 2) {
    permanentRedirect("/");
  }

  const listing = await getPostListing({ pageParam: page });

  if (listing.requestedPage > listing.pageTotal) {
    notFound();
  }

  return (
    <main className="pb-8 pt-2">
      <RouteTransitionComplete />
      <CategoryNav />
      <ArticleList
        posts={listing.visiblePosts}
        hitsMap={listing.hitsMap}
        hitsLoading={listing.hitsLoading}
      />
      <PaginationNav page={listing.page} pageTotal={listing.pageTotal} />
    </main>
  );
}
