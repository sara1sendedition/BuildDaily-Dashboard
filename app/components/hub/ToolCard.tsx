"use client";

import Link from "next/link";

export type ToolCardProps = {
  title: string;
  subtitle: string;
  statLine: string;
  nudge: string;
  href: string;
  cta: string;
  external?: boolean;
  muted?: boolean;
};

export function ToolCard({
  title,
  subtitle,
  statLine,
  nudge,
  href,
  cta,
  external,
  muted,
}: ToolCardProps) {
  const className = `flex flex-col rounded-2xl border p-5 shadow-sm transition-shadow hover:shadow-md h-full ${
    muted
      ? "border-stone-200 bg-stone-50 opacity-70"
      : "border-[var(--bd-line)] bg-[var(--bd-paper)] hover:border-[var(--bd-green-200)]"
  }`;

  const body = (
    <>
      <h3 className="font-semibold text-stone-900">{title}</h3>
      <p className="mt-1 text-sm text-stone-600 flex-1">{subtitle}</p>
      <p
        className={`mt-3 text-sm tabular-nums ${
          statLine && !statLine.startsWith("—")
            ? "font-semibold text-[var(--bd-green-800)]"
            : "text-stone-500"
        }`}
      >
        {statLine || nudge}
      </p>
      {muted ? (
        <span className="mt-4 text-sm font-medium text-stone-400">{cta}</span>
      ) : (
        <span className="mt-4 text-sm font-semibold text-[var(--bd-green-700)]">
          {cta} →
        </span>
      )}
    </>
  );

  if (muted) {
    return <div className={className}>{body}</div>;
  }

  if (external) {
    return (
      <a href={href} className={className} rel="noopener noreferrer">
        {body}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}
