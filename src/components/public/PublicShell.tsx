import { Link, useNavigate } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useEffect, useState } from "react";

import { LegalFooter } from "@/components/LegalFooter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { SITE_NAME } from "@/lib/site";

const NAV = [
  { to: "/docs", label: "Docs" },
  { to: "/pricing", label: "Pricing" },
  { to: "/connect", label: "Connect" },
] as const;

/** Shared chrome for every public (unauthenticated) page. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [signedIn, setSignedIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <Link to="/" className="flex items-center gap-2" aria-label={SITE_NAME}>
            <span className="font-mono text-sm font-semibold tracking-[0.3em] text-primary">
              RELAY
            </span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="hover:text-foreground"
                activeProps={{ className: "text-foreground" }}
              >
                {item.label}
              </Link>
            ))}
            <a href="/api/public/v1/tools" className="hover:text-foreground">
              Tool catalog
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={signedIn ? "default" : "outline"}
              onClick={() => navigate({ to: signedIn ? "/chat" : "/auth" })}
            >
              {signedIn ? "Open console" : "Sign in"}
            </Button>

            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="min-h-11 min-w-11 sm:hidden"
                  aria-label="Open menu"
                >
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
                <SheetHeader>
                  <SheetTitle className="font-mono text-sm tracking-[0.3em] text-primary">
                    RELAY
                  </SheetTitle>
                </SheetHeader>
                <nav className="mt-6 flex flex-col gap-1 px-4 text-sm">
                  {NAV.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMenuOpen(false)}
                      className="rounded-md px-2 py-3 text-muted-foreground hover:bg-muted hover:text-foreground"
                      activeProps={{ className: "text-foreground" }}
                    >
                      {item.label}
                    </Link>
                  ))}
                  <a
                    href="/api/public/v1/tools"
                    className="rounded-md px-2 py-3 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Tool catalog
                  </a>
                  <a
                    href="/llms.txt"
                    className="rounded-md px-2 py-3 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    llms.txt
                  </a>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <div id="content" className="flex-1">
        {children}
      </div>

      <LegalFooter />
    </div>
  );
}
