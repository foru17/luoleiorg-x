import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ArticleList } from "@/components/article-list";
import { CategoryNav } from "@/components/category-nav";
import { PaginationNav } from "@/components/pagination-nav";
import { getPostListing, isKnownCategory } from "@/lib/content/listings";
import { siteConfig } from "@/lib/site-config";
import { categoryPageUrl, parsePositivePage } from "@/lib/utils";

interface HomePageProps {
  searchParams: Promise<{ category?: string; page?: string }>;
}

export async function generateMetadata({
  searchParams,
}: HomePageProps): Promise<Metadata> {
  const params = await searchParams;
  const rawCategory = params.category?.trim().toLowerCase();
  const page = parsePositivePage(params.page);

  if (rawCategory) {
    if (!isKnownCategory(rawCategory)) {
      return {
        title: "分类不存在",
        robots: {
          index: false,
          follow: false,
        },
      };
    }

    return {
      alternates: {
        canonical: `${siteConfig.siteUrl}${categoryPageUrl(rawCategory, page)}`,
      },
    };
  }

  // SEO 友好格式：/page/2
  const canonical =
    page > 1 ? `${siteConfig.siteUrl}/page/${page}` : siteConfig.siteUrl;

  return {
    alternates: {
      canonical,
    },
    title: page > 1 ? `第 ${page} 页` : undefined,
  };
}

export default async function Home({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const rawCategory = params.category?.trim().toLowerCase();
  const page = parsePositivePage(params.page);

  // 如果有分类参数，重定向到分类页面
  if (rawCategory) {
    if (!isKnownCategory(rawCategory)) {
      notFound();
    }

    permanentRedirect(categoryPageUrl(rawCategory, page));
  }

  // 如果有 page 参数且 page > 1，重定向到 SEO 友好路径 /page/N
  if (params.page && page > 1) {
    permanentRedirect(`/page/${page}`);
  }

  // page <= 1 时，如果 URL 中有 ?page=1，也重定向到首页
  if (params.page && page <= 1) {
    permanentRedirect("/");
  }

  const listing = await getPostListing({ pageParam: params.page });

  if (listing.requestedPage > listing.pageTotal) {
    notFound();
  }

  return (
    <main className="pb-8 pt-2">
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
