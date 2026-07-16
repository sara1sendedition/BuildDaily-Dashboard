"use client";

import { useState } from "react";
import Link from "next/link";
import { storytrackPublicUrl, commentInboxPublicUrl } from "@/lib/hub/env";

const PATHS = [
  {
    label: "Build in Public → multiply → schedule",
    steps: ["storytrack", "multiplier", "schedule"] as const,
  },
  {
    label: "Raw clips → stitch → multiply",
    steps: ["stitch", "multiplier", "schedule"] as const,
  },
  {
    label: "Raw clips → stitch → short only",
    steps: ["stitch", "video-editor", "schedule"] as const,
  },
  {
    label: "Video ready → multiply",
    steps: ["multiplier", "schedule"] as const,
  },
  {
    label: "Video ready → short only",
    steps: ["video-editor", "schedule"] as const,
  },
  {
    label: "Comments only",
    steps: ["inbox"] as const,
  },
];

function stepHref(
  step: (typeof PATHS)[number]["steps"][number]
): string {
  switch (step) {
    case "storytrack":
      return storytrackPublicUrl();
    case "stitch":
      return "/stitch";
    case "multiplier":
      return "/multiplier";
    case "video-editor":
      return "/video-editor";
    case "schedule":
      return "/schedule";
    case "inbox":
      return commentInboxPublicUrl() ?? "#";
  }
}

export function CommonPaths() {
  const [open, setOpen] = useState(false);

  return (
    <section className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-semibold text-stone-700 hover:text-stone-900"
      >
        {open ? "Hide" : "Show"} common paths
      </button>
      {open ? (
        <ul className="mt-3 flex flex-col gap-2">
          {PATHS.map((path) => (
            <li key={path.label}>
              <span className="text-xs text-stone-500 block mb-1">{path.label}</span>
              <div className="flex flex-wrap gap-2">
                {path.steps.map((step, i) => (
                  <span key={step} className="inline-flex items-center gap-2">
                    {i > 0 ? (
                      <span className="text-stone-400 text-xs">→</span>
                    ) : null}
                    {step === "inbox" && !commentInboxPublicUrl() ? (
                      <span className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-500">
                        Comment Converter
                      </span>
                    ) : step === "storytrack" || step === "inbox" ? (
                      <a
                        href={stepHref(step)}
                        className="rounded-full bg-[var(--bd-green-50)] border border-[var(--bd-green-200)] px-3 py-1 text-xs font-medium text-[var(--bd-green-800)] hover:bg-[var(--bd-green-100)]"
                        rel={step === "inbox" ? "noopener noreferrer" : undefined}
                      >
                        {step === "storytrack" ? "Video Studio" : "Comment Converter"}
                      </a>
                    ) : (
                      <Link
                        href={stepHref(step)}
                        className="rounded-full bg-[var(--bd-green-50)] border border-[var(--bd-green-200)] px-3 py-1 text-xs font-medium text-[var(--bd-green-800)] hover:bg-[var(--bd-green-100)]"
                      >
                        {step === "stitch"
                          ? "Clip Stitch"
                          : step === "multiplier"
                            ? "Multiplier"
                            : step === "video-editor"
                              ? "Video Editor"
                              : "Calendar"}
                      </Link>
                    )}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
