/**
 * YouTube Data API v3 resumable upload (single PUT with full MP4 body).
 * @see https://developers.google.com/youtube/v3/guides/uploading_a_video
 */

export type UploadYoutubeVideoInput = {
  accessToken: string;
  video: Buffer;
  title: string;
  description: string;
  /** When set, schedules public release (privacy private until publish time). RFC3339 UTC. */
  publishAtIsoUtc?: string;
};

export type UploadYoutubeVideoResult = { videoId: string };

export async function uploadYoutubeVideoResumable(
  input: UploadYoutubeVideoInput
): Promise<UploadYoutubeVideoResult> {
  const title = input.title.trim().slice(0, 100) || "Video";
  const description = input.description.trim().slice(0, 5000);

  const status = input.publishAtIsoUtc
    ? {
        privacyStatus: "private" as const,
        selfDeclaredMadeForKids: false,
        publishAt: input.publishAtIsoUtc,
      }
    : {
        privacyStatus: "public" as const,
        selfDeclaredMadeForKids: false,
      };

  const metadata = {
    snippet: {
      title,
      description,
      categoryId: "22",
    },
    status,
  };

  const jsonBody = JSON.stringify(metadata);
  const jsonBytes = Buffer.byteLength(jsonBody, "utf8");

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "Content-Length": String(jsonBytes),
        "X-Upload-Content-Length": String(input.video.length),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: jsonBody,
    }
  );

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(
      `YouTube upload init failed (${initRes.status}): ${errText.slice(0, 500)}`
    );
  }

  const location = initRes.headers.get("Location");
  if (!location) {
    throw new Error("YouTube resumable upload: missing Location header.");
  }

  const putRes = await fetch(location, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "video/mp4",
      "Content-Length": String(input.video.length),
    },
    body: new Uint8Array(input.video),
  });

  const putData = (await putRes.json()) as {
    id?: string;
    error?: { message?: string };
  };

  if (!putRes.ok) {
    const msg =
      putData.error?.message ??
      (typeof putData === "object" ? JSON.stringify(putData) : "");
    throw new Error(
      msg ? `YouTube upload failed: ${msg}` : `YouTube upload failed (${putRes.status}).`
    );
  }

  if (!putData.id || typeof putData.id !== "string") {
    throw new Error("YouTube upload succeeded but no video id was returned.");
  }

  return { videoId: putData.id };
}
