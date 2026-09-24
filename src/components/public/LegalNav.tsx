import { Link } from "@tanstack/react-router";

const PAGES = [
  { to: "/terms", label: "Terms & conditions" },
  { to: "/refunds", label: "Refund policy" },
  { to: "/privacy", label: "Privacy notice" },
] as const;

/** Cross-links between the three legal pages, shown under each page title. */
export function LegalNav({ current }: { current: "/terms" | "/refunds" | "/privacy" }) {
  return (
    <nav aria-label="Legal pages" className="mt-4 flex flex-wrap gap-2 text-xs">
      {PAGES.map((p) => {
        const active = p.to === current;
        return (
          <Link
            key={p.to}
            to={p.to}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "rounded-full border border-primary bg-primary/10 px-3 py-1 text-primary"
                : "rounded-full border border-border px-3 py-1 text-muted-foreground hover:text-foreground"
            }
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
