export const siteConfig = {
  title: "罗磊的独立博客",
  description:
    "我是罗磊，来自中国深圳，程序员，前端工程师，视频节目 ZUOLUOTV 制作人，旅行摄影玩家和内容创作者。",
  siteUrl: "https://luolei.org",
  social: {
    github: "https://github.com/foru17",
    twitter: "https://zuoluo.tv/twitter",
    youtube: "https://zuoluo.tv/youtube",
    bilibili: "https://zuoluo.tv/bilibili",
  },
  analyticsId: "G-TG5VK8GPSG",
  beian: "粤ICP备14004235号",
} as const;

export const categoryMap = [
  { text: "hot", name: "热门", isHome: true },
  { text: "zuoluotv", name: "视频", isHome: true },
  { text: "code", name: "编程", isHome: true },
  { text: "tech", name: "数码", isHome: true },
  { text: "travel", name: "旅行", isHome: true },
  { text: "lifestyle", name: "生活", isHome: true },
  { text: "photography", name: "摄影", isHome: false },
  { text: "run", name: "跑步", isHome: false },
] as const;

export const articlePageSize = 12;
export const hotArticleViews = 5000;
