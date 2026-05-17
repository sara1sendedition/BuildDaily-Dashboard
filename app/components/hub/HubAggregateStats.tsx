"use client";

import Link from "next/link";

type Props = {
  period: "week" | "all";
  onPeriodChange: (p: "week" | "all") => void;
  streak: number;
  videosRecordedThisWeek: number;
  clipsStitched: number;
  postsMade: number;
  postsScheduled: number;
  storytrackUrl: string;
};

export function HubAggregateStats({
  period,
  onPeriodChange,
  streak,
  videosRecordedThisWeek,
  clipsStitched,
  postsMade,
  postsScheduled,
  storytrackUrl,
}: Props) {
  const segments: { label: string; value: number; href: string }[] = [];

  if (period === "week" ? videosRecordedThisWeek > 0 : streak > 0) {
    segments.push({
      label: period === "week" ? "videos recorded" : "day streak",
      value: period === "week" ? videosRecordedThisWeek : streak,
      href: storytrackUrl,
    });
  }
  if (clipsStitched > 0) {
    segments.push({
      label: "clips stitched",
      value: clipsStitched,
      href: "/stitch",
    });
  }
  if (postsMade > 0) {
    segments.push({
      label: "posts made",
      value: postsMade,
      href: "/multiplier",
    });
  }
  if (postsScheduled > 0) {
    segments.push({
      label: "scheduled",
      value: postsScheduled,
      href: "/schedule",
    });
  }

  return (
    <div className="rounded-xl border border-[var(--bd-line)] bg-white/80 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          {period === "week" ? "This week" : "All time"}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onPeriodChange("week")}
            className={`rounded-md px-2 py-0.5 text-xs ${
              period === "week"
                ? "bg-[var(--bd-green-100)] text-[var(--bd-green-800)] font-semibold"
                : "text-stone-500 hover:text-stone-800"
            }`}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => onPeriodChange("all")}
            className={`rounded-md px-2 py-0.5 text-xs ${
              period === "all"
                ? "bg-[var(--bd-green-100)] text-[var(--bd-green-800)] font-semibold"
                : "text-stone-500 hover:text-stone-800"
            }`}
          >
            All
          </button>
        </div>
      </div>
      {segments.length === 0 ? (
        <p className="text-sm text-stone-500">
          Your wins will show up here — start in Video Studio or Multiplier.
        </p>
      ) : (
        <p className="text-sm text-stone-700 flex flex-wrap gap-x-1 gap-y-1">
          {segments.map((s, i) => (
            <span key={s.href + s.label}>
              {i > 0 ? <span className="text-stone-400"> · </span> : null}
              <Link href={s.href} className="hover:underline">
                <strong className="tabular-nums text-[var(--bd-green-800)]">
                  {s.value}
                </strong>{" "}
                {s.label}
              </Link>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
