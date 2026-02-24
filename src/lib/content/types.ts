export interface PostFrontmatter {
  title: string;
  date: string;
  cover?: string;
  categories?: string[];
  description?: string;
  hide?: boolean;
  layout?: string;
}

export interface PostItem {
  slug: string;
  url: string;
  title: string;
  date: string;
  dateTime: number;
  formatShowDate: string;
  cover?: string;
  categories: string[];
  excerpt: string;
  readingTime: string;
}

export interface PostDetail extends PostItem {
  html: string;
  headings: Array<{ id: string; text: string; level: number }>;
}
