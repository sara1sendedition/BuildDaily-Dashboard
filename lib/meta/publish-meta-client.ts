import { clientApiPath } from "@/lib/client-api-path";
import { buildMetaPublishFormData, slideBase64ToBlob } from "./build-publish-form-data";

/**
 * Publish carousel to Meta. For **2+ slides**, uses init → one HTTP request per slide → finalize
 * so each upload stays under body-size limits; **one** Instagram/Facebook carousel post at the end.
 * Single slide uses one multipart request.
 */
export async function postMetaCarouselPublish(params: {
  slidesBase64: string[];
  caption: string;
  publishInstagram: boolean;
  publishFacebook: boolean;
  scheduledPublishTime?: number;
}): Promise<Response> {
  const {
    slidesBase64,
    caption,
    publishInstagram,
    publishFacebook,
    scheduledPublishTime,
  } = params;

  if (slidesBase64.length === 0) {
    return new Response(
      JSON.stringify({ error: "At least one slide image is required." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (slidesBase64.length <= 1) {
    const body = buildMetaPublishFormData({
      caption,
      publishInstagram,
      publishFacebook,
      scheduledPublishTime,
      slidesBase64,
    });
    return fetch(clientApiPath("/api/integrations/meta/publish"), {
      method: "POST",
      body,
    });
  }

  /** One multipart with every slide avoids in-memory init/part/finalize sessions (fragile on multi-instance hosts and dev HMR). */
  const oneShotBody = buildMetaPublishFormData({
    caption,
    publishInstagram,
    publishFacebook,
    scheduledPublishTime,
    slidesBase64,
  });
  const oneShotRes = await fetch(clientApiPath("/api/integrations/meta/publish"), {
    method: "POST",
    body: oneShotBody,
  });
  if (oneShotRes.status !== 413) {
    return oneShotRes;
  }

  const initRes = await fetch(clientApiPath("/api/integrations/meta/publish/init"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slideCount: slidesBase64.length,
      caption,
      publishInstagram,
      publishFacebook,
      ...(scheduledPublishTime &&
      Number.isFinite(scheduledPublishTime) &&
      scheduledPublishTime > 0
        ? { scheduledPublishTime }
        : {}),
    }),
  });
  if (!initRes.ok) return initRes;

  let sessionId: string;
  try {
    const j = (await initRes.json()) as { sessionId?: string };
    sessionId = typeof j.sessionId === "string" ? j.sessionId : "";
  } catch {
    return new Response(JSON.stringify({ error: "Invalid init response JSON." }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "Init did not return sessionId." }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  for (let i = 0; i < slidesBase64.length; i++) {
    const fd = new FormData();
    fd.append("sessionId", sessionId);
    fd.append("index", String(i));
    fd.append(
      "slide",
      slideBase64ToBlob(slidesBase64[i]!, i + 1),
      `slide_${String(i + 1).padStart(2, "0")}.png`
    );
    const partRes = await fetch(clientApiPath("/api/integrations/meta/publish/part"), {
      method: "POST",
      body: fd,
    });
    if (!partRes.ok) return partRes;
  }

  return fetch(clientApiPath("/api/integrations/meta/publish/finalize"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
}

/** Instagram Reels (+ optional Facebook Page video) via resumable upload. */
export async function postMetaReelPublish(params: {
  video: File;
  caption: string;
  publishInstagram: boolean;
  publishFacebook: boolean;
  scheduledPublishTime?: number;
}): Promise<Response> {
  const fd = new FormData();
  fd.append("video", params.video, params.video.name || "short.mp4");
  fd.append("caption", params.caption);
  fd.append("publishInstagram", params.publishInstagram ? "1" : "0");
  fd.append("publishFacebook", params.publishFacebook ? "1" : "0");
  const t = params.scheduledPublishTime;
  if (t != null && Number.isFinite(t) && t > 0) {
    fd.append("scheduledPublishTime", String(t));
  }
  return fetch(clientApiPath("/api/integrations/meta/publish-reel"), {
    method: "POST",
    body: fd,
  });
}
