"use client";

import Link from "next/link";

type Props = {
  postsScheduled: number;
  postsPublished: number;
  clipsStitched: number;
  postsMade: number;
};

export function HubQuickStats({
  postsScheduled,
  postsPublished,
  clipsStitched,
  postsMade,
}: Props) {
  const items = [
    {
      label: "Posts scheduled",
      value: postsScheduled,
      href: "/schedule",
      nudge: "Schedule your next post",
    },
    {
      label: "Clips stitched",
      value: clipsStitched,
      href: "/stitch",
      nudge: "Combine your takes",
    },
    {
      label: "Posts made",
      value: postsMade,
      href: "/multiplier",
      nudge: "Multiply a video",
    },
    {
      label: "Published",
      value: postsPublished,
      href: "/schedule",
      nudge: "",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 h-full content-start">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className="rounded-xl border border-[var(--bd-line)] bg-white/90 p-4 hover:border-[var(--bd-green-200)] transition-colors"
        >
          <p className="text-xs font-medium text-stone-500">{item.label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--bd-ink)]">
            {item.value}
          </p>
          {item.value > 0 || item.nudge ? (
            <p className="mt-1 text-xs text-stone-500">
              {item.value > 0 ? "View →" : item.nudge}
            </p>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
