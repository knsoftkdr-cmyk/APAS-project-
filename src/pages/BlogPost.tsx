import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getPostBySlug, getAllPosts } from "../lib/blog";
import { useDocumentMeta } from "../lib/useDocumentMeta";

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const post = slug ? getPostBySlug(slug) : undefined;

  // Always call the hook (rules of hooks), fall back to generic values if not found
  useDocumentMeta(
    post ? `${post.title} | APAS` : "Article Not Found | APAS",
    post ? post.description : "This article could not be found."
  );

  if (!post) {
    return (
      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-4">Article not found</h1>
        <Link to="/blog" className="text-blue-600 underline">
          Back to Blog
        </Link>
      </main>
    );
  }

  const otherPosts = getAllPosts()
    .filter((p) => p.slug !== post.slug)
    .slice(0, 3);

  return (
    <main className="max-w-3xl mx-auto px-6 py-16">
      <Link to="/blog" className="text-blue-600 underline text-sm">
        ← Back to Blog
      </Link>

      <h1 className="text-4xl font-bold mt-4 mb-2">{post.title}</h1>

      <div className="text-sm text-gray-500 mb-8">
        {post.author}
        {post.date && (
          <>
            {" · "}
            {new Date(post.date).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </>
        )}
      </div>

      <article className="prose prose-lg max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {post.content}
        </ReactMarkdown>
      </article>

      {otherPosts.length > 0 && (
        <section className="mt-16 border-t border-gray-200 pt-8">
          <h2 className="text-2xl font-semibold mb-4">Related Articles</h2>
          <ul className="space-y-2">
            {otherPosts.map((p) => (
              <li key={p.slug}>
                <Link to={`/blog/${p.slug}`} className="text-blue-600 underline">
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
