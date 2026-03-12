import type { Metadata, Viewport } from "next";
import "./globals.css";
import { siteConfig } from "@/lib/site-config";
import { AIChatBox } from "@/components/ai-chat-box";
import { AIChatProvider } from "@/components/ai-chat-provider";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ThemeColorMeta } from "@/components/theme-color-meta";
import { UmamiScript } from "@/components/umami-script";
import { GoogleAnalyticsScript } from "@/components/google-analytics-script";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),
  title: {
    default: siteConfig.title,
    template: `%s | ${siteConfig.title}`,
  },
  description: siteConfig.description,
  keywords: [...siteConfig.keywords],
  alternates: {
    canonical: siteConfig.siteUrl,
    types: {
      "application/rss+xml": `${siteConfig.siteUrl}/rss.xml`,
    },
  },
  openGraph: {
    title: siteConfig.title,
    description: siteConfig.description,
    type: "website",
    url: siteConfig.siteUrl,
    siteName: siteConfig.title,
    locale: "zh_CN",
  },
  twitter: {
    card: "summary_large_image",
    site: `@${siteConfig.author.twitterUsername}`,
    creator: `@${siteConfig.author.twitterUsername}`,
  },
  icons: {
    icon: [
      { url: "/legacy/favicon.ico", sizes: "32x32" },
      { url: "/legacy/favicon.png", type: "image/png", sizes: "256x256" },
    ],
    apple: [
      { url: "/legacy/favicon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: siteConfig.title,
  },
  applicationName: siteConfig.title,
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

const themeScript = `(function(){try{var t=localStorage.getItem('theme');var m=localStorage.getItem('theme_manual_override')==='1';var p=window.matchMedia('(prefers-color-scheme:dark)').matches;var d=(m&&(t==='dark'||t==='light'))?t==='dark':p;document.documentElement.classList.toggle('dark',d)}catch(e){}})()`;

const structuredData = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: siteConfig.title,
  url: siteConfig.siteUrl,
  description: siteConfig.description,
  inLanguage: "zh-CN",
  author: {
    "@type": "Person",
    name: siteConfig.author.name,
    url: siteConfig.siteUrl,
    sameAs: [
      siteConfig.social.github,
      `https://x.com/${siteConfig.author.twitterUsername}`,
      siteConfig.social.youtube,
      siteConfig.social.bilibili,
      `https://unsplash.com/@${siteConfig.author.unsplash}`,
    ],
  },
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="scroll-pt-[60px]">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="manifest" href="/manifest.json" />
        <ThemeColorMeta />
        <script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          async
          defer
        />
      </head>
      <body className="flex min-h-screen flex-col antialiased pt-[60px]">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: structuredData }}
        />
        <AIChatProvider>
          <SiteHeader />
          <div className="flex-1">{children}</div>
          <SiteFooter />
          <AIChatBox />
        </AIChatProvider>
        <GoogleAnalyticsScript />
        <UmamiScript />
      </body>
    </html>
  );
}
