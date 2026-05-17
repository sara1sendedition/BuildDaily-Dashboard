import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

function reelDir(): string {
  return path.join(process.cwd(), ".data", "daemon-reels");
}

export function daemonReelMp4Path(scheduleId: string): string {
  return path.join(reelDir(), `${scheduleId}.mp4`);
}

export async function ensureDaemonReelsDir(): Promise<void> {
  await mkdir(reelDir(), { recursive: true });
}

export async function saveDaemonReelVideo(
  scheduleId: string,
  data: Buffer
): Promise<void> {
  await ensureDaemonReelsDir();
  await writeFile(daemonReelMp4Path(scheduleId), data);
}

export async function readDaemonReelVideo(scheduleId: string): Promise<Buffer> {
  return readFile(daemonReelMp4Path(scheduleId));
}

export async function deleteDaemonReelVideo(scheduleId: string): Promise<void> {
  await unlink(daemonReelMp4Path(scheduleId)).catch(() => undefined);
}
