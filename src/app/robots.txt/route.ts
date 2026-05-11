import { siteConfig } from "@/lib/site-config";

// robots.txt 策略（详情见 docs/agent-readiness.md）：
//
// - 允许：搜索 / 检索类爬虫（OAI-SearchBot、Claude-SearchBot、PerplexityBot 等）
//         与用户即时触发的代理（ChatGPT-User、Claude-User 等）
//         —— 这些路径决定了 AI 回答里能否引用本站
// - 屏蔽：以训练数据为目的的爬虫（GPTBot、ClaudeBot、Google-Extended、Applebot-Extended）
//         以及未声明用途 / 违规抓取历史的爬虫（Bytespider、Grok 等）
// - Content-Signals（contentsignals.org / draft-romm-aipref-contentsignals）：
//         为通配 User-agent 声明机器可读的内容用途偏好：允许检索（search=yes），
//         但拒绝作为 AI 输入（ai-input=no）和训练数据（ai-train=no），与上面 bot
//         级别的精细规则保持一致。
const ALLOWED_AI_BOTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "DuckAssistBot",
  "Bingbot",
  "Googlebot",
];

const BLOCKED_AI_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "ByteSpider",
  "Grok",
  "CCBot",
  "FacebookBot",
  "Meta-ExternalAgent",
  "Amazonbot",
  "Diffbot",
  "ImagesiftBot",
  "omgili",
  "YouBot",
  "Timpibot",
  "PetalBot",
];

const CONTENT_SIGNAL = "search=yes, ai-input=no, ai-train=no";

function buildRobotsTxt(): string {
  const lines: string[] = [];

  for (const bot of ALLOWED_AI_BOTS) {
    lines.push(`User-Agent: ${bot}`);
    lines.push("Allow: /");
    lines.push("");
  }

  for (const bot of BLOCKED_AI_BOTS) {
    lines.push(`User-Agent: ${bot}`);
    lines.push("Disallow: /");
    lines.push("");
  }

  // 通配规则 + Content-Signal（contentsignals.org 提案要求 Content-Signal
  // 出现在对应 User-agent 段内，否则部分解析器会忽略）
  lines.push("User-Agent: *");
  lines.push(`Content-Signal: ${CONTENT_SIGNAL}`);
  lines.push("Allow: /");
  lines.push("");

  lines.push(`Sitemap: ${siteConfig.siteUrl}/sitemap.xml`);
  lines.push(`Host: ${siteConfig.siteUrl}`);
  lines.push("");

  return lines.join("\n");
}

export function GET() {
  return new Response(buildRobotsTxt(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
