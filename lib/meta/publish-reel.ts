import {
  assertOk,
  MetaGraphError,
  readGraphJsonBody,
  type MetaGraphErrorBody,
} from "./errors";
import { assertInstagramFuturePublishSupported } from "./instagram-native-schedule";
import { fetchInstagramBusinessUserId } from "./publish";

function graphBase(version: string): string {
  return `https://graph.facebook.com/${version}`;
}

const STATUS_POLL_MS = 2000;
const STATUS_MAX_WAIT_MS = 5 * 60 * 1000;

async function graphGet(
  version: string,
  path: string,
  accessToken: string,
  fields: string
): Promise<Record<string, unknown>> {
  const u = new URL(`${graphBase(version)}/${path}`);
  u.searchParams.set("access_token", accessToken);
  u.searchParams.set("fields", fields);
  const res = await fetch(u.toString());
  const data = await readGraphJsonBody(res);
  assertOk(res, data);
  return data;
}

export type PublishReelInput = {
  version: string;
  pageId: string;
  accessToken: string;
  video: Buffer;
  caption: string;
  publishInstagram: boolean;
  publishFacebook: boolean;
  scheduledPublishTime?: number;
};

export type PublishReelResult = {
  instagramMediaId?: string;
  facebookVideoId?: string;
};

/**
 * Instagram Reels via resumable upload; optional Facebook Page native video.
 * @see https://developers.facebook.com/docs/instagram-platform/content-publishing/resumable-uploads
 */
export async function publishReelToMeta(
  input: PublishReelInput
): Promise<PublishReelResult> {
  const {
    version,
    pageId,
    accessToken,
    video,
    caption,
    publishInstagram,
    publishFacebook,
    scheduledPublishTime,
  } = input;

  assertInstagramFuturePublishSupported(
    publishInstagram,
    scheduledPublishTime
  );

  if (!publishInstagram && !publishFacebook) {
    throw new MetaGraphError({
      error: {
        message: "Enable Instagram and/or Facebook for video publish.",
      },
    });
  }

  const result: PublishReelResult = {};

  if (publishInstagram) {
    const igUserId = await fetchInstagramBusinessUserId(
      version,
      pageId,
      accessToken
    );

    const sessionParams = new URLSearchParams();
    sessionParams.set("access_token", accessToken);
    sessionParams.set("media_type", "REELS");
    sessionParams.set("upload_type", "resumable");
    sessionParams.set("caption", caption.trim());
    if (
      scheduledPublishTime != null &&
      Number.isFinite(scheduledPublishTime) &&
      scheduledPublishTime > 0
    ) {
      sessionParams.set("scheduled_publish_time", String(scheduledPublishTime));
    }

    const sessionUrl = `${graphBase(version)}/${igUserId}/media`;
    const sessionRes = await fetch(sessionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: sessionParams.toString(),
    });
    const sessionData = (await readGraphJsonBody(
      sessionRes
    )) as MetaGraphErrorBody & {
      id?: string;
      upload_url?: string;
    };
    assertOk(sessionRes, sessionData);

    const containerId =
      typeof sessionData.id === "string" ? sessionData.id : "";
    const uploadUrl =
      typeof sessionData.upload_url === "string"
        ? sessionData.upload_url
        : "";
    if (!containerId || !uploadUrl) {
      throw new MetaGraphError({
        error: {
          message:
            "Instagram did not return a resumable upload session (id / upload_url). Check app permissions for instagram_content_publish and reels.",
        },
      });
    }

    const upRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${accessToken}`,
        file_offset: "0",
        file_size: String(video.length),
      },
      body: new Uint8Array(video),
    });
    const upText = await upRes.text();
    if (!upRes.ok) {
      let msg = upText.slice(0, 500) || `Video upload failed (${upRes.status}).`;
      try {
        const j = JSON.parse(upText) as { error?: { message?: string } };
        if (j.error?.message) msg = j.error.message;
      } catch {
        /* keep msg */
      }
      throw new MetaGraphError({
        error: { message: `Instagram video upload: ${msg}` },
      });
    }

    const deadline = Date.now() + STATUS_MAX_WAIT_MS;
    let status = "";
    for (;;) {
      if (Date.now() > deadline) {
        throw new MetaGraphError({
          error: {
            message:
              "Instagram video processing timed out. Try again or use a shorter clip.",
          },
        });
      }
      const st = await graphGet(
        version,
        containerId,
        accessToken,
        "status_code"
      );
      status = String(st.status_code ?? "");
      if (status === "FINISHED") break;
      if (status === "ERROR" || status === "EXPIRED") {
        throw new MetaGraphError({
          error: {
            message: `Instagram rejected or failed to process the video (status: ${status}).`,
          },
        });
      }
      await new Promise((r) => setTimeout(r, STATUS_POLL_MS));
    }

    const pubParams = new URLSearchParams();
    pubParams.set("access_token", accessToken);
    pubParams.set("creation_id", containerId);
    const pubUrl = `${graphBase(version)}/${igUserId}/media_publish`;
    const pubRes = await fetch(pubUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: pubParams.toString(),
    });
    const pubData = (await readGraphJsonBody(pubRes)) as MetaGraphErrorBody & {
      id?: string;
    };
    assertOk(pubRes, pubData);
    if (typeof pubData.id === "string") result.instagramMediaId = pubData.id;
  }

  if (publishFacebook) {
    const form = new FormData();
    form.append("access_token", accessToken);
    form.append("description", caption.trim());
    form.append(
      "source",
      new Blob([new Uint8Array(video)], { type: "video/mp4" }),
      "reel.mp4"
    );
    if (
      scheduledPublishTime != null &&
      Number.isFinite(scheduledPublishTime) &&
      scheduledPublishTime > 0
    ) {
      form.append("scheduled_publish_time", String(scheduledPublishTime));
      form.append("published", "false");
    }
    const vidUrl = `${graphBase(version)}/${pageId}/videos`;
    const vidRes = await fetch(vidUrl, { method: "POST", body: form });
    const vidData = (await readGraphJsonBody(vidRes)) as MetaGraphErrorBody & {
      id?: string;
    };
    assertOk(vidRes, vidData);
    if (typeof vidData.id === "string") result.facebookVideoId = vidData.id;
  }

  return result;
}
