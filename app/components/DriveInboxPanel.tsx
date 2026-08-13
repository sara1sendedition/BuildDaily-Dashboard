"use client";

import { useCallback, useEffect, useState } from "react";
import { clientApiPath } from "@/lib/client-api-path";

export type DriveInboxFile = {
  id: string;
  name: string;
  size_mb: number | null;
  modified_at: string | null;
  has_thumbnail?: boolean;
};

type Props = {
  onEnqueueFiles: (files: File[]) => void;
  disabled?: boolean;
};

type PanelMode =
  | "loading"
  | "missing-api"
  | "not-configured"
  | "ready"
  | "error";

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(header);
  if (m?.[1]) {
    try {
      return decodeURIComponent(m[1].replace(/"/g, ""));
    } catch {
      return m[1];
    }
  }
  return fallback;
}

async function blobToVideoFile(
  res: Response,
  fallbackName: string
): Promise<File> {
  const blob = await res.blob();
  const name = filenameFromDisposition(
    res.headers.get("content-disposition"),
    fallbackName
  );
  const type = blob.type || "video/mp4";
  return new File([blob], name, { type });
}

function driveThumbnailUrl(fileId: string): string {
  return clientApiPath(
    `/api/video-to-short/drive/inbox/${encodeURIComponent(fileId)}/thumbnail`
  );
}

function DriveInboxThumbnail({ file }: { file: DriveInboxFile }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [file.id, file.has_thumbnail, file.modified_at]);

  const showImage = file.has_thumbnail !== false && !failed;

  return (
    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-stone-200 bg-stone-100">
      {showImage && !loaded ? (
        <div
          className="absolute inset-0 animate-pulse bg-stone-200"
          aria-hidden
        />
      ) : null}
      {showImage ? (
        <img
          src={driveThumbnailUrl(file.id)}
          alt=""
          loading="lazy"
          decoding="async"
          className={`h-full w-full object-cover ${loaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
      {!showImage ? (
        <div
          className="flex h-full w-full items-center justify-center text-stone-400"
          aria-hidden
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m15 10 4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2Z"
            />
          </svg>
        </div>
      ) : null}
    </div>
  );
}

export function DriveInboxPanel({ onEnqueueFiles, disabled }: Props) {
  const [mode, setMode] = useState<PanelMode>("loading");
  const [files, setFiles] = useState<DriveInboxFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    setError(null);
    let healthConfigured = false;
    try {
      const health = await fetch(clientApiPath("/api/video-to-short/health"), {
        cache: "no-store",
      });
      if (health.status === 404) {
        setMode("missing-api");
        setFiles([]);
        return;
      }
      if (health.ok) {
        const h = (await health.json()) as { drive_inbox_configured?: boolean };
        healthConfigured = Boolean(h.drive_inbox_configured);
      }

      const r = await fetch(clientApiPath("/api/video-to-short/drive/inbox"), {
        cache: "no-store",
      });
      if (r.status === 404) {
        setMode("missing-api");
        setFiles([]);
        return;
      }
      if (!r.ok) {
        const text = await r.text();
        setMode(healthConfigured ? "error" : "not-configured");
        setError(`Drive inbox: ${text}`);
        setFiles([]);
        return;
      }
      const data = (await r.json()) as {
        configured?: boolean;
        files?: DriveInboxFile[];
      };
      const inboxConfigured = Boolean(data.configured);
      const ready = inboxConfigured || healthConfigured;
      setMode(ready ? "ready" : "not-configured");
      setFiles(data.files ?? []);
      if (ready && !inboxConfigured && healthConfigured) {
        setError("Drive is configured but the inbox list came back empty.");
      }
    } catch {
      setMode("error");
      setError("Could not load Google Drive inbox");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Only hit Drive when expanded — keeps collapsed default cheap.
    if (!collapsed) void loadInbox();
  }, [collapsed, loadInbox]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const addOneToQueue = async (f: DriveInboxFile) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(
        clientApiPath(
          `/api/video-to-short/drive/inbox/${encodeURIComponent(f.id)}/download`
        ),
        { cache: "no-store" }
      );
      if (!r.ok) {
        setError(await r.text());
        return;
      }
      const file = await blobToVideoFile(r, f.name);
      onEnqueueFiles([file]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Drive download failed");
    } finally {
      setBusy(false);
    }
  };

  const stitchSelectedToQueue = async () => {
    if (selectedIds.length < 2) {
      setError("Select at least 2 clips to stitch");
      return;
    }
    setBusy(true);
    setError(null);
    const fd = new FormData();
    for (const id of selectedIds) fd.append("file_ids", id);
    try {
      const r = await fetch(clientApiPath("/api/video-to-short/drive/stitch-raw"), {
        method: "POST",
        body: fd,
      });
      if (!r.ok) {
        setError(await r.text());
        return;
      }
      const file = await blobToVideoFile(r, "drive_stitch.mp4");
      onEnqueueFiles([file]);
      setSelectedIds([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Drive stitch failed");
    } finally {
      setBusy(false);
    }
  };

  const fileCountLabel =
    mode === "ready" && files.length > 0 ? ` (${files.length})` : "";

  return (
    <div className="rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4 text-left shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex min-w-0 items-center gap-2 text-left"
          aria-expanded={!collapsed}
        >
          <span
            className="shrink-0 text-stone-400 transition-transform duration-200"
            style={{ transform: collapsed ? undefined : "rotate(90deg)" }}
            aria-hidden
          >
            ▸
          </span>
          <h3 className="text-sm font-semibold text-stone-900">
            Google Drive inbox{fileCountLabel}
          </h3>
        </button>
        {!collapsed ? (
          <button
            type="button"
            onClick={() => void loadInbox()}
            disabled={loading || busy || disabled}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
      </div>

      {!collapsed && mode === "loading" ? (
        <p className="mt-2 text-xs text-stone-500">Checking Drive inbox…</p>
      ) : null}

      {!collapsed && mode === "missing-api" ? (
        <p className="mt-2 text-xs text-amber-800">
          Drive import isn’t available yet.
        </p>
      ) : null}

      {!collapsed && mode === "not-configured" ? (
        <p className="mt-2 text-xs text-stone-600">
          Drive is not connected yet.
        </p>
      ) : null}

      {!collapsed && mode === "ready" ? (
        <>
          {error ? (
            <p className="mt-2 text-xs text-red-700 whitespace-pre-wrap">{error}</p>
          ) : null}
          {selectedIds.length >= 2 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2">
              <span className="text-xs text-stone-600">
                {selectedIds.length} clips selected
              </span>
              <button
                type="button"
                disabled={busy || disabled}
                onClick={() => void stitchSelectedToQueue()}
                className="rounded-lg bg-palette-moss px-3 py-1.5 text-xs font-semibold text-white hover:bg-palette-depth disabled:opacity-50"
              >
                {busy ? "Stitching…" : "Stitch & add to queue"}
              </button>
            </div>
          ) : null}
          {files.length === 0 ? (
            <p className="mt-3 text-xs text-stone-500">No videos in the inbox yet.</p>
          ) : (
            <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
              {files.map((f) => {
                const idx = selectedIds.indexOf(f.id);
                const selected = idx >= 0;
                return (
                  <li
                    key={f.id}
                    className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-xs ${
                      selected
                        ? "border-palette-teal bg-palette-pale/20"
                        : "border-stone-200 bg-white"
                    }`}
                  >
                    <label className="flex shrink-0 items-center gap-1">
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={busy || disabled}
                        onChange={() => toggleSelect(f.id)}
                      />
                      {selected ? (
                        <span className="font-bold text-palette-depth">{idx + 1}</span>
                      ) : null}
                    </label>
                    <DriveInboxThumbnail file={f} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-stone-900">{f.name}</p>
                      <p className="text-stone-500">
                        {f.size_mb != null ? `${f.size_mb} MB` : "Unknown size"}
                        {f.modified_at
                          ? ` · ${new Date(f.modified_at).toLocaleString()}`
                          : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy || disabled}
                      onClick={() => void addOneToQueue(f)}
                      className="shrink-0 rounded-lg bg-palette-moss px-2 py-1 font-semibold text-white hover:bg-palette-depth disabled:opacity-50"
                    >
                      Add
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}

      {!collapsed && mode === "error" && error ? (
        <p className="mt-2 text-xs text-red-700 whitespace-pre-wrap">{error}</p>
      ) : null}
    </div>
  );
}
