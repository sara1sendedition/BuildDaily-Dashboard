"use client";

import type { ExternalCalendarVideo } from "@/lib/schedule/external-calendar-video";
import {
  externalVideoLabel,
  scheduleDragPayload,
} from "@/lib/schedule/external-calendar-video";

const DRAG_MIME = "application/x-video-studio-queue-id";

type ExternalCalendarVideosPanelProps = {
  videos: ExternalCalendarVideo[];
  uploadInputId: string;
  onFilesSelected: (files: File[]) => void;
  onRemove: (id: string) => void;
};

function ExternalVideoRow({
  video,
  onRemove,
}: {
  video: ExternalCalendarVideo;
  onRemove: (id: string) => void;
}) {
  const label = externalVideoLabel(video.file);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          DRAG_MIME,
          scheduleDragPayload({
            externalVideoId: video.id,
            scheduleKind: "short",
          })
        );
        e.dataTransfer.setData("text/plain", label);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className="flex cursor-grab items-center gap-3 rounded-xl border border-violet-200/80 bg-violet-50/50 p-2 active:cursor-grabbing"
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-[10px] font-semibold text-white">
        ▶
      </div>
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-medium text-stone-800">{label}</p>
        <p className="mt-0.5 text-[10px] text-violet-800/80">
          Short · edited outside Multiplier
        </p>
      </div>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={() => onRemove(video.id)}
        className="shrink-0 rounded-md border border-stone-200 bg-white px-2 py-1 text-[10px] font-medium text-stone-600 hover:bg-stone-50"
      >
        Remove
      </button>
    </div>
  );
}

export function ExternalCalendarVideosPanel({
  videos,
  uploadInputId,
  onFilesSelected,
  onRemove,
}: ExternalCalendarVideosPanelProps) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
        Upload a video
      </h2>
      <div className="mt-3 rounded-xl border border-dashed border-violet-200/90 bg-violet-50/30 p-3 text-center">
        <input
          id={uploadInputId}
          type="file"
          accept="video/*,.mp4,.mov,.webm,.m4v,.mkv"
          multiple
          className="sr-only"
          onChange={(e) => {
            const list = e.target.files;
            if (list?.length) onFilesSelected(Array.from(list));
            e.target.value = "";
          }}
        />
        <label
          htmlFor={uploadInputId}
          className="inline-flex cursor-pointer select-none justify-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800"
        >
          Choose video file
        </label>
        <p className="mt-2 text-[10px] text-stone-500">
          MP4, MOV, WebM · drag onto a day to schedule
        </p>
      </div>
      {videos.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {videos.map((video) => (
            <li key={video.id}>
              <ExternalVideoRow video={video} onRemove={onRemove} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function ExternalVideoPickRow({
  video,
  onPick,
}: {
  video: ExternalCalendarVideo;
  onPick: () => void;
}) {
  const label = externalVideoLabel(video.file);
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-center gap-3 rounded-xl border border-violet-200/80 bg-violet-50/50 p-2 text-left transition hover:border-violet-400/50 hover:bg-violet-50"
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-[10px] font-semibold text-white">
        ▶
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-stone-800">{label}</p>
        <p className="mt-0.5 text-[10px] text-violet-800/80">Short</p>
      </div>
    </button>
  );
}
