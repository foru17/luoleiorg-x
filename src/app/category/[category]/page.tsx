import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ArticleList } from "@/components/article-list";
import { CategoryNav } from "@/components/category-nav";
import { PaginationNav } from "@/components/pagination-nav";
import { RouteTransitionComplete } from "@/components/route-transition-complete";
import {
  getCategoryName,
  getPostListing,
  isKnownCategory,
} from "@/lib/content/listings";
import { getAllPosts } from "@/lib/content/posts";
import { categoryMap, siteConfig } from "@/lib/site-config";
import { categoryUrl, normalizeCategory, parsePositivePage } from "@/lib/utils";

interface CategoryPageProps {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ page?: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  const categories = new Set<string>(["hot"]);

  for (const post of getAllPosts()) {
    for (const category of post.categories) {
      categories.add(category);
    }
  }

  return categoryMap
    .filter((category) => categories.has(category.text))
    .map((category) => ({ category: category.text }));
}

export async function generateMetadata({
  params,
  searchParams,
}: CategoryPageProps): Promise<Metadata> {
  const { category } = await params;
  const query = await searchParams;
  const normalizedCategory = normalizeCategory(category);
  const queryPage = parsePositivePage(query.page);

  if (!isKnownCategory(normalizedCategory)) {
    return {
      title: "分类不存在",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const categoryName = getCategoryName(normalizedCategory);
  const canonicalPath =
    queryPage > 1
      ? `${categoryUrl(normalizedCategory)}/page/${queryPage}`
      : categoryUrl(normalizedCategory);

  return {
    title: `${categoryName} 分类文章`,
    description: `${siteConfig.title}中关于${categoryName}的文章归档与分页列表。`,
    alternates: {
      canonical: `${siteConfig.siteUrl}${canonicalPath}`,
    },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: CategoryPageProps) {
  const { category } = await params;
  const query = await searchParams;
  const normalizedCategory = normalizeCategory(category);
  const queryPage = parsePositivePage(query.page);

  if (!isKnownCategory(normalizedCategory)) {
    notFound();
  }

  if (category !== normalizedCategory) {
    permanentRedirect(categoryUrl(normalizedCategory));
  }

  if (query.page && queryPage <= 1) {
    permanentRedirect(categoryUrl(normalizedCategory));
  }

  if (queryPage > 1) {
    permanentRedirect(`${categoryUrl(normalizedCategory)}/page/${queryPage}`);
  }

  const listing = await getPostListing({ category: normalizedCategory });

  return (
    <main className="pb-8 pt-2">
      <RouteTransitionComplete />
      <CategoryNav currentCategory={normalizedCategory} />
      <ArticleList
        posts={listing.visiblePosts}
        hitsMap={listing.hitsMap}
        hitsLoading={listing.hitsLoading}
      />
      <PaginationNav
        category={normalizedCategory}
        page={listing.page}
        pageTotal={listing.pageTotal}
      />
    </main>
  );
}
