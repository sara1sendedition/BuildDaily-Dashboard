"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { storytrackPublicUrl, commentInboxPublicUrl } from "@/lib/hub/env";

function navClass(active: boolean): string {
  return active
    ? "text-[var(--bd-green-800)] font-semibold"
    : "text-stone-600 hover:text-stone-900";
}

export function BuildDailyNav() {
  const pathname = usePathname() ?? "/";
  const storytrackUrl = storytrackPublicUrl();
  const inboxUrl = commentInboxPublicUrl();

  // "Video Tools" groups Studio / Stitch / Multiplier; it reads active whenever
  // the current page is one of the Multiplier/Stitch surfaces.
  const videoToolsActive =
    pathname.startsWith("/stitch") ||
    pathname.startsWith("/multiplier") ||
    pathname.startsWith("/refine") ||
    pathname.startsWith("/image-post") ||
    pathname.startsWith("/style-carousel");

  return (
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <Link
        href="/"
        className="font-bold tracking-tight text-[var(--bd-green-800)] mr-1"
      >
        BuildDaily
      </Link>

      {/* Video Tools — hover dropdown (Studio / Stitch / Multiplier). The pt-2
          on the panel bridges the gap so the menu stays open while the cursor
          moves from the trigger to the items. */}
      <div className="relative group">
        <button
          type="button"
          className={`inline-flex items-center gap-1 ${navClass(videoToolsActive)}`}
          aria-haspopup="true"
        >
          Video Tools
          <svg
            width="12"
            height="12"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="absolute left-0 top-full z-50 hidden pt-2 group-hover:block">
          <div className="min-w-[150px] rounded-lg border border-[var(--bd-line)] bg-[var(--bd-paper)] py-1 shadow-lg">
            <a
              href={storytrackUrl}
              className="block px-3 py-1.5 text-stone-600 hover:bg-stone-100 hover:text-stone-900"
              rel="noopener noreferrer"
            >
              Studio
            </a>
            <Link
              href="/stitch"
              className="block px-3 py-1.5 text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            >
              Stitch
            </Link>
            <Link
              href="/multiplier"
              className="block px-3 py-1.5 text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            >
              Multiplier
            </Link>
          </div>
        </div>
      </div>

      {inboxUrl ? (
        <a href={inboxUrl} className={navClass(false)} rel="noopener noreferrer">
          Community
        </a>
      ) : (
        <span
          className="text-stone-400"
          title="Set NEXT_PUBLIC_COMMENT_INBOX_URL"
        >
          Community
        </span>
      )}

      <Link
        href="/schedule"
        className={navClass(pathname.startsWith("/schedule"))}
      >
        Calendar
      </Link>
      <Link
        href="/settings"
        className={navClass(pathname.startsWith("/settings"))}
      >
        Settings
      </Link>
    </nav>
  );
}
