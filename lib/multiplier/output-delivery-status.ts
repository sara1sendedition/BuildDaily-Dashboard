import type {
  QueueCarouselSnapshot,
  VideoQueueItem,
} from "@/context/carousel-workspace-context";
import type { ScheduledCarouselPost } from "@/context/schedule-context";
import {
  pickSlidePreviewPngsForCalendar,
  type ScheduleContentKind,
} from "@/lib/schedule/calendar-preview-thumbs";
import type { DaemonPublishRowStatus } from "@/lib/schedule/daemon-client";

export type OutputDeliveryKind = ScheduleContentKind;

export type OutputDeliveryPhase = "done" | "scheduled" | "published";

export type OutputKindDeliveryStatus = {
  kind: OutputDeliveryKind;
  exists: boolean;
  phase: OutputDeliveryPhase | null;
  partialPublish: boolean;
  /** Unix seconds — publish time when published, else scheduled time. */
  atUnix?: number;
};

export type AggregateOutputDeliveryStatus = {
  label: "Done" | "Scheduled" | "Published";
  partial: boolean;
  title: string;
};

export type OutputStatusDisplay = {
  text: string;
  dateText?: string;
  title: string;
  tone: "done" | "scheduled" | "published" | "edited";
};

/** Stable fingerprint of studio copy/assets used for calendar “Edited” badges. */
export function studioContentFingerprint(
  item: Pick<VideoQueueItem, "shortOutputRevision">,
  snap: QueueCarouselSnapshot | null
): string {
  const slides =
    snap?.editableSlides?.map((s) => ({
      h: (s.headline ?? "").trim(),
      b: (s.body ?? "").trim(),
    })) ?? [];
  const imagePost = snap?.imagePost
    ? {
        hook: snap.imagePost.hook.trim(),
        microCta: snap.imagePost.microCta.trim(),
        caption: snap.imagePost.caption.trim(),
      }
    : null;
  return JSON.stringify({
    slides,
    socialCaption: (snap?.socialCaption ?? "").trim(),
    imagePost,
    shortOutputRevision: item.shortOutputRevision ?? 0,
    frameColorAdjust: snap?.frameColorAdjust ?? null,
  });
}

function scheduleItemKind(it: ScheduledCarouselPost): OutputDeliveryKind {
  const k = it.scheduleKind;
  if (k === "photo" || k === "short") return k;
  return "carousel";
}

function isPartialPublishError(error: string | undefined): boolean {
  return Boolean(error?.includes("Partially published"));
}

export function outputKindExists(
  kind: OutputDeliveryKind,
  snap: QueueCarouselSnapshot | null,
  item: Pick<VideoQueueItem, "shortOutputFile" | "shortJobId">
): boolean {
  if (kind === "carousel") {
    if (
      Boolean(snap?.zipBase64) &&
      pickSlidePreviewPngsForCalendar(snap, true, true).length > 0
    ) {
      return true;
    }
    const slides = snap?.bunnyUrls?.slideUrls ?? [];
    const slidesIg = snap?.bunnyUrls?.slideUrlsInstagram ?? [];
    return slides.length > 0 || slidesIg.length > 0;
  }
  if (kind === "photo") {
    return (
      Boolean(snap?.imagePost?.imageBase64?.length) ||
      Boolean(snap?.bunnyUrls?.imagePostUrl?.trim())
    );
  }
  return Boolean(
    item.shortOutputFile ||
      item.shortJobId ||
      snap?.bunnyUrls?.reelMp4Url?.trim(),
  );
}

export function deliveryStatusesForQueueItem(
  queueItemId: string,
  snap: QueueCarouselSnapshot | null,
  item: VideoQueueItem,
  scheduleItems: ScheduledCarouselPost[],
  daemonById: Map<string, DaemonPublishRowStatus>
): OutputKindDeliveryStatus[] {
  const kinds: OutputDeliveryKind[] = ["carousel", "photo", "short"];
  const entries = scheduleItems.filter((it) => it.queueItemId === queueItemId);

  return kinds.map((kind) => {
    const exists = outputKindExists(kind, snap, item);
    if (!exists) {
      return { kind, exists: false, phase: null, partialPublish: false };
    }

    const kindEntries = entries.filter((it) => scheduleItemKind(it) === kind);
    if (kindEntries.length === 0) {
      return { kind, exists: true, phase: "done", partialPublish: false };
    }

    let anyPublished = false;
    let anyScheduled = false;
    let anyPartial = false;
    let bestPublishedAt: number | undefined;
    let bestScheduledAt: number | undefined;

    for (const entry of kindEntries) {
      const row = daemonById.get(entry.id);
      if (row?.daemonPublishedAt != null && row.daemonPublishedAt > 0) {
        anyPublished = true;
        anyPartial =
          anyPartial || isPartialPublishError(row.daemonLastError);
        if (
          bestPublishedAt == null ||
          row.daemonPublishedAt < bestPublishedAt
        ) {
          bestPublishedAt = row.daemonPublishedAt;
        }
        continue;
      }
      anyScheduled = true;
      if (
        bestScheduledAt == null ||
        entry.publishAtUnix < bestScheduledAt
      ) {
        bestScheduledAt = entry.publishAtUnix;
      }
    }

    if (anyPublished && !anyScheduled) {
      return {
        kind,
        exists: true,
        phase: "published",
        partialPublish: anyPartial,
        atUnix: bestPublishedAt,
      };
    }
    if (anyPublished && anyScheduled) {
      // Some platforms/slots published, others still on the calendar.
      return {
        kind,
        exists: true,
        phase: "published",
        partialPublish: true,
        atUnix: bestPublishedAt,
      };
    }
    return {
      kind,
      exists: true,
      phase: "scheduled",
      partialPublish: false,
      atUnix: bestScheduledAt,
    };
  });
}

export function aggregateDeliveryStatus(
  statuses: OutputKindDeliveryStatus[]
): AggregateOutputDeliveryStatus | null {
  const existing = statuses.filter((s) => s.exists);
  if (existing.length === 0) return null;

  const published = existing.filter((s) => s.phase === "published");
  const scheduled = existing.filter((s) => s.phase === "scheduled");
  const anyPartial = published.some((s) => s.partialPublish);

  if (published.length === existing.length) {
    return {
      label: "Published",
      partial: anyPartial,
      title: anyPartial
        ? "All outputs published; at least one was only partially published to every destination."
        : "All generated outputs have been published.",
    };
  }

  if (published.length > 0) {
    return {
      label: "Published",
      partial: true,
      title: `${published.length} of ${existing.length} outputs published. Open each tab for details.`,
    };
  }

  if (scheduled.length > 0) {
    return {
      label: "Scheduled",
      partial: scheduled.length < existing.length,
      title:
        scheduled.length < existing.length
          ? `${scheduled.length} of ${existing.length} outputs are on the calendar.`
          : "All generated outputs are scheduled on the calendar.",
    };
  }

  return {
    label: "Done",
    partial: false,
    title: "Generated — not scheduled or published yet.",
  };
}

function formatStatusDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function phaseLabel(
  phase: OutputDeliveryPhase,
  partialPublish: boolean
): string {
  if (phase === "done") return "Done";
  if (phase === "scheduled") return "Scheduled";
  return partialPublish ? "Published*" : "Published";
}

export function displayForKindDelivery(
  status: OutputKindDeliveryStatus | null | undefined
): OutputStatusDisplay | null {
  if (!status?.exists || !status.phase) return null;

  const text = phaseLabel(status.phase, status.partialPublish);
  const dateText =
    status.phase !== "done" && status.atUnix
      ? formatStatusDate(status.atUnix)
      : undefined;

  let title = text;
  if (status.phase === "scheduled" && status.atUnix) {
    title = `Scheduled for ${formatStatusDate(status.atUnix)}`;
  } else if (status.phase === "published" && status.atUnix) {
    title = status.partialPublish
      ? `Partially published ${formatStatusDate(status.atUnix)}`
      : `Published ${formatStatusDate(status.atUnix)}`;
  } else if (status.phase === "done") {
    title = "Generated — not scheduled or published yet.";
  }

  return {
    text,
    dateText,
    title,
    tone: status.phase,
  };
}

export function displayForAggregateDelivery(
  status: AggregateOutputDeliveryStatus | null | undefined
): OutputStatusDisplay | null {
  if (!status) return null;
  return {
    text: status.partial ? `${status.label}*` : status.label,
    title: status.title,
    tone:
      status.label === "Published"
        ? "published"
        : status.label === "Scheduled"
          ? "scheduled"
          : "done",
  };
}

export function kindForStudioTab(
  tab: "carousel" | "image" | "short"
): OutputDeliveryKind {
  if (tab === "image") return "photo";
  return tab;
}

/**
 * Calendar “Ready to schedule” sidebar — show Scheduled/Published like Multiplier,
 * plus Edited when studio outputs changed since first generation. Hide the
 * Multiplier “Done” (generated-only) badge.
 */
export function displayForReadyToScheduleCard(
  queueItemId: string,
  snap: QueueCarouselSnapshot | null,
  item: VideoQueueItem,
  scheduleItems: ScheduledCarouselPost[],
  daemonById: Map<string, DaemonPublishRowStatus> | undefined
): OutputStatusDisplay | null {
  const statuses = deliveryStatusesForQueueItem(
    queueItemId,
    snap,
    item,
    scheduleItems,
    daemonById ?? new Map()
  );
  const aggregate = aggregateDeliveryStatus(statuses);
  if (aggregate && aggregate.label !== "Done") {
    return displayForAggregateDelivery(aggregate);
  }

  const baseline = item.studioContentBaseline;
  if (
    baseline &&
    studioContentFingerprint(item, snap) !== baseline
  ) {
    return {
      text: "Edited",
      title:
        "Outputs were changed in Multiplier since this video first finished processing.",
      tone: "edited",
    };
  }

  return null;
}
