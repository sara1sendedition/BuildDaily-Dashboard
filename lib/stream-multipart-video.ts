import busboy from "busboy";
import { createWriteStream } from "fs";
import type { IncomingHttpHeaders } from "http";
import path from "path";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

/** Max video size (bytes). Override with `MAX_UPLOAD_MB` (1–2000, default 500). */
export function maxUploadBytes(): number {
  const mb = parseInt(process.env.MAX_UPLOAD_MB ?? "500", 10);
  if (!Number.isFinite(mb) || mb < 1) return 500 * 1024 * 1024;
  return Math.min(mb, 2000) * 1024 * 1024;
}

function headersForBusboy(request: Request): IncomingHttpHeaders {
  const h: IncomingHttpHeaders = {};
  request.headers.forEach((value, key) => {
    h[key.toLowerCase()] = value;
  });
  return h;
}

export type StreamCarouselUploadResult = {
  videoPath: string;
  fields: Record<string, string>;
  /** Raw uploaded path before optional FFmpeg normalize (caller deletes with workDir). */
  backgroundUploadPath?: string;
};

/**
 * Streams multipart form: required `video`, optional `background` image, plus string fields.
 */
export async function streamCarouselUploadToDisk(
  request: Request,
  workDir: string,
  videoBasename: string
): Promise<StreamCarouselUploadResult> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().includes("multipart/form-data")) {
    throw new Error("Expected multipart/form-data");
  }

  const videoPath = path.join(workDir, videoBasename);
  const fields: Record<string, string> = {};
  const body = request.body;
  if (!body) {
    throw new Error("Missing request body");
  }

  const bb = busboy({
    headers: headersForBusboy(request),
    limits: {
      fileSize: maxUploadBytes(),
      fieldSize: 8 * 1024 * 1024,
      files: 2,
    },
  });

  let gotVideo = false;
  let gotBackground = false;
  let backgroundUploadPath: string | undefined;
  let settled = false;
  const fileWrites: Promise<void>[] = [];

  return new Promise((resolve, reject) => {
    function finish(err: unknown, val?: StreamCarouselUploadResult) {
      if (settled) return;
      settled = true;
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      } else if (val) {
        resolve(val);
      } else {
        reject(new Error("Internal upload error"));
      }
    }

    bb.on(
      "file",
      (name, file, info: { filename?: string; mimeType?: string }) => {
        if (name === "video") {
          if (gotVideo) {
            file.resume();
            return;
          }
          gotVideo = true;
          const write = createWriteStream(videoPath);
          file.on("limit", () => {
            finish(
              new Error(
                "Video exceeds maximum upload size (set MAX_UPLOAD_MB to raise the cap)."
              )
            );
          });
          fileWrites.push(pipeline(file, write).then(() => undefined));
          return;
        }
        if (name === "background") {
          if (gotBackground) {
            file.resume();
            return;
          }
          gotBackground = true;
          const ext =
            path.extname(info.filename || "").replace(/[^.a-zA-Z0-9]/g, "") ||
            ".jpg";
          backgroundUploadPath = path.join(
            workDir,
            `bg-upload-${randomUUID()}${ext}`
          );
          const write = createWriteStream(backgroundUploadPath);
          file.on("limit", () => {
            finish(
              new Error(
                "Background image exceeds maximum upload size (set MAX_UPLOAD_MB to raise the cap)."
              )
            );
          });
          fileWrites.push(pipeline(file, write).then(() => undefined));
          return;
        }
        file.resume();
      }
    );

    bb.on("field", (name, val) => {
      fields[name] = val;
    });

    bb.on("error", (err) => finish(err));

    bb.on("close", () => {
      void (async () => {
        try {
          await Promise.all(fileWrites);
          if (!gotVideo) {
            finish(new Error("Missing video file"));
            return;
          }
          finish(null, {
            videoPath,
            fields,
            backgroundUploadPath,
          });
        } catch (e) {
          finish(e);
        }
      })();
    });

    Readable.fromWeb(body as import("stream/web").ReadableStream).pipe(bb);
  });
}

/** @deprecated Use {@link streamCarouselUploadToDisk} */
export async function streamVideoFieldToDisk(
  request: Request,
  workDir: string,
  videoBasename: string
): Promise<StreamCarouselUploadResult> {
  return streamCarouselUploadToDisk(request, workDir, videoBasename);
}
