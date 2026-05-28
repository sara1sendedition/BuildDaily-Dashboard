import type { DriveInboxFile } from "@/app/components/DriveInboxPanel";
import { downloadDriveInboxClip } from "@/lib/drive-inbox-download";

export type DeviceClipEntry = {
  id: string;
  source: "device";
  file: File;
};

export type DriveClipEntry = {
  id: string;
  source: "drive";
  driveId: string;
  name: string;
  sizeMb: number | null;
};

export type ClipEntry = DeviceClipEntry | DriveClipEntry;

export function clipDisplayName(clip: ClipEntry): string {
  return clip.source === "device" ? clip.file.name : clip.name;
}

export function clipDetailLine(clip: ClipEntry): string {
  if (clip.source === "device") {
    const type = clip.file.type ? ` · ${clip.file.type}` : "";
    return `${formatBytes(clip.file.size)}${type}`;
  }
  const size =
    clip.sizeMb != null ? `${clip.sizeMb} MB` : "Size unknown";
  return `${size} · Google Drive (server pulls on Process)`;
}

export function clipBytesEstimate(clip: ClipEntry): number {
  if (clip.source === "device") return clip.file.size;
  if (clip.sizeMb != null) return clip.sizeMb * 1024 * 1024;
  return 0;
}

export function rowIsAllDrive(clips: ClipEntry[]): boolean {
  return clips.length > 0 && clips.every((c) => c.source === "drive");
}

export function rowDriveIds(clips: ClipEntry[]): string[] {
  return clips
    .filter((c): c is DriveClipEntry => c.source === "drive")
    .map((c) => c.driveId);
}

export function driveClipsFromInbox(files: DriveInboxFile[]): DriveClipEntry[] {
  return files.map((f) => ({
    id: safeClipId(),
    source: "drive" as const,
    driveId: f.id,
    name: f.name,
    sizeMb: f.size_mb,
  }));
}

function safeClipId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `clip-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Resolve stitch row clips to Files (downloads Drive refs at call time). */
export async function resolveClipsToFiles(
  clips: ClipEntry[],
  onProgress?: (message: string) => void
): Promise<File[]> {
  const driveTotal = clips.filter((c) => c.source === "drive").length;
  let driveDone = 0;
  const files: File[] = [];

  for (const clip of clips) {
    if (clip.source === "device") {
      files.push(clip.file);
      continue;
    }
    driveDone += 1;
    const sizeHint =
      clip.sizeMb != null ? ` (~${clip.sizeMb} MB)` : "";
    onProgress?.(
      `Downloading from Google Drive (${driveDone}/${driveTotal}): ${clip.name}${sizeHint} — large files can take several minutes; Network may show "pending" until each finishes…`
    );
    files.push(await downloadDriveInboxClip(clip.driveId, clip.name));
  }

  return files;
}
