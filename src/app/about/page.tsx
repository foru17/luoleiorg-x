import type { Metadata } from "next";
import { RouteTransitionComplete } from "@/components/route-transition-complete";
import { getMultiModelProfileData } from "@/lib/content/author-profile";
import { getAllPosts } from "@/lib/content/posts";
import { getPreviewImage } from "@/lib/content/utils";
import { siteConfig } from "@/lib/site-config";
import { AboutPageClient } from "./client";

// 同 /api/profile：从 GitHub resume JSON 取一些事实型字段填进 Person JSON-LD
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Vite-specific API
const aboutDataModules = import.meta.glob("/data/github-resume.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

const githubResume =
  (aboutDataModules["/data/github-resume.json"] as
    | {
        profile?: {
          headline?: string;
          location?: string;
          bio?: string;
          social?: Record<string, string>;
        };
      }
    | undefined) ?? {};

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

  const aboutUrl = `${siteConfig.siteUrl}/about`;
  const sameAs = [
    siteConfig.social.github,
    `https://x.com/${siteConfig.author.twitterUsername}`,
    siteConfig.social.youtube,
    siteConfig.social.bilibili,
    `https://unsplash.com/@${siteConfig.author.unsplash}`,
    githubResume.profile?.social?.instagram,
    githubResume.profile?.social?.telegram,
    githubResume.profile?.social?.linkedin,
  ].filter((v): v is string => Boolean(v));

  const personId = `${siteConfig.siteUrl}/#person`;
  const personJsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": personId,
    name: siteConfig.author.name,
    url: siteConfig.siteUrl,
    mainEntityOfPage: aboutUrl,
    jobTitle: githubResume.profile?.headline,
    description: githubResume.profile?.bio,
    homeLocation: githubResume.profile?.location
      ? { "@type": "Place", name: githubResume.profile.location }
      : undefined,
    email: `mailto:${siteConfig.author.email}`,
    image: `${siteConfig.siteUrl}/legacy/favicon.png`,
    sameAs,
    knowsAbout: [...siteConfig.keywords],
  };

  const profilePageJsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: aboutUrl,
    name: `关于 | ${siteConfig.title}`,
    inLanguage: "zh-CN",
    mainEntity: { "@id": personId },
    isPartOf: {
      "@type": "WebSite",
      name: siteConfig.title,
      url: siteConfig.siteUrl,
    },
  };

  return (
    <main className="mx-auto w-full max-w-[980px] px-4 pb-14 pt-8 md:px-8 md:pt-10">
      <RouteTransitionComplete />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(profilePageJsonLd) }}
      />
      <AboutPageClient
        manifest={manifest}
        reports={serializedReports}
        postCovers={postCovers}
      />
    </main>
  );
}
