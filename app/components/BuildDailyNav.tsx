"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { storytrackPublicUrl, commentInboxPublicUrl } from "@/lib/hub/env";

const internalLinks = [
  { href: "/", label: "Hub", match: (p: string) => p === "/" },
  { href: "/stitch", label: "Clip Stitch", match: (p: string) => p.startsWith("/stitch") },
  {
    href: "/multiplier",
    label: "Multiplier",
    match: (p: string) =>
      p.startsWith("/multiplier") ||
      p.startsWith("/refine") ||
      p.startsWith("/image-post") ||
      p.startsWith("/style-carousel"),
  },
  { href: "/schedule", label: "Calendar", match: (p: string) => p.startsWith("/schedule") },
  { href: "/settings", label: "Settings", match: (p: string) => p.startsWith("/settings") },
] as const;

function navClass(active: boolean): string {
  return active
    ? "text-[var(--bd-green-800)] font-semibold"
    : "text-stone-600 hover:text-stone-900";
}

export function BuildDailyNav() {
  const pathname = usePathname() ?? "/";
  const storytrackUrl = storytrackPublicUrl();
  const inboxUrl = commentInboxPublicUrl();

  return (
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <Link
        href="/"
        className="font-bold tracking-tight text-[var(--bd-green-800)] mr-1"
      >
        BuildDaily
      </Link>
      {internalLinks.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={navClass(item.match(pathname))}
        >
          {item.label}
        </Link>
      ))}
      <a
        href={storytrackUrl}
        className={navClass(false)}
        rel="noopener noreferrer"
      >
        Video Studio
      </a>
      {inboxUrl ? (
        <a href={inboxUrl} className={navClass(false)} rel="noopener noreferrer">
          Comment Converter
        </a>
      ) : (
        <span className="text-stone-400" title="Set NEXT_PUBLIC_COMMENT_INBOX_URL">
          Comment Converter
        </span>
      )}
    </nav>
  );
}
