import { useEffect } from "react";

/**
 * Sets the document <title> and meta description for a page.
 * Use this at the top of every page component so each route
 * has its own unique, SEO-friendly title + description.
 */
export function useDocumentMeta(title: string, description: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    let metaTag = document.querySelector('meta[name="description"]');
    const previousDescription = metaTag?.getAttribute("content") ?? "";

    if (!metaTag) {
      metaTag = document.createElement("meta");
      metaTag.setAttribute("name", "description");
      document.head.appendChild(metaTag);
    }
    metaTag.setAttribute("content", description);

    return () => {
      document.title = previousTitle;
      metaTag?.setAttribute("content", previousDescription);
    };
  }, [title, description]);
}
