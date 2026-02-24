import { ArticleList } from "@/components/article-list";
import { CategoryNav } from "@/components/category-nav";
import { PaginationNav } from "@/components/pagination-nav";
import { API_PAGE_HITS, type PageHitItem } from "@/lib/analytics";
import { getAllPosts, getCategoryMeta } from "@/lib/content/posts";
import { articlePageSize } from "@/lib/site-config";

interface HomePageProps {
  searchParams: Promise<{ category?: string; page?: string }>;
}

export default async function Home({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const currentCategory = params.category;
  const page = Number(params.page ?? "1");

  const allPosts = getAllPosts();
  const categoryMeta = getCategoryMeta();
  let hitsLoading = false;
  const hitsMap = new Map<string, number>();

  try {
    const hitsRes = await fetch(API_PAGE_HITS, { cache: "no-store" });
    const hitsJson = (await hitsRes.json()) as { data?: PageHitItem[] };
    for (const item of hitsJson.data ?? []) {
      hitsMap.set(item.page.replace(/^\//, ""), item.hit);
    }
  } catch {
    hitsLoading = true;
  }

  const posts =
    currentCategory && currentCategory !== "hot"
      ? allPosts.filter((post) => post.categories.includes(currentCategory))
      : allPosts;

  const sortedPosts =
    currentCategory === "hot"
      ? [...posts].sort(
          (a, b) => (hitsMap.get(b.slug) ?? 0) - (hitsMap.get(a.slug) ?? 0),
        )
      : posts;

  const pageTotal = Math.ceil(sortedPosts.length / articlePageSize);
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const start = (safePage - 1) * articlePageSize;
  const visiblePosts = sortedPosts.slice(start, start + articlePageSize);

  return (
    <main className="pb-8 pt-2">
      <CategoryNav
        currentCategory={currentCategory}
        categoryCounts={categoryMeta}
      />
      <ArticleList
        posts={visiblePosts}
        hitsMap={hitsMap}
        hitsLoading={hitsLoading}
      />
      <PaginationNav
        category={currentCategory}
        page={safePage}
        pageTotal={pageTotal}
      />
    </main>
  );
}
