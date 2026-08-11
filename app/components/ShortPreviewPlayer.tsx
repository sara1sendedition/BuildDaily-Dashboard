"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  url: string;
  className?: string;
  /** When true, dims the player and blocks interaction (e.g. re-process). */
  blocked?: boolean;
  onDurationSec?: (sec: number) => void;
  onMediaError?: () => void;
};

/**
 * Vertical Short/Reel preview (9:16).
 *
 * For remux proxy URLs: warm via authenticated `?prepare=1` (waits for ffmpeg),
 * then play a signed cookie-less URL so iOS Safari never hits a Clerk redirect
 * mid-stream (that shows up as native "Load Failed").
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
  const ownedBlobRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    function revokeOwned() {
      if (ownedBlobRef.current) {
        URL.revokeObjectURL(ownedBlobRef.current);
        ownedBlobRef.current = null;
      }
    }

    async function prepare() {
      setLoading(true);
      setError(null);
      setSrc(null);
      revokeOwned();

      const raw = url.trim();
      if (!raw) {
        setError("No preview URL.");
        setLoading(false);
        onMediaError?.();
        return;
      }

      if (raw.startsWith("blob:")) {
        if (!cancelled) {
          setSrc(raw);
          setLoading(false);
        }
        return;
      }

      const isFaststartProxy = raw.includes("/api/media/mp4-faststart");

      try {
        if (isFaststartProxy) {
          // 1) Warm remux with session cookies (may take a while on first play).
          const prepareUrl = raw.includes("prepare=1")
            ? raw
            : `${raw}${raw.includes("?") ? "&" : "?"}prepare=1`;
          const prep = await fetch(prepareUrl, {
            credentials: "same-origin",
            cache: "no-store",
          });
          if (!prep.ok) {
            let detail = `Preview failed (${prep.status}).`;
            try {
              const j = (await prep.json()) as { error?: string };
              if (j?.error) detail = j.error;
            } catch {
              /* ignore */
            }
            throw new Error(detail);
          }
          const body = (await prep.json()) as { playUrl?: string };
          const playUrl = body.playUrl?.trim();
          if (!playUrl) {
            throw new Error("Preview prepare did not return a play URL.");
          }
          if (!cancelled) {
            setSrc(playUrl);
            setLoading(false);
          }
          return;
        }

        // Job-download / other same-origin APIs: fetch to blob (avoids Clerk
        // redirect on <video> and works once bytes are local).
        if (raw.startsWith("/") || raw.includes("/api/")) {
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
          const buf = await res.arrayBuffer();
          if (buf.byteLength < 64) throw new Error("Preview file was empty.");
          const objectUrl = URL.createObjectURL(
            new Blob([buf], { type: "video/mp4" }),
          );
          if (cancelled) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          ownedBlobRef.current = objectUrl;
          setSrc(objectUrl);
          setLoading(false);
          return;
        }

        // Absolute CDN URL (should already be wrapped by caller).
        if (!cancelled) {
          setSrc(raw);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load preview.");
          onMediaError?.();
          setLoading(false);
        }
      }
    }

    void prepare();
    return () => {
      cancelled = true;
      revokeOwned();
    };
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
              className="max-h-full break-words text-center text-xs leading-relaxed text-amber-100"
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
            preload="metadata"
            className="absolute inset-0 h-full w-full object-contain"
            onLoadedData={() => setLoading(false)}
            onLoadedMetadata={(e) => {
              setLoading(false);
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0) onDurationSec?.(d);
            }}
            onError={() => {
              setError(
                "Preview still could not play on this device. Try Download MP4, or re-open this Short after a refresh.",
              );
              onMediaError?.();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
