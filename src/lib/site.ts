/** Canonical public identity of the product. Used for SEO tags and docs samples. */
export const SITE_URL = "https://3bi.ai";
export const SITE_NAME = "Agent Relay Console";
export const SITE_TAGLINE = "A metered tool API for autonomous agents";

/** Site-wide default title and meta description. */
export const SITE_TITLE = "RELAY — pay-per-call tool API for AI agents";
export const SITE_DESCRIPTION =
  "A metered HTTP and MCP tool API built for autonomous agents: bearer-key auth, OpenAPI discovery, credit billing per call, and explicit confirmation before side effects.";

export const SITE_OG_IMAGE = `${SITE_URL}/og-image.jpg`;

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
      { property: "og:image", content: SITE_OG_IMAGE },
      { name: "twitter:image", content: SITE_OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
