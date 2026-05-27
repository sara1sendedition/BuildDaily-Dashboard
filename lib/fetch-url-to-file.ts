import * as fs from "fs/promises";

/** Download a remote URL to a local file (server-side). */
export async function fetchUrlToFile(
  url: string,
  destPath: string,
  options?: { timeoutMs?: number }
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Could not download video (${res.status})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      throw new Error("Downloaded video file is empty");
    }
    await fs.writeFile(destPath, buf);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("Video download timed out");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
