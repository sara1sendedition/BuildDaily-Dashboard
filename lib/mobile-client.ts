"use client";

import { useEffect, useRef } from "react";

/** True on phones/tablets where Safari/Chrome suspend background tabs aggressively. */
export function isMobileClient(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPod|Android/i.test(ua)) return true;
  // iPadOS 13+ may report as Mac.
  if (/iPad/i.test(ua)) return true;
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
}

type WakeLockSentinel = { release: () => Promise<void> };

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
};

/** Request a screen wake lock; returns a release function (no-op when unsupported). */
export async function requestProcessingWakeLock(): Promise<() => void> {
  try {
    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLock || document.visibilityState === "hidden") {
      return () => undefined;
    }
    const lock = await wakeLock.request("screen");
    return () => {
      void lock.release().catch(() => undefined);
    };
  } catch {
    return () => undefined;
  }
}

/**
 * While `active`, keep the screen awake on mobile during long uploads/processing.
 * Re-acquires after visibility returns (iOS releases wake locks when tab hides).
 */
export function useMobileProcessingWakeLock(active: boolean): void {
  const releaseRef = useRef<(() => void) | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!active || !isMobileClient()) return;

    const generation = ++generationRef.current;
    let cancelled = false;

    const release = () => {
      releaseRef.current?.();
      releaseRef.current = null;
    };

    const acquire = async () => {
      release();
      if (cancelled || document.visibilityState === "hidden") return;
      const releaseLock = await requestProcessingWakeLock();
      // Drop stale locks when visibility flickers or effect re-runs mid-acquire.
      if (cancelled || generationRef.current !== generation) {
        releaseLock();
        return;
      }
      releaseRef.current = releaseLock;
    };

    void acquire();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        void acquire();
      } else if (document.visibilityState === "hidden") {
        release();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      generationRef.current += 1;
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [active]);
}
