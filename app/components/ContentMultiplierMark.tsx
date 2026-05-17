"use client";

import Link from "next/link";

export const CONTENT_MULTIPLIER_NAME = "BuildDaily Multiplier";

type MarkProps = {
  as?: "h1" | "div";
  compact?: boolean;
  className?: string;
};

/** Wordmark only — text title (e.g. home header). */
export function ContentMultiplierMark({
  as: Tag = "h1",
  compact = false,
  className = "",
}: MarkProps) {
  const textClass = compact
    ? "text-lg font-semibold tracking-tight text-stone-900"
    : "text-3xl font-semibold tracking-tight text-stone-900";
  return (
    <Tag className={`m-0 flex items-center ${className}`}>
      <span className={textClass}>{CONTENT_MULTIPLIER_NAME}</span>
    </Tag>
  );
}

type HomeLinkProps = {
  className?: string;
};

/** Back to home — text link "← BuildDaily Multiplier". */
export function ContentMultiplierHomeLink({
  className = "inline-flex items-center gap-2 text-sm font-medium text-palette-depth hover:text-stone-900",
}: HomeLinkProps) {
  return (
    <Link href="/multiplier" className={className}>
      <span>← {CONTENT_MULTIPLIER_NAME}</span>
    </Link>
  );
}
