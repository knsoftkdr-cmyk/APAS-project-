import { Link } from "react-router-dom";
import { getAllPosts } from "../lib/blog";
import { useDocumentMeta } from "../lib/useDocumentMeta";

export default function Blog() {
  useDocumentMeta(
    "Blog | APAS Adaptive Learning",
    "Articles on adaptive learning, AI in education, and student performance prediction from the APAS team."
  );

  const posts = getAllPosts();

  return (
    <main className="max-w-4xl mx-auto px-6 py-16">
      <h1 className="text-4xl font-bold mb-6">Blog</h1>
      <p className="text-lg leading-relaxed text-gray-700 mb-10">
        Articles on adaptive learning, AI in education, and how APAS works
        under the hood.
      </p>

      <div className="space-y-8">
        {posts.length === 0 && (
          <p className="text-gray-500">No articles published yet.</p>
        )}
        {posts.map((post) => (
          <Link
            key={post.slug}
            to={`/blog/${post.slug}`}
            className="block border-b border-gray-200 pb-8 hover:opacity-80 transition-opacity"
          >
            <h2 className="text-2xl font-semibold mb-1">{post.title}</h2>
            {post.date && (
              <p className="text-sm text-gray-500 mb-2">
                {new Date(post.date).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            )}
            <p className="text-lg text-gray-700">{post.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
