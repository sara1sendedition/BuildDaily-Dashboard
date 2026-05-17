import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DaemonScheduleEntry } from "./daemon-schema";
import { deleteDaemonReelVideo } from "./daemon-reel-storage";

const FILE = path.join(process.cwd(), ".data", "daemon-schedule.json");

async function ensureDir(): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
}

export async function readDaemonSchedule(): Promise<DaemonScheduleEntry[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is DaemonScheduleEntry =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as DaemonScheduleEntry).id === "string"
    );
  } catch {
    return [];
  }
}

export async function writeDaemonSchedule(
  entries: DaemonScheduleEntry[]
): Promise<void> {
  await ensureDir();
  await writeFile(FILE, JSON.stringify(entries, null, 0), "utf8");
}

export async function upsertDaemonEntry(
  entry: DaemonScheduleEntry
): Promise<void> {
  const isShortSynced =
    entry.scheduleKind === "short" && entry.reelVideoStored === true;
  if (!isShortSynced) {
    await deleteDaemonReelVideo(entry.id);
  }
  const list = await readDaemonSchedule();
  const idx = list.findIndex((x) => x.id === entry.id);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  list.sort((a, b) => a.publishAtUnix - b.publishAtUnix);
  await writeDaemonSchedule(list);
}

export async function deleteDaemonEntry(id: string): Promise<void> {
  await deleteDaemonReelVideo(id);
  const list = (await readDaemonSchedule()).filter((x) => x.id !== id);
  await writeDaemonSchedule(list);
}

export async function clearDaemonSchedule(): Promise<void> {
  await writeDaemonSchedule([]);
}
