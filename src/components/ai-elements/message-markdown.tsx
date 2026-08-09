"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { ComponentProps } from "react";
import { Streamdown } from "streamdown";

import { cn } from "@/lib/utils";

const streamdownPlugins = { cjk, code, math, mermaid } as unknown as NonNullable<
  ComponentProps<typeof Streamdown>["plugins"]
>;

export type MessageMarkdownProps = ComponentProps<typeof Streamdown>;

// Loaded only in the browser: the code/mermaid plugins pull in shiki's WASM
// grammar, which cannot be bundled into the SSR worker.
export default function MessageMarkdown({ className, ...props }: MessageMarkdownProps) {
  return (
    <Streamdown
      className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      plugins={streamdownPlugins}
      {...props}
    />
  );
}
