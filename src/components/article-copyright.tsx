import { IconCopyright, IconMarkdown } from "@/components/icons";
import { siteConfig } from "@/lib/site-config";

interface ArticleCopyrightProps {
  title: string;
  date: string;
  slug: string;
}

export function ArticleCopyright({ title, date, slug }: ArticleCopyrightProps) {
  const articleLink = `${siteConfig.siteUrl}/${slug}`;
  const markdownLink = `https://github.com/${siteConfig.contentRepo.owner}/${siteConfig.contentRepo.repo}/blob/${siteConfig.contentRepo.branch}/${siteConfig.contentRepo.contentPath}/${slug}.md`;

  return (
    <aside className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-5 py-4 text-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          {/* 作者 */}
          <div className="flex flex-wrap items-baseline gap-x-1">
            <span className="font-medium text-gray-700 dark:text-gray-300">作者:</span>
            <a
              href={siteConfig.siteUrl}
              target="_blank"
              rel="noreferrer"
              className="text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
            >
              {siteConfig.author.name}
            </a>
          </div>

          {/* 文章标题 */}
          <div className="flex flex-wrap items-baseline gap-x-1">
            <span className="font-medium text-gray-700 dark:text-gray-300">文章标题:</span>
            <a
              href={markdownLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
            >
              <span>{title}</span>
              <IconMarkdown className="h-4 w-4 flex-shrink-0 " />
            </a>
          </div>

          {/* 发表时间 */}
          <div className="flex flex-wrap items-baseline gap-x-1">
            <span className="font-medium text-gray-700 dark:text-gray-300">发表时间:</span>
            <span className="text-gray-600 dark:text-gray-400">{date}</span>
          </div>

          {/* 文章链接 */}
          <div className="flex flex-wrap items-baseline gap-x-1">
            <span className="font-medium text-gray-700 dark:text-gray-300">文章链接:</span>
            <a
              href={articleLink}
              target="_blank"
              rel="noreferrer"
              className="text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors truncate"
            >
              {articleLink}
            </a>
          </div>

          {/* 版权说明 */}
          <div className="flex flex-wrap items-center gap-x-1">
            <span className="font-medium text-gray-700 dark:text-gray-300">版权说明:</span>
            <a
              href="https://creativecommons.org/licenses/by-nc-nd/4.0/deed.zh-hans"
              target="_blank"
              rel="noreferrer"
              className="text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
            >
              CC BY-NC-ND 4.0 DEED
            </a>
            <IconCopyright className="ml-2 h-4 w-4 text-gray-500 dark:text-gray-400" />
          </div>
        </div>

        <IconCopyright className="h-5 w-5 text-gray-900 dark:text-gray-400 flex-shrink-0 mt-0.5" />
      </div>
    </aside>
  );
}
