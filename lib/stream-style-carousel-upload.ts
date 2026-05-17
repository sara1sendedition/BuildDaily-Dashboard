import busboy from "busboy";
import { createWriteStream } from "fs";
import type { IncomingHttpHeaders } from "http";
import path from "path";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { maxUploadBytes } from "@/lib/stream-multipart-video";

function headersForBusboy(request: Request): IncomingHttpHeaders {
  const h: IncomingHttpHeaders = {};
  request.headers.forEach((value, key) => {
    h[key.toLowerCase()] = value;
  });
  return h;
}

export type StreamStyleCarouselUploadResult = {
  videoPath: string;
  styleImagePath: string;
  fields: Record<string, string>;
};

/**
 * Multipart: required `video` + `styleImage` (reference graphic with text overlay), plus same string fields as `/api/process`.
 */
export async function streamStyleCarouselUploadToDisk(
  request: Request,
  workDir: string,
  videoBasename: string
): Promise<StreamStyleCarouselUploadResult> {
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
  let gotStyle = false;
  let styleImagePath: string | undefined;
  let settled = false;
  const fileWrites: Promise<void>[] = [];

  return new Promise((resolve, reject) => {
    function finish(err: unknown, val?: StreamStyleCarouselUploadResult) {
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
        if (name === "styleImage") {
          if (gotStyle) {
            file.resume();
            return;
          }
          gotStyle = true;
          const ext =
            path.extname(info.filename || "").replace(/[^.a-zA-Z0-9]/g, "") ||
            ".jpg";
          styleImagePath = path.join(
            workDir,
            `style-ref-${randomUUID()}${ext}`
          );
          const write = createWriteStream(styleImagePath);
          file.on("limit", () => {
            finish(
              new Error(
                "Style image exceeds maximum upload size (set MAX_UPLOAD_MB to raise the cap)."
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
          if (!gotStyle || !styleImagePath) {
            finish(new Error("Missing styleImage file"));
            return;
          }
          finish(null, {
            videoPath,
            styleImagePath,
            fields,
          });
        } catch (e) {
          finish(e);
        }
      })();
    });

    Readable.fromWeb(body as import("stream/web").ReadableStream).pipe(bb);
  });
}
