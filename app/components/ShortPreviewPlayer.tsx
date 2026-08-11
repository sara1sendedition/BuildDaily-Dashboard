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

function looksLikeMp4(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 12) return false;
  const bytes = new Uint8Array(buf, 0, Math.min(64, buf.byteLength));
  // ISO BMFF: size(4) + 'ftyp' at offset 4
  const tag = String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!);
  return tag === "ftyp";
}

/**
 * Vertical Short/Reel preview (9:16).
 *
 * Warm remux with `prepare=1`, download the signed MP4 into a blob, then play
 * locally. iPhone Safari is unreliable with Range-streamed API `<video src>`
 * even when the bytes are fine — blobs avoid that class of failure.
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
  const [status, setStatus] = useState("Preparing vertical preview…");
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

    async function loadAsBlob(playUrl: string): Promise<string> {
      const res = await fetch(playUrl, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        let detail = `Preview download failed (${res.status}).`;
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
      if (!looksLikeMp4(buf)) {
        throw new Error(
          "Preview bytes were not a valid MP4 (server may have returned an error page).",
        );
      }
      return URL.createObjectURL(new Blob([buf], { type: "video/mp4" }));
    }

    async function prepare() {
      setLoading(true);
      setError(null);
      setSrc(null);
      setStatus("Preparing vertical preview…");
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
        let playUrl = raw;

        if (isFaststartProxy) {
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
          playUrl = signed;
        }

        if (
          playUrl.startsWith("/") ||
          playUrl.includes("/api/") ||
          isFaststartProxy
        ) {
          setStatus("Downloading preview…");
          const objectUrl = await loadAsBlob(playUrl);
          if (cancelled) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          ownedBlobRef.current = objectUrl;
          setSrc(objectUrl);
          setLoading(false);
          return;
        }

        if (!cancelled) {
          setSrc(playUrl);
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
            preload="auto"
            className="absolute inset-0 h-full w-full object-contain"
            onLoadedData={() => setLoading(false)}
            onLoadedMetadata={(e) => {
              setLoading(false);
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0) onDurationSec?.(d);
            }}
            onError={() => {
              setError(
                "Phone still rejected the preview file after re-encode. Use Download MP4 for now.",
              );
              onMediaError?.();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
