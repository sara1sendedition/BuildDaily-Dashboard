"use client";

import { clientApiPath } from "@/lib/client-api-path";

/** Upload Short MP4 to YouTube (public now, or scheduled via RFC3339 from unix on server). */
export async function postYoutubeShortPublish(params: {
  video: File;
  caption: string;
  scheduledPublishTime?: number;
}): Promise<Response> {
  const fd = new FormData();
  fd.append("video", params.video, params.video.name || "short.mp4");
  fd.append("caption", params.caption);
  const t = params.scheduledPublishTime;
  if (t != null && Number.isFinite(t) && t > 0) {
    fd.append("scheduledPublishTime", String(t));
  }
  return fetch(clientApiPath("/api/integrations/youtube/publish"), {
    method: "POST",
    body: fd,
  });
}
