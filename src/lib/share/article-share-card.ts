import { siteConfig } from "@/lib/site-config";

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;

export type ArticleShareCardTheme = "dark" | "light";

export interface ArticleShareCardData {
  title: string;
  summary: string;
  articleUrl: string;
  publishedAt: string;
}

export interface PreparedArticleShareCardData {
  titleLines: string[];
  summaryLines: string[];
  urlLines: string[];
  publishedAt: string;
}

export interface ArticleShareCardAssets {
  logoSrc?: string;
  avatarSrc?: string;
  coverSrc?: string;
  qrSrc?: string;
}

interface ShareCardPalette {
  cardFill: string;
  cardStroke: string;
  headerBand: string;
  divider: string;
  title: string;
  meta: string;
  summaryFill: string;
  summaryStroke: string;
  summaryLabel: string;
  summaryAccent: string;
  summaryText: string;
  footerFill: string;
  footerStroke: string;
  footerLabel: string;
  footerText: string;
  footerMuted: string;
  fallbackCoverFill: string;
  fallbackCoverText: string;
  fallbackCoverMuted: string;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getCharWidth(char: string): number {
  return /^[\u0000-\u00ff]$/.test(char) ? 0.58 : 1;
}

function truncateLine(value: string, maxUnits: number): string {
  const trimmed = normalizeText(value);
  if (!trimmed) return "";

  let current = "";
  let units = 0;

  for (const char of Array.from(trimmed)) {
    const charWidth = getCharWidth(char);
    if (current && units + charWidth > maxUnits - 1) {
      return `${current.trimEnd()}...`;
    }

    current += char;
    units += charWidth;
  }

  return current.trimEnd();
}

function wrapText(value: string, maxUnits: number, maxLines: number): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];

  const lines: string[] = [];
  let current = "";
  let units = 0;

  for (const char of Array.from(normalized)) {
    const charWidth = getCharWidth(char);

    if (current && units + charWidth > maxUnits) {
      lines.push(current.trim());
      current = char;
      units = charWidth;

      if (lines.length === maxLines) {
        lines[maxLines - 1] = truncateLine(lines[maxLines - 1], maxUnits);
        return lines;
      }

      continue;
    }

    current += char;
    units += charWidth;
  }

  if (current.trim() && lines.length < maxLines) {
    lines.push(current.trim());
  }

  if (
    lines.length === maxLines &&
    normalizeText(lines.join("")).length < normalized.length
  ) {
    lines[maxLines - 1] = truncateLine(lines[maxLines - 1], maxUnits);
  }

  return lines;
}

function stripProtocol(value: string): string {
  return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderTextLines(options: {
  lines: string[];
  x: number;
  y: number;
  lineHeight: number;
  fontSize: number;
  fill: string;
  fontWeight?: number;
  letterSpacing?: number;
  fontFamily?: string;
}) {
  const {
    lines,
    x,
    y,
    lineHeight,
    fontSize,
    fill,
    fontWeight = 400,
    letterSpacing,
    fontFamily = "SF Pro Display, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  } = options;

  return lines
    .map((line, index) => {
      const letterSpacingMarkup =
        typeof letterSpacing === "number"
          ? ` letter-spacing="${letterSpacing}"`
          : "";

      return `<text x="${x}" y="${y + index * lineHeight}" fill="${fill}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}"${letterSpacingMarkup}>${escapeXml(line)}</text>`;
    })
    .join("");
}

export function getArticleShareCardSize() {
  return {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  };
}

export function prepareArticleShareCardData({
  title,
  summary,
  articleUrl,
  publishedAt,
}: ArticleShareCardData): PreparedArticleShareCardData {
  return {
    titleLines: wrapText(title, 14.6, 3),
    summaryLines: wrapText(summary, 30.5, 4),
    urlLines: wrapText(stripProtocol(articleUrl), 24, 2),
    publishedAt,
  };
}

function getShareCardPalette(theme: ArticleShareCardTheme): ShareCardPalette {
  if (theme === "dark") {
    return {
      cardFill: "#0F1720",
      cardStroke: "rgba(255,255,255,0.10)",
      headerBand: "#2B3644",
      divider: "rgba(255,255,255,0.10)",
      title: "#F8FAFC",
      meta: "#94A3B8",
      summaryFill: "rgba(255,255,255,0.04)",
      summaryStroke: "rgba(255,255,255,0.08)",
      summaryLabel: "#A8B3C2",
      summaryAccent: "#64748B",
      summaryText: "#E5E7EB",
      footerFill: "#161E2A",
      footerStroke: "rgba(255,255,255,0.06)",
      footerLabel: "#B8C2D0",
      footerText: "#F8FAFC",
      footerMuted: "#8B98AA",
      fallbackCoverFill: "#17212C",
      fallbackCoverText: "#F8FAFC",
      fallbackCoverMuted: "#A8B3C2",
    };
  }

  return {
    cardFill: "#F6F1E7",
    cardStroke: "rgba(15,23,42,0.10)",
    headerBand: "#20242C",
    divider: "#DDD6C9",
    title: "#111827",
    meta: "#667085",
    summaryFill: "rgba(255,255,255,0.68)",
    summaryStroke: "rgba(15,23,42,0.08)",
    summaryLabel: "#6B7280",
    summaryAccent: "#A8A29E",
    summaryText: "#334155",
    footerFill: "#ECE5D8",
    footerStroke: "rgba(15,23,42,0.08)",
    footerLabel: "#6B7280",
    footerText: "#111827",
    footerMuted: "#667085",
    fallbackCoverFill: "#E7DFD2",
    fallbackCoverText: "#111827",
    fallbackCoverMuted: "#6B7280",
  };
}

function getTitleMetrics(lineCount: number) {
  if (lineCount >= 3) {
    return {
      fontSize: 48,
      lineHeight: 58,
      letterSpacing: -0.7,
    };
  }

  if (lineCount === 2) {
    return {
      fontSize: 54,
      lineHeight: 64,
      letterSpacing: -0.8,
    };
  }

  return {
    fontSize: 58,
    lineHeight: 68,
    letterSpacing: -1,
  };
}

export function buildArticleShareCardSvg(
  content: PreparedArticleShareCardData,
  assets: ArticleShareCardAssets,
  theme: ArticleShareCardTheme = "light",
): string {
  const palette = getShareCardPalette(theme);
  const titleMetrics = getTitleMetrics(content.titleLines.length);
  const titleStartY = 648;
  const titleBottomY =
    titleStartY + (content.titleLines.length - 1) * titleMetrics.lineHeight;
  const publishedAtY = titleBottomY + 54;
  const footerY = 1088;
  const footerHeight = 146;
  const qrFrameSize = 120;
  const qrImageSize = 108;
  const qrFrameX = 844;
  const qrFrameY = footerY + (footerHeight - qrFrameSize) / 2;
  const qrImageInset = (qrFrameSize - qrImageSize) / 2;
  const qrImageX = qrFrameX + qrImageInset;
  const qrImageY = qrFrameY + qrImageInset;
  const summaryLineHeight = 34;
  const summaryBoxHeight =
    94 + Math.max(content.summaryLines.length, 1) * summaryLineHeight;
  const summaryBoxY = footerY - summaryBoxHeight - 28;

  const coverMarkup = assets.coverSrc
    ? `
      <image
        href="${escapeXml(assets.coverSrc)}"
        x="88"
        y="198"
        width="904"
        height="360"
        preserveAspectRatio="xMidYMid slice"
        clip-path="url(#coverClip)"
      />
    `
    : `
      <rect x="88" y="198" width="904" height="360" rx="28" fill="${palette.fallbackCoverFill}" />
      <text x="136" y="392" fill="${palette.fallbackCoverText}" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif" font-size="34" font-weight="700">${escapeXml(siteConfig.title)}</text>
      <text x="136" y="438" fill="${palette.fallbackCoverMuted}" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif" font-size="24">文章分享图</text>
    `;

  const qrMarkup = assets.qrSrc
    ? `
      <rect x="${qrFrameX}" y="${qrFrameY}" width="${qrFrameSize}" height="${qrFrameSize}" rx="20" fill="white" />
      <image
        href="${escapeXml(assets.qrSrc)}"
        x="${qrImageX}"
        y="${qrImageY}"
        width="${qrImageSize}"
        height="${qrImageSize}"
        preserveAspectRatio="xMidYMid meet"
        clip-path="url(#qrClip)"
      />
    `
    : "";

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" fill="none">
      <defs>
        <clipPath id="avatarClip">
          <rect x="932" y="92" width="60" height="60" rx="30" />
        </clipPath>
        <clipPath id="coverClip">
          <rect x="88" y="198" width="904" height="360" rx="28" />
        </clipPath>
        <clipPath id="qrClip">
          <rect x="${qrImageX}" y="${qrImageY}" width="${qrImageSize}" height="${qrImageSize}" rx="16" />
        </clipPath>
      </defs>

      <rect x="48" y="48" width="984" height="1254" rx="38" fill="${palette.cardFill}" />
      <rect x="48" y="48" width="984" height="1254" rx="38" stroke="${palette.cardStroke}" stroke-width="2" />

      <rect x="88" y="96" width="44" height="44" rx="14" fill="#111827" />
      ${
        assets.logoSrc
          ? `<image href="${escapeXml(assets.logoSrc)}" x="96" y="104" width="28" height="28" preserveAspectRatio="xMidYMid meet" />`
          : ""
      }
      <text x="148" y="120" fill="${palette.title}" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif" font-size="24" font-weight="700">${escapeXml(siteConfig.title)}</text>
      <text x="148" y="146" fill="${palette.meta}" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif" font-size="18">luolei.org</text>

      <line x1="88" y1="170" x2="992" y2="170" stroke="${palette.divider}" />

      ${
        assets.avatarSrc
          ? `
            <image
              href="${escapeXml(assets.avatarSrc)}"
              x="932"
              y="92"
              width="60"
              height="60"
              preserveAspectRatio="xMidYMid slice"
              clip-path="url(#avatarClip)"
            />
          `
          : ""
      }
      <text x="910" y="118" fill="${palette.title}" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif" font-size="16" font-weight="700" text-anchor="end">罗磊</text>
      <text x="910" y="142" fill="${palette.meta}" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif" font-size="14" text-anchor="end">文章分享</text>

      ${coverMarkup}

      ${renderTextLines({
        lines: content.titleLines,
        x: 88,
        y: titleStartY,
        lineHeight: titleMetrics.lineHeight,
        fontSize: titleMetrics.fontSize,
        fontWeight: 800,
        fill: palette.title,
        letterSpacing: titleMetrics.letterSpacing,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
      })}
      <text x="88" y="${publishedAtY}" fill="${palette.meta}" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif" font-size="20" font-weight="500">发布于 ${escapeXml(content.publishedAt)}</text>

      <rect x="88" y="${summaryBoxY}" width="904" height="${summaryBoxHeight}" rx="26" fill="${palette.summaryFill}" stroke="${palette.summaryStroke}" />
      <rect x="124" y="${summaryBoxY + 24}" width="4" height="20" rx="2" fill="${palette.summaryAccent}" />
      <text x="140" y="${summaryBoxY + 40}" fill="${palette.summaryLabel}" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif" font-size="16" font-weight="700">一句话摘要</text>
      ${renderTextLines({
        lines: content.summaryLines,
        x: 124,
        y: summaryBoxY + 78,
        lineHeight: summaryLineHeight,
        fontSize: 22,
        fontWeight: 400,
        fill: palette.summaryText,
      })}

      <rect x="88" y="${footerY}" width="904" height="${footerHeight}" rx="28" fill="${palette.footerFill}" stroke="${palette.footerStroke}" />
      <text x="126" y="1132" fill="${palette.footerLabel}" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif" font-size="15" font-weight="700" letter-spacing="1.2">阅读全文</text>
      ${renderTextLines({
        lines: content.urlLines,
        x: 126,
        y: 1170,
        lineHeight: 30,
        fontSize: 22,
        fontWeight: 500,
        fill: palette.footerText,
      })}
      ${qrMarkup}
      <text x="676" y="1148" fill="${palette.footerText}" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif" font-size="18" font-weight="700">${escapeXml(siteConfig.brand)}</text>
      <text x="676" y="1178" fill="${palette.footerMuted}" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif" font-size="16">扫码阅读全文</text>
    </svg>
  `.trim();
}
