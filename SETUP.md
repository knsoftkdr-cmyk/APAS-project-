# Markdown-based Blog Setup for APAS

## 1. Install dependencies

```bash
npm install react-router-dom react-markdown remark-gfm
```

(Skip `react-router-dom` if you already have it installed.)

## 2. Copy files into your project

```
your-project/
├── content/
│   ├── what-is-adaptive-learning.md
│   ├── ai-in-education-overview.md
│   ├── how-apas-predicts-student-performance.md
│   ├── personalized-learning-in-schools.md
│   └── adaptive-assessment-vs-traditional-exams.md
├── src/
│   ├── lib/
│   │   ├── blog.ts
│   │   └── useDocumentMeta.ts
│   └── pages/
│       ├── Blog.tsx
│       └── BlogPost.tsx
```

The `content/` folder sits at your project root (same level as `src/`).
If you'd rather keep it inside `src/content/`, just update the glob path
in `blog.ts` from `/content/*.md` to `/src/content/*.md`.

## 3. Add routes

In your `App.tsx`:

```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Blog from "./pages/Blog";
import BlogPost from "./pages/BlogPost";
// ...your other page imports

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        {/* your other routes */}
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/:slug" element={<BlogPost />} />
      </Routes>
    </BrowserRouter>
  );
}
```

## 4. Add a "Latest Articles" section to your homepage (optional but recommended)

```tsx
import { getAllPosts } from "./lib/blog";
import { Link } from "react-router-dom";

function LatestArticles() {
  const posts = getAllPosts().slice(0, 3);
  return (
    <section>
      <h2>Latest Articles</h2>
      {posts.map((post) => (
        <Link key={post.slug} to={`/blog/${post.slug}`}>
          {post.title}
        </Link>
      ))}
    </section>
  );
}
```

## 5. Publishing a new article going forward

Just add one new `.md` file to `content/`, following this format:

```md
---
title: Your Article Title
description: A one-sentence SEO meta description.
date: 2026-08-20
author: APAS Team
---

## Your content in Markdown here
```

No code changes needed — `Blog.tsx` and `BlogPost.tsx` will pick it up
automatically.

## 6. Update your sitemap.xml

Add each article URL:

```xml
<url><loc>https://apaslearning.com/blog</loc></url>
<url><loc>https://apaslearning.com/blog/what-is-adaptive-learning</loc></url>
<url><loc>https://apaslearning.com/blog/ai-in-education-overview</loc></url>
<url><loc>https://apaslearning.com/blog/how-apas-predicts-student-performance</loc></url>
<url><loc>https://apaslearning.com/blog/personalized-learning-in-schools</loc></url>
<url><loc>https://apaslearning.com/blog/adaptive-assessment-vs-traditional-exams</loc></url>
```

If your sitemap is generated at build time rather than hand-maintained,
you can generate this list programmatically from `getAllPosts()` in a
small Node script that runs during your build — let me know if you want
that script and I'll write it.

## 7. Important: crawling a client-rendered SPA

Since these pages are rendered client-side by React, Google needs to
execute JavaScript to see the content. Two things matter here:

- Your host must serve `index.html` for any path (Vercel/Netlify do this
  automatically; if self-hosting, you need a rewrite rule).
- For best/fastest indexing, consider prerendering (e.g. via `vite-plugin-ssg`,
  or a prerender service) so Google gets fully-rendered HTML directly
  instead of relying on its JS renderer. This matters more as your blog
  grows — happy to set this up if you tell me your hosting provider.

## 8. After deploying each article

Search Console → URL Inspection → paste the article URL → Request
Indexing. Do this for the first handful of posts; after that, Google
tends to pick up new posts from the sitemap and internal links on its own.
