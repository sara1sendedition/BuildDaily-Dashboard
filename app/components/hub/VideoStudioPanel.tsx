"use client";

import { DismissableHint } from "@/app/components/DismissableHint";
import type { StoryTrackHubSummary } from "@/lib/hub/types";

type Props = {
  summary: StoryTrackHubSummary | null;
  linked: boolean;
  storytrackBaseUrl: string;
};

export function VideoStudioPanel({ summary, linked, storytrackBaseUrl }: Props) {
  const recordHref = summary?.recordTodayUrl
    ? `${storytrackBaseUrl}${summary.recordTodayUrl.startsWith("/") ? "" : "/"}${summary.recordTodayUrl}`
    : `${storytrackBaseUrl}/`;

  if (!linked || !summary) {
    return (
      <section className="rounded-2xl border border-[var(--bd-line)] bg-[var(--bd-paper)] p-6 shadow-sm h-full flex flex-col justify-between">
        <div>
          <h2 className="font-serif text-xl font-semibold text-[var(--bd-ink)]">
            Video Studio
          </h2>
          <DismissableHint id="video-studio-unlinked" className="mt-2">
            <p className="text-sm text-stone-600">
              Record Build in Public segments with a teleprompter, stitch your daily
              video, and build your streak.
            </p>
          </DismissableHint>
          <p className="text-sm text-stone-500 mb-3 mt-6">
            Open Video Studio to start your streak.
          </p>
          <a
            href={storytrackBaseUrl}
            className="inline-flex items-center justify-center rounded-xl bg-[var(--bd-green-700)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--bd-green-800)]"
          >
            Open Video Studio →
          </a>
        </div>
      </section>
    );
  }

  const { streak, weekStrip, videosRecordedThisWeek, activeChallenge } = summary;

  return (
    <section className="rounded-2xl border border-[var(--bd-line)] bg-[var(--bd-paper)] p-6 shadow-sm h-full">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-serif text-xl font-semibold text-[var(--bd-ink)]">
          Video Studio
        </h2>
        <a
          href={storytrackBaseUrl}
          className="text-xs font-semibold text-[var(--bd-green-700)] hover:underline"
        >
          Open app →
        </a>
      </div>
      <p className="mt-1 text-sm text-stone-600">
        {streak > 0
          ? `${streak}-day recording streak`
          : "Record today to start your streak"}
      </p>

      <div>
        <p className="text-4xl font-extrabold tabular-nums text-[var(--bd-ink)]">
          {streak}
          <span className="text-lg font-semibold text-stone-500 ml-1">
            {streak === 1 ? "day" : "days"}
          </span>
        </p>
        <div className="mt-4 flex w-full justify-between gap-0.5 max-w-xs mx-auto">
          {weekStrip.map((cell) => (
            <div key={cell.date} className="flex flex-1 flex-col items-center">
              <span className="text-[10px] font-medium text-stone-500">
                {cell.shortLabel}
              </span>
              <span
                className={`mt-1 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                  cell.complete
                    ? "bg-[var(--bd-green-600)] text-white"
                    : cell.isToday
                      ? "border-2 border-[var(--bd-green-600)] bg-[var(--bd-green-50)] text-stone-500"
                      : "border border-stone-200 bg-white text-stone-400"
                }`}
              >
                {cell.complete ? "✓" : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3 text-xs text-stone-600">
        <span className="tabular-nums">
          <strong className="text-stone-800">{videosRecordedThisWeek}</strong> this week
        </span>
        {activeChallenge ? (
          <span>
            Challenge: <strong className="text-stone-800">{activeChallenge.title}</strong>{" "}
            (Day {activeChallenge.day}/{activeChallenge.totalDays})
          </span>
        ) : null}
      </div>

      <a
        href={recordHref}
        className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-[var(--bd-green-700)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--bd-green-800)]"
      >
        Record today →
      </a>
    </section>
  );
}
