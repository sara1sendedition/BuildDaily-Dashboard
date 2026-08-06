import * as fs from "fs/promises";
import { createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

/** Download a remote URL to a local file (server-side), streaming to disk. */
export async function fetchUrlToFile(
  url: string,
  destPath: string,
  options?: { timeoutMs?: number }
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Could not download video (${res.status})`);
    }
    if (!res.body) {
      throw new Error("Downloaded video response had no body");
    }
    const nodeStream = Readable.fromWeb(
      res.body as import("stream/web").ReadableStream,
    );
    await pipeline(nodeStream, createWriteStream(destPath));
    const stat = await fs.stat(destPath);
    if (stat.size === 0) {
      throw new Error("Downloaded video file is empty");
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("Video download timed out");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
