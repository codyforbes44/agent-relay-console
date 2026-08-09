import { Link } from "@tanstack/react-router";

import { SITE_NAME } from "@/lib/site";

/** Public footer: product links plus the legal pages required for card payments. */
export function LegalFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid w-full max-w-5xl gap-8 px-6 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="font-mono text-xs font-semibold tracking-[0.3em] text-primary">RELAY</p>
          <p className="mt-2 max-w-xs text-xs leading-relaxed text-muted-foreground">
            A metered HTTP and MCP tool API built for autonomous agents. Pay per call, no
            subscription.
          </p>
        </div>

        <nav className="text-xs text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">Product</p>
          <ul className="space-y-1.5">
            <li>
              <Link to="/docs" className="hover:text-foreground">
                API docs
              </Link>
            </li>
            <li>
              <Link to="/pricing" className="hover:text-foreground">
                Pricing
              </Link>
            </li>
            <li>
              <Link to="/connect" className="hover:text-foreground">
                Connect an assistant
              </Link>
            </li>
            <li>
              <Link to="/auth" className="hover:text-foreground">
                Human console
              </Link>
            </li>
          </ul>
        </nav>

        <nav className="text-xs text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">For agents</p>
          <ul className="space-y-1.5">
            <li>
              <a href="/llms.txt" className="hover:text-foreground">
                llms.txt
              </a>
            </li>
            <li>
              <a href="/.well-known/agent-manifest.json" className="hover:text-foreground">
                Agent manifest
              </a>
            </li>
            <li>
              <a href="/api/public/v1/openapi.json" className="hover:text-foreground">
                OpenAPI 3.1 spec
              </a>
            </li>
            <li>
              <a href="/api/public/v1/tools" className="hover:text-foreground">
                Tool catalog
              </a>
            </li>
            <li>
              <a href="/mcp" className="hover:text-foreground">
                MCP endpoint
              </a>
            </li>
          </ul>
        </nav>

        <nav className="text-xs text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">Legal</p>
          <ul className="space-y-1.5">
            <li>
              <Link to="/terms" className="hover:text-foreground">
                Terms &amp; conditions
              </Link>
            </li>
            <li>
              <Link to="/refunds" className="hover:text-foreground">
                Refund policy
              </Link>
            </li>
            <li>
              <Link to="/privacy" className="hover:text-foreground">
                Privacy notice
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="mx-auto w-full max-w-5xl px-6 pb-8 text-xs text-muted-foreground">
        <p>
          © {new Date().getFullYear()} {SITE_NAME}. Orders are processed by Paddle.com, our
          Merchant of Record.
        </p>
      </div>
    </footer>
  );
}
