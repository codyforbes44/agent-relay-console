/** Canonical public identity of the product. Used for SEO tags and docs samples. */
export const SITE_URL = "https://agent-relay-console.lovable.app";
export const SITE_NAME = "Agent Relay Console";
export const SITE_TAGLINE = "A metered tool API for autonomous agents";

export function canonical(path: string) {
  return `${SITE_URL}${path === "/" ? "" : path}`;
}

/** Head helper so every public route ships a consistent, self-referencing tag set. */
export function publicHead(opts: {
  path: string;
  title: string;
  description: string;
  ogType?: "website" | "article";
}) {
  const url = canonical(opts.path);
  return {
    meta: [
      { title: opts.title },
      { name: "description", content: opts.description },
      { property: "og:title", content: opts.title },
      { property: "og:description", content: opts.description },
      { property: "og:url", content: url },
      { property: "og:type", content: opts.ogType ?? "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
