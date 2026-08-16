/** Bunny URL saved on a queue snapshot when the browser only holds a stub File. */
export function storedSourceVideoUrl(
  queueItemId: string | null | undefined,
  snapshots: Record<
    string,
    { bunnyUrls?: { sourceVideoUrl?: string | null } } | undefined
  >
): string | undefined {
  if (!queueItemId) return undefined;
  const url = snapshots[queueItemId]?.bunnyUrls?.sourceVideoUrl?.trim();
  return url || undefined;
}

/** Whether carousel / image-post APIs can resolve a source video for the active row. */
export function hasCarouselVideoSource(input: {
  videoFile: File | null | undefined;
  driveFileId?: string | null;
  sourceVideoUrl?: string | null;
}): boolean {
  const videoFile = input.videoFile;
  const driveFileId = input.driveFileId?.trim();
  const sourceVideoUrl = input.sourceVideoUrl?.trim();
  const useServerSourceVideo =
    Boolean(sourceVideoUrl) && (!videoFile || videoFile.size === 0);
  return (
    Boolean(driveFileId && (!videoFile || videoFile.size === 0)) ||
    useServerSourceVideo ||
    Boolean(videoFile && videoFile.size > 0)
  );
}

export type CarouselVideoIngestOpts = {
  driveFileId?: string;
  sourceJobId?: string;
  sourceVideoUrl?: string;
};

/** Append multipart fields for local upload, Drive ingest, or stored Bunny URL. */
export function appendCarouselVideoIngestFields(
  fd: FormData,
  videoFile: File,
  opts: CarouselVideoIngestOpts
): void {
  const driveFileId = opts.driveFileId?.trim();
  const sourceJobId = opts.sourceJobId?.trim();
  const sourceVideoUrl = opts.sourceVideoUrl?.trim();
  if (driveFileId && (!videoFile || videoFile.size === 0)) {
    if (sourceJobId) fd.append("sourceJobId", sourceJobId);
    fd.append("driveFileId", driveFileId);
  } else if (sourceVideoUrl && (!videoFile || videoFile.size === 0)) {
    fd.append("sourceVideoUrl", sourceVideoUrl);
  } else {
    fd.append("video", videoFile);
  }
}
