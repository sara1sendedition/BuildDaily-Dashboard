"use client";

import { useEffect, useRef } from "react";
import { useCarouselWorkspace } from "@/context/carousel-workspace-context";
import { useScheduleStore } from "@/context/schedule-context";

/**
 * When Bunny uploads finish on the home queue, copy URLs onto any calendar
 * rows for that queue item so publish-due can fetch them from the Hub.
 */
export function SyncScheduleBunnyFromQueue() {
  const { queueSnapshots } = useCarouselWorkspace();
  const { syncBunnyUrlsForQueueItem } = useScheduleStore();
  const lastSyncedRef = useRef<Record<string, string>>({});

  useEffect(() => {
    for (const [queueItemId, snap] of Object.entries(queueSnapshots)) {
      const urls = snap.bunnyUrls;
      if (!urls) continue;
      const fingerprint = JSON.stringify(urls);
      if (lastSyncedRef.current[queueItemId] === fingerprint) continue;
      lastSyncedRef.current[queueItemId] = fingerprint;
      syncBunnyUrlsForQueueItem(queueItemId, urls);
    }
  }, [queueSnapshots, syncBunnyUrlsForQueueItem]);

  return null;
}
