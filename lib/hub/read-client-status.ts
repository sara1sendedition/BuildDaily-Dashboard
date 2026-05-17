import { peekStitchedFiles } from "@/lib/stitch-handoff";
import type { HubClientStatus } from "@/lib/hub/types";
import {
  countUpcomingScheduled,
  nextScheduledPublishAt,
} from "@/lib/hub/schedule-storage";

const IN_FLIGHT_LS_KEY = "v2s:lastJobId";

function readInFlightShort(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(IN_FLIGHT_LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { jobId?: string; startedAt?: number };
    if (!parsed?.jobId) return false;
    const started = Number(parsed.startedAt) || 0;
    const ttl = 60 * 60 * 1000;
    return Date.now() - started < ttl;
  } catch {
    return false;
  }
}

export async function readHubClientStatus(): Promise<HubClientStatus> {
  let clipStitchHandoffReady = false;
  try {
    const peeked = await peekStitchedFiles();
    clipStitchHandoffReady = peeked !== null && peeked.files.length > 0;
  } catch {
    clipStitchHandoffReady = false;
  }

  const shortProcessing = readInFlightShort();
  const nowUnix = Math.floor(Date.now() / 1000);

  return {
    clipStitchHandoffReady,
    shortProcessing,
    shortReady: false,
    postsScheduledUpcoming: countUpcomingScheduled(nowUnix),
    nextPublishAtUnix: nextScheduledPublishAt(nowUnix),
  };
}
