"use client";

import type { VideoQueueItem } from "@/context/carousel-workspace-context";
import type { MultiplierOutputKey } from "@/lib/multiplier-queue/output-state";

const LABELS: Record<MultiplierOutputKey, string> = {
  carousel: "Carousel",
  photo: "Image",
  short: "Short",
};

export function QueueItemOutputPills({ item }: { item: VideoQueueItem }) {
  const outputs = item.outputs;
  if (!outputs) return null;
  const keys = (["carousel", "photo", "short"] as const).filter((key) => {
    const status = outputs[key]?.status;
    return Boolean(status) && status !== "skipped";
  });
  if (keys.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {keys.map((key) => {
        const output = outputs[key]!;
        const failed = output.status === "failed";
        const done = output.status === "done";
        return (
          <span
            key={key}
            title={output.error?.trim() || output.progress || LABELS[key]}
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              failed
                ? "bg-red-100 text-red-800"
                : done
                  ? "bg-stone-100 text-stone-600"
                  : "bg-palette-pale/35 text-palette-depth"
            }`}
          >
            {failed
              ? `${LABELS[key]} error`
              : done
                ? LABELS[key]
                : `${LABELS[key]}…`}
          </span>
        );
      })}
    </div>
  );
}
