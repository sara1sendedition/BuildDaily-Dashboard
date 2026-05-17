import type { HubLifetimeMetrics } from "@/lib/hub/types";

const STORAGE_KEY = "builddaily-hub-metrics-v1";

function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function defaultMetrics(): HubLifetimeMetrics {
  return { clipsStitched: 0, videosMultiplied: 0, weekBuckets: {} };
}

export function readHubMetrics(): HubLifetimeMetrics {
  if (typeof window === "undefined") return defaultMetrics();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultMetrics();
    const parsed = JSON.parse(raw) as HubLifetimeMetrics;
    return {
      clipsStitched: Number(parsed.clipsStitched) || 0,
      videosMultiplied: Number(parsed.videosMultiplied) || 0,
      weekBuckets:
        parsed.weekBuckets && typeof parsed.weekBuckets === "object"
          ? parsed.weekBuckets
          : {},
    };
  } catch {
    return defaultMetrics();
  }
}

function writeHubMetrics(metrics: HubLifetimeMetrics): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(metrics));
  } catch {
    /* quota */
  }
}

function bumpWeek(
  metrics: HubLifetimeMetrics,
  field: "clipsStitched" | "videosMultiplied"
): void {
  const key = isoWeekKey();
  if (!metrics.weekBuckets) metrics.weekBuckets = {};
  const bucket = metrics.weekBuckets[key] ?? {
    clipsStitched: 0,
    videosMultiplied: 0,
  };
  bucket[field] = (bucket[field] ?? 0) + 1;
  metrics.weekBuckets[key] = bucket;
}

export function incrementClipsStitched(): void {
  const metrics = readHubMetrics();
  metrics.clipsStitched += 1;
  bumpWeek(metrics, "clipsStitched");
  writeHubMetrics(metrics);
}

export function incrementVideosMultiplied(): void {
  const metrics = readHubMetrics();
  metrics.videosMultiplied += 1;
  bumpWeek(metrics, "videosMultiplied");
  writeHubMetrics(metrics);
}

export function metricsForPeriod(
  metrics: HubLifetimeMetrics,
  period: "week" | "all"
): { clipsStitched: number; videosMultiplied: number } {
  if (period === "all") {
    return {
      clipsStitched: metrics.clipsStitched,
      videosMultiplied: metrics.videosMultiplied,
    };
  }
  const key = isoWeekKey();
  const bucket = metrics.weekBuckets?.[key];
  return {
    clipsStitched: bucket?.clipsStitched ?? 0,
    videosMultiplied: bucket?.videosMultiplied ?? 0,
  };
}
