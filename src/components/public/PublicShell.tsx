import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { LegalFooter } from "@/components/LegalFooter";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { SITE_NAME } from "@/lib/site";

/** Shared chrome for every public (unauthenticated) page. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <Link to="/" className="flex items-center gap-2" aria-label={SITE_NAME}>
            <span className="font-mono text-sm font-semibold tracking-[0.3em] text-primary">
              RELAY
            </span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
            <Link to="/docs" className="hover:text-foreground" activeProps={{ className: "text-foreground" }}>
              Docs
            </Link>
            <Link to="/pricing" className="hover:text-foreground" activeProps={{ className: "text-foreground" }}>
              Pricing
            </Link>
            <Link to="/connect" className="hover:text-foreground" activeProps={{ className: "text-foreground" }}>
              Connect
            </Link>
            <a href="/api/public/v1/tools" className="hover:text-foreground">
              Tool catalog
            </a>
          </nav>
          <Button
            size="sm"
            variant={signedIn ? "default" : "outline"}
            onClick={() => navigate({ to: signedIn ? "/chat" : "/auth" })}
          >
            {signedIn ? "Open console" : "Sign in"}
          </Button>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <LegalFooter />
    </div>
  );
}
