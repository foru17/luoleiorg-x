const CF_IMAGE_PROXY_HOST = "https://img.is26.com";

export function formatDate(dateInput: string): string {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return dateInput;

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatShowDate(dateInput: string): string {
  const source = +new Date(dateInput);
  const now = Date.now();
  const diff = now - source > 0 ? now - source : 60 * 1000;
  const oneDay = 24 * 60 * 60 * 1000;
  const oneWeek = oneDay * 7;
  const oneMonth = oneDay * 30;
  const oneYear = oneDay * 365;

  if (diff < oneDay) return "今天";
  if (diff < oneWeek) return `${Math.floor(diff / oneDay)}天前`;
  if (diff < oneMonth) return `${Math.floor(diff / oneWeek)}周前`;
  if (diff < oneYear) return `${Math.floor(diff / oneMonth)}月前`;

  const years = Math.floor(diff / oneYear);
  if (years > 0 && years < 3) return `${years}年前`;

  return new Date(dateInput).toISOString().slice(0, 10);
}

function normalizeImageSource(url: string): string {
  const source = url.trim();
  if (!source) return "";
  if (source.startsWith("//")) {
    return `https:${source}`;
  }
  return source;
}

function stripCfTransform(url: string): string {
  return url.replace(/\/w=[^/?#]+(?:,[^/?#]+)*$/, "");
}

function toCfImage(url: string, transform?: string): string {
  const source = normalizeImageSource(url);
  if (!source) return "";

  if (source.startsWith("data:") || source.startsWith("blob:")) {
    return source;
  }

  if (source.startsWith("/") && !source.startsWith("//")) {
    return source;
  }

  if (source.startsWith(`${CF_IMAGE_PROXY_HOST}/`)) {
    const clean = stripCfTransform(source);
    return transform ? `${clean}/${transform}` : clean;
  }

  const raw = source.startsWith("http") ? source : source.replace(/^\/+/, "");
  const proxied = `${CF_IMAGE_PROXY_HOST}/${raw}`;
  return transform ? `${proxied}/${transform}` : proxied;
}

export function getOriginalImage(url: string): string {
  return toCfImage(url);
}

export function getPreviewImage(url?: string): string {
  if (!url) return "";
  return toCfImage(url, "w=800");
}

export function getArticleLazyImage(url: string): string {
  return toCfImage(url, "w=1200");
}

export function getBannerImage(url?: string): string {
  if (!url) return "";
  return toCfImage(url, "w=800");
}
