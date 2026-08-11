"use client";

import { useEffect, useState } from "react";

type Props = {
  url: string;
  className?: string;
  /** When true, dims the player and blocks interaction (e.g. re-process). */
  blocked?: boolean;
  onDurationSec?: (sec: number) => void;
  onMediaError?: () => void;
};

/**
 * Vertical Short/Reel preview. Fetches authenticated/proxy URLs to a blob so
 * iOS Safari gets a playable object URL (avoids edge-gzip + flaky Range on
 * API routes). Layout is locked to 9:16 so a failed/pending load does not
 * look like a wide landscape black box.
 */
export function ShortPreviewPlayer({
  url,
  className = "",
  blocked,
  onDurationSec,
  onMediaError,
}: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    /** Only revoke URLs we created — never parent-owned `blob:` props. */
    let ownsObjectUrl = false;

    async function prepare() {
      setLoading(true);
      setError(null);
      setSrc(null);

      const raw = url.trim();
      if (!raw) {
        setError("No preview URL.");
        setLoading(false);
        onMediaError?.();
        return;
      }

      // Local blobs are already playable — do not re-fetch or revoke.
      if (raw.startsWith("blob:")) {
        if (!cancelled) {
          setSrc(raw);
          setLoading(false);
        }
        return;
      }

      try {
        const res = await fetch(raw, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!res.ok) {
          let detail = `Preview failed (${res.status}).`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j?.error) detail = j.error;
          } catch {
            /* ignore */
          }
          throw new Error(detail);
        }
        const type = (res.headers.get("content-type") || "").toLowerCase();
        if (type.includes("json") || type.includes("text/html")) {
          throw new Error("Preview endpoint returned a non-video response.");
        }
        const blob = await res.blob();
        if (blob.size < 64) {
          throw new Error("Preview file was empty.");
        }
        objectUrl = URL.createObjectURL(
          blob.type.startsWith("video/")
            ? blob
            : new Blob([blob], { type: "video/mp4" }),
        );
        ownsObjectUrl = true;
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          ownsObjectUrl = false;
          return;
        }
        setSrc(objectUrl);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load preview.");
          onMediaError?.();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void prepare();
    return () => {
      cancelled = true;
      if (ownsObjectUrl && objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // Intentionally only re-fetch when `url` changes; callbacks are latest via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return (
    <div
      className={`relative mx-auto w-full max-w-[min(100%,280px)] ${className}`}
    >
      <div
        className={`relative aspect-[9/16] overflow-hidden rounded-xl border border-stone-200 bg-stone-950 shadow-inner ${
          blocked ? "pointer-events-none opacity-60" : ""
        }`}
      >
        {loading ? (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-stone-950/90"
            role="status"
            aria-live="polite"
          >
            <div
              className="h-9 w-9 animate-spin rounded-full border-2 border-stone-600 border-t-palette-moss"
              aria-hidden
            />
            <p className="px-4 text-center text-xs font-medium text-stone-300">
              Preparing vertical preview…
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-stone-950 px-4 py-6">
            <p
              className="max-h-full text-center text-xs leading-relaxed text-amber-100 break-words"
              role="alert"
            >
              {error}
            </p>
          </div>
        ) : null}

        {src && !error ? (
          <video
            key={src}
            src={src}
            controls
            playsInline
            preload="auto"
            className="absolute inset-0 h-full w-full object-contain"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0) onDurationSec?.(d);
              else {
                setError("Could not read video duration.");
                onMediaError?.();
              }
            }}
            onError={() => {
              setError("This device could not play the preview.");
              onMediaError?.();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
