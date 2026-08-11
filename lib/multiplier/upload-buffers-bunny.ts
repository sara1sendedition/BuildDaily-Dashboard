import { storage } from "@/lib/storage/bunny-adapter";
import { ensureMp4FaststartBuffer } from "@/lib/ffmpeg";

/** Upload raw buffers to Bunny Storage; returns public CDN URLs. */
export async function uploadBuffersToBunnyStorage(
  buffers: Buffer[],
  opts: {
    userId: string;
    prefix: string;
    contentType?: string;
    ext?: string;
  },
): Promise<string[]> {
  const contentType = opts.contentType ?? "image/png";
  const ext = opts.ext ?? "png";
  const urls: string[] = [];
  for (let i = 0; i < buffers.length; i++) {
    const token = await storage.createUploadToken({
      kind: "thumbnail",
      userId: opts.userId,
      filename: `${opts.prefix}-${String(i + 1).padStart(2, "0")}.${ext}`,
      contentType,
    });
    const res = await fetch(token.uploadUrl, {
      method: "PUT",
      headers: {
        ...token.headers,
        "Content-Type": contentType,
      },
      body: new Uint8Array(buffers[i]!),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Bunny upload failed (${res.status})${text ? `: ${text.slice(0, 160)}` : ""}`,
      );
    }
    urls.push(token.playbackUrl);
  }
  return urls;
}

export async function uploadFileBufferToBunnyStorage(
  buffer: Buffer,
  opts: {
    userId: string;
    filename: string;
    contentType: string;
  },
): Promise<string> {
  const isMp4 =
    opts.contentType === "video/mp4" ||
    opts.filename.toLowerCase().endsWith(".mp4");
  const body = isMp4 ? await ensureMp4FaststartBuffer(buffer) : buffer;
  const token = await storage.createUploadToken({
    kind: "thumbnail",
    userId: opts.userId,
    filename: opts.filename,
    contentType: opts.contentType,
  });
  const res = await fetch(token.uploadUrl, {
    method: "PUT",
    headers: {
      ...token.headers,
      "Content-Type": opts.contentType,
    },
    body: new Uint8Array(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Bunny upload failed (${res.status})${text ? `: ${text.slice(0, 160)}` : ""}`,
    );
  }
  return token.playbackUrl;
}
