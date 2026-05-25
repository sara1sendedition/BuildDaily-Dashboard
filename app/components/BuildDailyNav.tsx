"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { clientApiPath } from "@/lib/client-api-path";
import { storytrackPublicUrl, commentInboxPublicUrl } from "@/lib/hub/env";

function navClass(active: boolean): string {
  return active
    ? "text-[var(--bd-green-800)] font-semibold"
    : "text-stone-600 hover:text-stone-900";
}

function toolsActive(pathname: string): boolean {
  return (
    pathname.startsWith("/stitch") ||
    pathname.startsWith("/multiplier") ||
    pathname.startsWith("/refine") ||
    pathname.startsWith("/image-post") ||
    pathname.startsWith("/style-carousel")
  );
}

type ToolItem =
  | {
      kind: "internal";
      href: string;
      label: string;
      match: (pathname: string) => boolean;
    }
  | {
      kind: "external";
      href: string;
      label: string;
      disabled?: boolean;
      disabledTitle?: string;
    };

function ToolMenuItem({
  item,
  pathname,
}: {
  item: ToolItem;
  pathname: string;
}) {
  const itemClass =
    "block rounded-md px-3 py-2 text-sm transition-colors " +
    (item.kind === "internal" && item.match(pathname)
      ? "bg-[var(--bd-green-50)] font-semibold text-[var(--bd-green-800)]"
      : "text-stone-700 hover:bg-stone-50 hover:text-stone-900");

  if (item.kind === "internal") {
    return (
      <Link href={item.href} className={itemClass}>
        {item.label}
      </Link>
    );
  }

  if (item.disabled) {
    return (
      <span
        className="block cursor-not-allowed rounded-md px-3 py-2 text-sm text-stone-400"
        title={item.disabledTitle}
      >
        {item.label}
      </span>
    );
  }

  return (
    <a
      href={item.href}
      className={itemClass}
      rel="noopener noreferrer"
    >
      {item.label}
    </a>
  );
}

export function BuildDailyNav() {
  const pathname = usePathname() ?? "/";
  const storytrackUrl = storytrackPublicUrl();
  const inboxUrl = commentInboxPublicUrl();
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setToolsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!toolsOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!toolsMenuRef.current?.contains(event.target as Node)) {
        setToolsOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [toolsOpen]);

  const toolItems: ToolItem[] = [
    { kind: "external", href: storytrackUrl, label: "Video Studio" },
    {
      kind: "internal",
      href: "/stitch",
      label: "Stitch",
      match: (p) => p.startsWith("/stitch"),
    },
    {
      kind: "internal",
      href: "/multiplier",
      label: "Multiplier",
      match: (p) =>
        p.startsWith("/multiplier") ||
        p.startsWith("/refine") ||
        p.startsWith("/image-post") ||
        p.startsWith("/style-carousel"),
    },
    inboxUrl
      ? { kind: "external", href: inboxUrl, label: "CommentConvert" }
      : {
          kind: "external",
          href: "#",
          label: "CommentConvert",
          disabled: true,
          disabledTitle: "Set NEXT_PUBLIC_COMMENT_INBOX_URL",
        },
  ];

  return (
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <Link
        href="/"
        className="inline-flex items-center gap-2 font-bold tracking-tight text-[var(--bd-green-800)] mr-1"
      >
        <img
          src={clientApiPath("/content-multiplier-logo.png")}
          alt=""
          width={28}
          height={28}
          className="h-7 w-7 shrink-0 rounded-md"
        />
        BuildDaily
      </Link>

      <div
        ref={toolsMenuRef}
        className="relative"
        onMouseEnter={() => setToolsOpen(true)}
        onMouseLeave={() => setToolsOpen(false)}
      >
        <button
          type="button"
          className={`${navClass(toolsActive(pathname))} inline-flex items-center gap-1`}
          aria-haspopup="true"
          aria-expanded={toolsOpen}
          onClick={() => setToolsOpen((open) => !open)}
        >
          Tools
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
            className={`h-4 w-4 opacity-60 transition-transform ${toolsOpen ? "rotate-180" : ""}`}
          >
            <path
              fillRule="evenodd"
              d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <div
          className={`absolute left-0 top-full z-50 pt-1 transition-opacity ${
            toolsOpen ? "visible opacity-100" : "invisible opacity-0"
          }`}
        >
          <div className="min-w-[11rem] rounded-lg border border-[var(--bd-line)] bg-white py-1 shadow-md">
            {toolItems.map((item) => (
              <ToolMenuItem key={item.label} item={item} pathname={pathname} />
            ))}
          </div>
        </div>
      </div>

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
