import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleBottomNav } from "@/components/article-bottom-nav";
import { ArticleComment } from "@/components/article-comment";
import { ArticleCopyright } from "@/components/article-copyright";
import { ArticleMeta } from "@/components/article-meta";
import { ContentEnhancer } from "@/components/content-enhancer";
import {
  getAllPosts,
  getPostBySlug,
  getPostSiblings,
} from "@/lib/content/posts";
import { siteConfig } from "@/lib/site-config";

interface PostPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: PostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) {
    return { title: "文章不存在" };
  }

  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      publishedTime: new Date(post.dateTime).toISOString(),
      url: `${siteConfig.siteUrl}/${post.slug}`,
      images: post.cover ? [{ url: post.cover }] : undefined,
    },
  };
}

export default async function PostPage({ params }: PostPageProps) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const siblings = getPostSiblings(slug);

  return (
    <main className="mx-auto w-full max-w-[860px] px-4 pb-12 pt-6 md:px-6">
      <ArticleMeta post={post} />
      <ContentEnhancer />

      <article className="article-body article-content mt-6">
        <div dangerouslySetInnerHTML={{ __html: post.html }} />
      </article>

      <ArticleCopyright title={post.title} date={post.date} slug={post.slug} />
      <ArticleBottomNav prev={siblings.prev} next={siblings.next} />
      <ArticleComment slug={post.slug} title={post.title} />
    </main>
  );
}
