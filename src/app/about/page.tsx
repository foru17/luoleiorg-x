import type { Metadata } from "next";
import { RouteTransitionComplete } from "@/components/route-transition-complete";
import { getMultiModelProfileData } from "@/lib/content/author-profile";
import { getAllPosts } from "@/lib/content/posts";
import { getPreviewImage } from "@/lib/content/utils";
import { siteConfig } from "@/lib/site-config";
import { AboutPageClient } from "./client";

export function generateMetadata(): Metadata {
  const canonical = `${siteConfig.siteUrl}/about`;
  return {
    title: "关于",
    description:
      "基于博客内容、X 动态与 GitHub 履历的 AI 第三方视角作者画像，支持多 AI 模型视角切换。",
    alternates: {
      canonical,
    },
    openGraph: {
      title: `关于 | ${siteConfig.title}`,
      description:
        "基于博客内容、X 动态与 GitHub 履历的 AI 第三方视角作者画像。",
      type: "profile",
      url: canonical,
      siteName: siteConfig.title,
      locale: "zh_CN",
    },
  };
}

export default function AboutPage() {
  const { manifest, reports } = getMultiModelProfileData();

  // Build slug → cover image map from all posts
  const postCovers: Record<string, string> = {};
  for (const post of getAllPosts()) {
    if (post.cover) {
      postCovers[post.slug] = getPreviewImage(post.cover);
    }
  }

  // Serialize for client component
  const serializedReports = reports.map((r) => ({
    modelId: r.model.id,
    meta: r.meta,
    report: r.report,
  }));

  return (
    <main className="mx-auto w-full max-w-[980px] px-4 pb-14 pt-8 md:px-8 md:pt-10">
      <RouteTransitionComplete />
      <AboutPageClient
        manifest={manifest}
        reports={serializedReports}
        postCovers={postCovers}
      />
    </main>
  );
}
