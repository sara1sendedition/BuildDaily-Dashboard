"use client";

import { useEffect, useState } from "react";
import { isMobileClient } from "@/lib/mobile-client";

type Props = {
  url: string;
  className?: string;
  /** When true, dims the player and blocks interaction (e.g. re-process). */
  blocked?: boolean;
  onDurationSec?: (sec: number) => void;
  onMediaError?: () => void;
};

/** If this is our remux proxy, return the original Bunny CDN URL from `?url=`. */
function unwrapFaststartSourceUrl(raw: string): string | null {
  if (!raw.includes("/api/media/mp4-faststart")) return null;
  try {
    const u = new URL(raw, typeof window !== "undefined" ? window.location.href : "https://local");
    const source = u.searchParams.get("url")?.trim() ?? "";
    return source || null;
  } catch {
    return null;
  }
}

/**
 * Vertical Short/Reel preview (9:16).
 *
 * Desktop: play Bunny CDN (or unwrap a leftover proxy URL) — no encode/download.
 * Phone: warm encode via prepare=1, then stream the signed URL (no full-file
 * blob download — that was hanging for minutes on large reels).
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
  const [status, setStatus] = useState("Loading preview…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function prepare() {
      setLoading(true);
      setError(null);
      setSrc(null);
      setStatus("Loading preview…");

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
      const bunnySource = unwrapFaststartSourceUrl(raw);
      const onPhone = isMobileClient();

      // Desktop (or tablet that isn't phone Safari): never hit the remux/download
      // path. Unwrap proxy URLs left over from before this split.
      if (!onPhone) {
        const direct = bunnySource || raw;
        if (!cancelled) {
          setSrc(direct);
          setLoading(false);
        }
        return;
      }

      try {
        if (!isFaststartProxy) {
          if (!cancelled) {
            setSrc(raw);
            setLoading(false);
          }
          return;
        }

        setStatus("Encoding a phone-friendly preview…");
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
        const signed = body.playUrl?.trim();
        if (!signed) {
          throw new Error("Preview prepare did not return a play URL.");
        }
        // Stream the warmed file — do not download the entire MP4 into a blob
        // (that was the multi-minute "Downloading preview…" hang).
        if (!cancelled) {
          setSrc(signed);
          setLoading(false);
        }
      } catch (e) {
        // Last resort on phone: try the original Bunny URL so the user isn't stuck.
        if (!cancelled && bunnySource) {
          setError(null);
          setSrc(bunnySource);
          setLoading(false);
          return;
        }
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
              {status}
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
                "Could not play this preview. Try Download MP4, or re-open after a refresh.",
              );
              onMediaError?.();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
