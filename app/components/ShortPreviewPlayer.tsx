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

type PlayMode = "direct" | "blob";

function isSameOriginApiUrl(raw: string): boolean {
  if (raw.startsWith("/")) return true;
  try {
    const u = new URL(raw, typeof window !== "undefined" ? window.location.href : "https://local");
    if (typeof window !== "undefined" && u.origin === window.location.origin) {
      return u.pathname.includes("/api/");
    }
  } catch {
    /* ignore */
  }
  return raw.includes("/api/media/mp4-faststart") || raw.includes("/api/video-to-short/");
}

/**
 * Vertical Short/Reel preview (9:16).
 *
 * Prefer a same-origin remuxed URL as `<video src>` so iOS Safari can Range-
 * stream it. Fall back to a blob object URL once if direct play fails (some
 * WebViews dislike certain proxied responses). Never dump server logs here.
 */
export function ShortPreviewPlayer({
  url,
  className = "",
  blocked,
  onDurationSec,
  onMediaError,
}: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [mode, setMode] = useState<PlayMode>("direct");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ownedBlobRef = useRef<string | null>(null);
  const triedBlobRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    triedBlobRef.current = false;

    function revokeOwned() {
      if (ownedBlobRef.current) {
        URL.revokeObjectURL(ownedBlobRef.current);
        ownedBlobRef.current = null;
      }
    }

    async function prepare(nextMode: PlayMode) {
      setLoading(true);
      setError(null);
      setMode(nextMode);

      const raw = url.trim();
      if (!raw) {
        setSrc(null);
        setError("No preview URL.");
        setLoading(false);
        onMediaError?.();
        return;
      }

      if (raw.startsWith("blob:")) {
        revokeOwned();
        if (!cancelled) {
          setSrc(raw);
          setLoading(false);
        }
        return;
      }

      if (nextMode === "direct" && isSameOriginApiUrl(raw)) {
        revokeOwned();
        if (!cancelled) {
          // `#t=0.001` nudges iOS to decode a first frame for the poster.
          setSrc(raw.includes("#") ? raw : `${raw}#t=0.001`);
          setLoading(false);
        }
        return;
      }

      // Blob path: full download (used as fallback, or for odd absolute URLs).
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
        const buf = await res.arrayBuffer();
        if (buf.byteLength < 64) {
          throw new Error("Preview file was empty.");
        }
        // Always label as video/mp4 — iOS is picky about blob MIME types.
        const objectUrl = URL.createObjectURL(
          new Blob([buf], { type: "video/mp4" }),
        );
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        revokeOwned();
        ownedBlobRef.current = objectUrl;
        setSrc(objectUrl);
      } catch (e) {
        if (!cancelled) {
          setSrc(null);
          setError(e instanceof Error ? e.message : "Could not load preview.");
          onMediaError?.();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void prepare(
      isSameOriginApiUrl(url.trim()) || url.trim().startsWith("blob:")
        ? "direct"
        : "blob",
    );

    return () => {
      cancelled = true;
      revokeOwned();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  async function handleMediaError() {
    // One automatic fallback: direct → blob.
    if (mode === "direct" && !triedBlobRef.current && !url.trim().startsWith("blob:")) {
      triedBlobRef.current = true;
      setLoading(true);
      setError(null);
      setMode("blob");
      try {
        const res = await fetch(url.trim(), {
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
        const buf = await res.arrayBuffer();
        if (buf.byteLength < 64) throw new Error("Preview file was empty.");
        if (ownedBlobRef.current) URL.revokeObjectURL(ownedBlobRef.current);
        const objectUrl = URL.createObjectURL(
          new Blob([buf], { type: "video/mp4" }),
        );
        ownedBlobRef.current = objectUrl;
        setSrc(objectUrl);
        setLoading(false);
        return;
      } catch (e) {
        setSrc(null);
        setError(e instanceof Error ? e.message : "Could not load preview.");
        setLoading(false);
        onMediaError?.();
        return;
      }
    }
    setError("This device could not play the preview.");
    onMediaError?.();
  }

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
            controlsList="nodownload"
            className="absolute inset-0 h-full w-full object-contain"
            onLoadedData={() => setLoading(false)}
            onLoadedMetadata={(e) => {
              setLoading(false);
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0) onDurationSec?.(d);
            }}
            onError={() => {
              void handleMediaError();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
