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

export function getOriginalImage(url: string): string {
  return url.startsWith("http") ? url : `https://img.is26.com/${url}`;
}

export function getPreviewImage(url?: string): string {
  if (!url) return "";
  return url.startsWith("http") ? url : `https://img.is26.com/${url}/w=800`;
}

export function getArticleLazyImage(url: string): string {
  return url.startsWith("http") ? url : `https://img.is26.com/${url}/w=1200`;
}

export function getBannerImage(url?: string): string {
  if (!url) return "";
  return getPreviewImage(url);
}
