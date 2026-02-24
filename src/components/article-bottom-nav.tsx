import Link from "next/link";
import type { PostItem } from "@/lib/content/types";
import { getPreviewImage } from "@/lib/content/utils";

interface ArticleBottomNavProps {
  prev: PostItem | null;
  next: PostItem | null;
}

function NavCard({ post }: { post: PostItem }) {
  const bg = getPreviewImage(post.cover);

  return (
    <Link
      href={post.url}
      className="flex h-40 w-full items-center rounded-md bg-zinc-100 bg-cover bg-center hover:text-blue-600"
      style={
        bg
          ? {
              backgroundImage: `url(${bg})`,
            }
          : undefined
      }
    >
      <div className="flex h-40 w-full items-center rounded-md bg-black/30 px-2 duration-300 ease-in hover:bg-black/10 md:px-10">
        <p className="line-clamp-3 break-normal text-sm text-neutral-100 md:line-clamp-2 md:text-lg">
          {post.title}
        </p>
      </div>
    </Link>
  );
}

export function ArticleBottomNav({ prev, next }: ArticleBottomNavProps) {
  if (!prev && !next) return null;

  return (
    <section className="mt-6 flex flex-col justify-center space-y-4 dark:text-slate-200 md:flex-row md:space-x-6 md:space-y-0">
      {prev ? <NavCard post={prev} /> : null}
      {next ? <NavCard post={next} /> : null}
    </section>
  );
}
