"use client";

import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { cn } from "@/lib/utils";

// shiki pulls in a WASM module that cannot be bundled into the SSR worker,
// so the highlighter is only ever loaded in the browser.
const CodeBlockImpl = lazy(() =>
  import("./code-block").then((m) => ({ default: m.CodeBlock })),
);

type LazyCodeBlockProps = {
  code: string;
  language: string;
  className?: string | undefined;
  showLineNumbers?: boolean | undefined;
};

function PlainCode({ code, className }: { code: string; className?: string | undefined }) {

  return (
    <pre className={cn("overflow-x-auto p-4 text-sm", className)}>
      <code>{code}</code>
    </pre>
  );
}

export function LazyCodeBlock({ code, className, ...props }: LazyCodeBlockProps) {
  const fallback = <PlainCode code={code} className={className} />;
  return (
    <ClientOnly fallback={fallback}>
      <Suspense fallback={fallback}>
        {/* language is a shiki BundledLanguage at runtime */}
        <CodeBlockImpl
          code={code}
          className={className}
          {...(props as { language: never })}
        />
      </Suspense>
    </ClientOnly>
  );
}
