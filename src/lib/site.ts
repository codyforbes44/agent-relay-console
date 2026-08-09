/** Canonical public identity of the product. Used for SEO tags and docs samples. */
export const SITE_URL = "https://3bi.ai";
export const SITE_NAME = "Agent Relay Console";
export const SITE_PRODUCT_NAME = "RELAY";
export const SITE_TAGLINE = "Metered HTTP and MCP tool API for autonomous agents";

/** Site-wide default title and meta description. */
export const SITE_TITLE = "RELAY — Pay-Per-Call Tool API for AI Agents";
export const SITE_DESCRIPTION =
  "Metered HTTP and MCP tool API for AI agents. Bearer-key auth, OpenAPI discovery, per-call credit billing, and explicit confirmation before side effects.";

export const SITE_KEYWORDS = [
  "AI agent tools",
  "API for AI agents",
  "MCP server",
  "pay-per-call API",
  "tool API",
  "autonomous agents",
  "Model Context Protocol",
  "OpenAPI tools",
  "agent marketplace",
  "credit billing",
];

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
      { name: "keywords", content: SITE_KEYWORDS.join(", ") },
      { property: "og:title", content: opts.title },
      { property: "og:description", content: opts.description },
      { property: "og:url", content: url },
      { property: "og:type", content: opts.ogType ?? "website" },
      { property: "og:site_name", content: SITE_PRODUCT_NAME },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "twitter:title", content: opts.title },
      { name: "twitter:description", content: opts.description },
      { property: "og:image", content: SITE_OG_IMAGE },
      { name: "twitter:image", content: SITE_OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
