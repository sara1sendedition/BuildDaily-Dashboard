import type { VideoQueueItem } from "@/context/carousel-workspace-context";

export function queueItemFileStem(fileName: string): string {
  const stem = fileName.replace(/\.[^/.]+$/, "").trim();
  return stem || fileName;
}

/** User-facing title in the queue and calendar (custom label or filename stem). */
export function queueItemDisplayLabel(
  item: Pick<VideoQueueItem, "file" | "displayLabel">
): string {
  const custom = item.displayLabel?.trim();
  if (custom) return custom;
  return queueItemFileStem(item.file.name);
}

/** Value stored on schedule rows and drag-and-drop (custom label or full filename). */
export function queueItemScheduleLabel(
  item: Pick<VideoQueueItem, "file" | "displayLabel">
): string {
  const custom = item.displayLabel?.trim();
  if (custom) return custom;
  return item.file.name;
}
