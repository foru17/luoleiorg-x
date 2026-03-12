#!/usr/bin/env node
/**
 * 将所有博客 markdown 文章合并导出为单一 PDF
 * - 保留标题、日期、摘要（excerpt）等元数据
 * - 去除图片
 * - 去除自定义 JSX 组件标签
 * - 按日期降序排列
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import matter from 'gray-matter'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const POSTS_DIR = join(ROOT, 'content/posts')
const OUTPUT_HTML = join(ROOT, 'dist/blog-export.html')
const OUTPUT_PDF = join(ROOT, 'dist/blog-export.pdf')

// 确保 dist 目录存在
if (!existsSync(join(ROOT, 'dist'))) {
  import('fs').then(({ mkdirSync }) => mkdirSync(join(ROOT, 'dist'), { recursive: true }))
}

function cleanMarkdown(content) {
  return content
    // 去除图片 ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
    // 去除 HTML img 标签
    .replace(/<img[^>]*>/gi, '')
    // 去除自定义 JSX 组件（如 <TweetCard .../>、<VideoEmbed ...> 等）
    .replace(/<[A-Z][A-Za-z]*[^>]*\/?>/g, '')
    .replace(/<\/[A-Z][A-Za-z]*>/g, '')
    // 去除 HTML 视频/音频标签
    .replace(/<video[^>]*>[\s\S]*?<\/video>/gi, '')
    .replace(/<audio[^>]*>[\s\S]*?<\/audio>/gi, '')
    // 去除 iframe
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
    // 清理多余空行（超过2行的合并）
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function markdownToHtmlSnippet(md) {
  // 简单的 markdown 转 HTML（标题、粗体、斜体、链接、列表、代码块、引用）
  let html = md
    // 代码块
    .replace(/```[\s\S]*?```/g, (m) => {
      const code = m.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')
      return `<pre><code>${escapeHtml(code)}</code></pre>`
    })
    // 行内代码
    .replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`)
    // 标题
    .replace(/^#{6}\s+(.+)$/gm, '<h6>$1</h6>')
    .replace(/^#{5}\s+(.+)$/gm, '<h5>$1</h5>')
    .replace(/^#{4}\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h1>$1</h1>')
    // 引用块
    .replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')
    // 粗体
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    // 斜体
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    // 链接（只保留文字，去除 URL）
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 无序列表
    .replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>')
    // 有序列表
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    // 水平线
    .replace(/^---+$/gm, '<hr>')
    .replace(/^\*\*\*+$/gm, '<hr>')

  // 把连续的 <li> 包在 <ul> 里
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)

  // 段落：空行分隔
  html = html.split(/\n\n+/).map(block => {
    block = block.trim()
    if (!block) return ''
    if (/^<(h[1-6]|ul|ol|li|pre|blockquote|hr)/.test(block)) return block
    return `<p>${block.replace(/\n/g, ' ')}</p>`
  }).join('\n')

  return html
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return dateStr
  }
}

// 读取所有文章
const files = readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'))
console.log(`找到 ${files.length} 篇文章`)

const posts = []
let skipped = 0

for (const file of files) {
  try {
    const raw = readFileSync(join(POSTS_DIR, file), 'utf-8')
    const { data, content } = matter(raw)

    // 跳过没有标题或日期的文章
    if (!data.title) {
      skipped++
      continue
    }

    const cleanContent = cleanMarkdown(content)
    // 跳过内容太短的（可能是纯视频帖子）
    if (cleanContent.length < 50) {
      skipped++
      continue
    }

    posts.push({
      title: data.title,
      date: data.date || data.created || '',
      excerpt: data.excerpt || data.description || data.summary || '',
      categories: data.categories || [],
      tags: data.tags || [],
      content: cleanContent,
      file,
    })
  } catch (e) {
    console.warn(`跳过 ${file}: ${e.message}`)
    skipped++
  }
}

// 按日期降序排列
posts.sort((a, b) => {
  const da = new Date(a.date || '1970-01-01')
  const db = new Date(b.date || '1970-01-01')
  return db - da
})

console.log(`有效文章: ${posts.length}，跳过: ${skipped}`)

// 生成 HTML
const postHtml = posts.map((post, idx) => {
  const categories = [...(post.categories || []), ...(post.tags || [])]
    .flat()
    .filter(Boolean)
    .slice(0, 5)
  const tagsHtml = categories.length
    ? `<div class="tags">${categories.map(t => `<span class="tag">${t}</span>`).join('')}</div>`
    : ''

  const excerptHtml = post.excerpt
    ? `<div class="excerpt">${escapeHtml(post.excerpt)}</div>`
    : ''

  const bodyHtml = markdownToHtmlSnippet(post.content)

  return `
<article class="post" id="post-${idx + 1}">
  <header class="post-header">
    <div class="post-number">${idx + 1}</div>
    <h1 class="post-title">${escapeHtml(post.title)}</h1>
    <div class="post-meta">
      <span class="post-date">${formatDate(post.date)}</span>
      ${tagsHtml}
    </div>
    ${excerptHtml}
  </header>
  <div class="post-body">
    ${bodyHtml}
  </div>
</article>`
}).join('\n<div class="divider"></div>\n')

const tocHtml = posts.map((post, idx) =>
  `<li><a href="#post-${idx + 1}"><span class="toc-num">${idx + 1}.</span> <span class="toc-title">${escapeHtml(post.title)}</span> <span class="toc-date">${post.date ? post.date.toString().slice(0, 10) : ''}</span></a></li>`
).join('\n')

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>罗磊的博客文章合集</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
      font-size: 11pt;
      line-height: 1.8;
      color: #1a1a1a;
      background: #fff;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px 30px;
    }

    /* 封面 */
    .cover-page {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      page-break-after: always;
      text-align: center;
    }
    .cover-page h1 { font-size: 2.5em; margin-bottom: 0.5em; color: #111; }
    .cover-page p { font-size: 1.1em; color: #555; margin: 0.3em 0; }

    /* 目录 */
    .toc-page {
      page-break-after: always;
    }
    .toc-page h2 { font-size: 1.5em; margin-bottom: 1em; border-bottom: 2px solid #333; padding-bottom: 0.3em; }
    .toc-page ol { list-style: none; padding: 0; }
    .toc-page li { padding: 3px 0; font-size: 9.5pt; }
    .toc-page a { text-decoration: none; color: #222; display: flex; gap: 6px; align-items: baseline; }
    .toc-num { color: #888; min-width: 30px; font-size: 9pt; }
    .toc-title { flex: 1; }
    .toc-date { color: #aaa; font-size: 8.5pt; white-space: nowrap; }

    /* 文章 */
    .post {
      page-break-before: always;
      padding-top: 20px;
    }
    .post-header {
      margin-bottom: 1.5em;
      padding-bottom: 1em;
      border-bottom: 1px solid #e0e0e0;
    }
    .post-number {
      font-size: 9pt;
      color: #aaa;
      margin-bottom: 4px;
    }
    .post-title {
      font-size: 1.6em;
      line-height: 1.4;
      color: #111;
      margin-bottom: 0.4em;
    }
    .post-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 0.5em;
    }
    .post-date {
      font-size: 9.5pt;
      color: #666;
    }
    .tags { display: flex; gap: 5px; flex-wrap: wrap; }
    .tag {
      font-size: 8pt;
      background: #f0f0f0;
      color: #555;
      padding: 1px 6px;
      border-radius: 3px;
    }
    .excerpt {
      font-size: 10pt;
      color: #555;
      font-style: italic;
      padding: 8px 12px;
      border-left: 3px solid #ddd;
      background: #fafafa;
      margin-top: 0.5em;
    }

    /* 文章正文 */
    .post-body { font-size: 10.5pt; line-height: 1.85; }
    .post-body h1 { font-size: 1.3em; margin: 1.2em 0 0.5em; color: #222; }
    .post-body h2 { font-size: 1.2em; margin: 1.1em 0 0.4em; color: #222; border-bottom: 1px solid #eee; padding-bottom: 3px; }
    .post-body h3 { font-size: 1.1em; margin: 1em 0 0.4em; color: #333; }
    .post-body h4, .post-body h5, .post-body h6 { font-size: 1em; margin: 0.8em 0 0.3em; color: #444; }
    .post-body p { margin: 0.7em 0; }
    .post-body ul, .post-body ol { padding-left: 1.5em; margin: 0.5em 0; }
    .post-body li { margin: 0.2em 0; }
    .post-body blockquote {
      border-left: 3px solid #ccc;
      padding: 4px 12px;
      color: #555;
      font-style: italic;
      margin: 0.8em 0;
      background: #fafafa;
    }
    .post-body pre {
      background: #f5f5f5;
      padding: 10px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 9pt;
      margin: 0.8em 0;
    }
    .post-body code {
      font-family: "SF Mono", "Menlo", "Monaco", "Consolas", monospace;
      font-size: 9pt;
      background: #f0f0f0;
      padding: 0 3px;
      border-radius: 2px;
    }
    .post-body pre code { background: none; padding: 0; }
    .post-body hr { border: none; border-top: 1px solid #eee; margin: 1em 0; }
    .post-body strong { font-weight: 600; }

    .divider { display: none; }

    @media print {
      body { padding: 0; max-width: 100%; }
    }
  </style>
</head>
<body>

<div class="cover-page">
  <h1>罗磊博客文章合集</h1>
  <p>luolei.org</p>
  <p>共 ${posts.length} 篇文章</p>
  <p>导出日期：${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
  <p>时间范围：${posts[posts.length-1]?.date?.toString()?.slice(0,10) || ''} — ${posts[0]?.date?.toString()?.slice(0,10) || ''}</p>
</div>

<div class="toc-page">
  <h2>目录</h2>
  <ol>
    ${tocHtml}
  </ol>
</div>

${postHtml}

</body>
</html>`

// 确保 dist 目录存在
import { mkdirSync } from 'fs'
try { mkdirSync(join(ROOT, 'dist'), { recursive: true }) } catch {}

writeFileSync(OUTPUT_HTML, html, 'utf-8')
console.log(`HTML 已生成: ${OUTPUT_HTML}`)
console.log(`文件大小: ${(html.length / 1024 / 1024).toFixed(2)} MB`)

// 用 Chrome headless 生成 PDF
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
console.log('正在用 Chrome headless 生成 PDF...')
try {
  execSync(
    `"${chromePath}" \
      --headless=new \
      --disable-gpu \
      --no-sandbox \
      --print-to-pdf="${OUTPUT_PDF}" \
      --print-to-pdf-no-header \
      --no-pdf-header-footer \
      "file://${OUTPUT_HTML}"`,
    { stdio: 'inherit', timeout: 120000 }
  )
  console.log(`✓ PDF 已生成: ${OUTPUT_PDF}`)
} catch (e) {
  console.error('PDF 生成失败，请手动用浏览器打开 HTML 文件并打印为 PDF')
  console.error(e.message)
}
