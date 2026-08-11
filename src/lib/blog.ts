/**
 * Loads all markdown files from /content at build time using Vite's
 * import.meta.glob, parses their frontmatter, and exposes helpers to
 * list posts or get a single post by slug.
 *
 * No node dependencies (like gray-matter) needed — this is a tiny
 * frontmatter parser that works fine in the browser bundle.
 */

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO string, e.g. "2026-08-01"
  author: string;
  content: string; // raw markdown body (without frontmatter)
}

// Eagerly import all .md files in /content as raw strings.
// Adjust the glob path if your content folder lives elsewhere relative to this file.
const rawModules = import.meta.glob("/content/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } {
  // Strip a leading BOM (common when .md files are saved as "UTF-8 with BOM"
  // on Windows) and any leading blank lines, both of which would otherwise
  // break the strict "starts with ---" match below.
  const cleaned = raw.replace(/^\uFEFF/, "").replace(/^\s+/, "");
  const match = cleaned.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, content: raw };
  }
  const [, frontmatterBlock, content] = match;
  const data: Record<string, string> = {};
  frontmatterBlock.split("\n").forEach((line) => {
    const lineMatch = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (lineMatch) {
      const [, key, rawValue] = lineMatch;
      // strip surrounding quotes if present
      data[key.trim()] = rawValue.trim().replace(/^["']|["']$/g, "");
    }
  });
  return { data, content: content.trim() };
}

function slugFromPath(path: string): string {
  const fileName = path.split("/").pop() ?? "";
  return fileName.replace(/\.md$/, "");
}

const allPosts: BlogPost[] = Object.entries(rawModules).map(([path, raw]) => {
  const { data, content } = parseFrontmatter(raw);
  return {
    slug: slugFromPath(path),
    title: data.title ?? slugFromPath(path),
    description: data.description ?? "",
    date: data.date ?? "",
    author: data.author ?? "APAS Team",
    content,
  };
});

// Newest first
allPosts.sort((a, b) => (a.date < b.date ? 1 : -1));

export function getAllPosts(): BlogPost[] {
  return allPosts;
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return allPosts.find((post) => post.slug === slug);
}
