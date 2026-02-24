import { IconCopyright, IconMarkdown } from "@/components/icons";

interface ArticleCopyrightProps {
  title: string;
  date: string;
  slug: string;
}

export function ArticleCopyright({ title, date, slug }: ArticleCopyrightProps) {
  const articleLink = `https://luolei.org/${slug}`;
  const markdownLink = `https://github.com/foru17/luoleiorg/tree/main/docs/${slug}.md`;

  return (
    <section className="relative mt-8 rounded-md border border-zinc-300 px-5 py-5 text-sm dark:border-zinc-700">
      <IconCopyright className="absolute right-3 top-3 h-4 w-4 text-gray-900 dark:text-slate-200 md:right-5 md:h-6 md:w-6" />
      <p>
        <span className="font-medium">作者:</span> 罗磊
      </p>
      <p>
        <span className="font-medium">文章标题:</span>{" "}
        <a
          href={markdownLink}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--vp-c-brand)]"
        >
          <span className="inline-flex items-center">
            {title}
            <IconMarkdown className="ml-2 h-5 w-5" />
          </span>
        </a>
      </p>
      <p>
        <span className="font-medium">发表时间:</span> {date}
      </p>
      <p>
        <span className="font-medium">文章链接:</span>{" "}
        <a
          href={articleLink}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--vp-c-brand)]"
        >
          {articleLink}
        </a>
      </p>
      <p>
        <span className="font-medium">版权说明:</span>{" "}
        <a
          href="https://creativecommons.org/licenses/by-nc-nd/4.0/deed.zh-hans"
          target="_blank"
          rel="noreferrer"
          className="text-[var(--vp-c-brand)]"
        >
          CC BY-NC-ND 4.0 DEED
        </a>
        <IconCopyright className="ml-2 inline-block h-4 w-4 text-gray-900 dark:text-slate-400" />
      </p>
    </section>
  );
}
