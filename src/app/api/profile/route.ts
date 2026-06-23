import { getAllPosts } from "@/lib/content/posts";
import { categoryMap, siteConfig } from "@/lib/site-config";

// 通过 Vite 的 import.meta.glob 在构建期把 JSON 打进 bundle，避免运行时 fs 调用
// (Cloudflare Worker 没有文件系统，必须 build-time inline)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Vite-specific API
const dataModules = import.meta.glob(
  [
    "/data/github-resume.json",
    "/data/author-profile-report.json",
  ],
  { eager: true, import: "default" },
) as Record<string, unknown>;

interface SocialMap {
  github?: string;
  x?: string;
  twitter?: string;
  youtube?: string;
  bilibili?: string;
  blog?: string;
  instagram?: string;
  unsplash?: string;
  telegram?: string;
  linkedin?: string;
  email?: string;
}

interface GithubResume {
  meta?: { lastUpdated?: string };
  profile?: {
    name?: string;
    nameEn?: string;
    headline?: string;
    location?: string;
    bio?: string;
    social?: SocialMap;
  };
  highlights?: string[];
  topProjects?: unknown[];
  contact?: Record<string, string>;
}

interface AuthorProfileReport {
  meta?: { lastUpdated?: string };
  report?: {
    hero?: { title?: string; summary?: string; intro?: string };
    tags?: string[];
    identities?: Array<{
      name: string;
      description: string;
      evidence?: string;
      link?: string;
    }>;
    strengths?: Array<{ title: string; points: string[] }>;
    styles?: Array<{ trait: string; description: string }>;
  };
}

const githubResume = (dataModules["/data/github-resume.json"] ??
  {}) as GithubResume;
const authorProfileReport = (dataModules["/data/author-profile-report.json"] ??
  {}) as AuthorProfileReport;

const PROFILE_PAYLOAD = (() => {
  const posts = getAllPosts();
  const latestPost = posts[0];
  const totalPosts = posts.length;

  const categoryCounts = categoryMap
    .filter((c) => c.text !== "hot")
    .map((c) => ({
      slug: c.text,
      name: c.name,
      count: posts.filter((p) => p.categories.includes(c.text)).length,
    }))
    .filter((c) => c.count > 0);

  return {
    site: {
      title: siteConfig.title,
      description: siteConfig.description,
      url: siteConfig.siteUrl,
      language: "zh-CN",
      brand: siteConfig.brand,
      keywords: [...siteConfig.keywords],
      license: "CC BY-NC-ND 4.0",
      feeds: {
        rss: `${siteConfig.siteUrl}/rss.xml`,
        sitemap: `${siteConfig.siteUrl}/sitemap.xml`,
        llms: `${siteConfig.siteUrl}/llms.txt`,
        llmsFull: `${siteConfig.siteUrl}/llms-full.txt`,
      },
    },
    author: {
      name: siteConfig.author.name,
      nameEn: githubResume.profile?.nameEn ?? siteConfig.author.name,
      headline: githubResume.profile?.headline,
      bio: githubResume.profile?.bio,
      location: githubResume.profile?.location,
      email: siteConfig.author.email,
      url: siteConfig.siteUrl,
      sameAs: [
        siteConfig.social.github,
        `https://x.com/${siteConfig.author.twitterUsername}`,
        siteConfig.social.youtube,
        siteConfig.social.bilibili,
        `https://unsplash.com/@${siteConfig.author.unsplash}`,
        githubResume.profile?.social?.instagram,
        githubResume.profile?.social?.telegram,
        githubResume.profile?.social?.linkedin,
      ].filter((v): v is string => Boolean(v)),
    },
    summary: {
      hero: authorProfileReport.report?.hero,
      tags: authorProfileReport.report?.tags,
      identities: authorProfileReport.report?.identities,
      strengths: authorProfileReport.report?.strengths,
      styles: authorProfileReport.report?.styles,
      highlights: githubResume.highlights,
    },
    stats: {
      totalPosts,
      latestPost: latestPost
        ? {
            slug: latestPost.slug,
            title: latestPost.title,
            url: `${siteConfig.siteUrl}/${latestPost.slug}`,
            publishedAt: new Date(latestPost.dateTime)
              .toISOString()
              .slice(0, 10),
          }
        : null,
      categories: categoryCounts,
      lastUpdated:
        authorProfileReport.meta?.lastUpdated ??
        githubResume.meta?.lastUpdated ??
        new Date().toISOString(),
    },
    disclaimer:
      "本文件汇总站点公开信息与 AI 生成的作者画像，按 CC BY-NC-ND 4.0 共享。引用请注明来源。",
  };
})();

export async function GET() {
  return new Response(JSON.stringify(PROFILE_PAYLOAD, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
      "X-Robots-Tag": "all",
    },
  });
}
