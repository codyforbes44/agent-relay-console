import { createFileRoute } from "@tanstack/react-router";

import { LegalNav } from "@/components/public/LegalNav";
import { PublicShell } from "@/components/public/PublicShell";
import { publicHead } from "@/lib/site";

export const Route = createFileRoute("/impressum")({
  head: () =>
    publicHead({
      path: "/impressum",
      title: "Impressum — RELAY",
      description:
        "Provider identification for the Agent Relay Console service pursuant to § 5 DDG.",
    }),
  component: ImpressumPage,
});

function ImpressumPage() {
  return (
    <PublicShell>
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Impressum</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Provider identification pursuant to § 5 DDG. Last updated: 24 September 2026
        </p>
        <LegalNav current="/impressum" />

        <div className="prose-sm mt-8 space-y-8 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="mb-2 text-base font-medium text-foreground">Service provider</h2>
            <p>
              Agent Relay Console
              <br />
              Berlin, Germany
              <br />
              <span className="text-foreground">[street address — to be provided]</span>
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-medium text-foreground">Contact</h2>
            <p>
              Email:{" "}
              <a className="underline" href="mailto:support@3bi.ai">
                support@3bi.ai
              </a>
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-medium text-foreground">Registration</h2>
            <p>
              <span className="text-foreground">
                [commercial register and registration number — to be provided, if registered]
              </span>
              <br />
              VAT identification number pursuant to § 27a UStG:{" "}
              <span className="text-foreground">[USt-IdNr. — to be provided, if issued]</span>
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-medium text-foreground">
              Person responsible for content (§ 18 Abs. 2 MStV)
            </h2>
            <p>
              <span className="text-foreground">[name and address — to be provided]</span>
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-medium text-foreground">Consumer dispute resolution</h2>
            <p>
              We are neither willing nor obliged to participate in dispute resolution proceedings
              before a consumer arbitration board. The European Commission&apos;s online dispute
              resolution platform is available at{" "}
              <a
                className="underline"
                href="https://ec.europa.eu/consumers/odr"
                target="_blank"
                rel="noreferrer"
              >
                ec.europa.eu/consumers/odr
              </a>
              .
            </p>
          </section>
        </div>
      </main>
    </PublicShell>
  );
}
