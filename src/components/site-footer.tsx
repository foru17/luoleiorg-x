import { siteConfig } from "@/lib/site-config";

export function SiteFooter() {
  return (
    <footer className="site-footer mt-12 border-t border-zinc-200 py-8 dark:border-zinc-800">
      <div className="mx-auto w-full max-w-[1280px] px-4 text-center md:px-8">
        <p>
          Powered By <a href="https://github.com/cloudflare/vinext" target="_blank" rel="noreferrer">vinext</a>
        </p>
        <p>
          Copyright {new Date().getFullYear()} | <a href={siteConfig.siteUrl}>LUOLEI.ORG</a>
        </p>
        <p>
          <a href="http://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
            {siteConfig.beian}
          </a>
        </p>
      </div>
    </footer>
  );
}
