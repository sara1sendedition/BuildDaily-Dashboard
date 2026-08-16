"use client";

import { useCallback, useEffect, useState } from "react";
import { clientApiPath } from "@/lib/client-api-path";
import type { DriveInboxFile } from "@/app/components/DriveInboxPanel";
import { MAX_STITCH_AUTO_GROUP_FILES } from "@/lib/stitch-group-plan";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Selected inbox videos in checkbox order (not downloaded until Process). */
  onAddClips?: (files: DriveInboxFile[]) => boolean;
  /**
   * When set, the picker can transcribe the selection and fill stitch rows
   * (stitch vs solo) instead of appending to a single row.
   */
  onAutoGroup?: (files: DriveInboxFile[]) => void;
  variant?: "queue" | "auto-group";
  disabled?: boolean;
};

type PanelMode =
  | "loading"
  | "missing-api"
  | "not-configured"
  | "ready"
  | "error";

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
          ▶
        </div>
      ) : null}
    </div>
  );
}

export function DriveClipPickerModal({
  open,
  onClose,
  onAddClips,
  onAutoGroup,
  variant = "queue",
  disabled,
}: Props) {
  const autoGroupMode = variant === "auto-group";
  const [mode, setMode] = useState<PanelMode>("loading");
  const [files, setFiles] = useState<DriveInboxFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadInbox = useCallback(async (isCancelled?: () => boolean) => {
    setLoading(true);
    setError(null);
    let healthConfigured = false;
    try {
      const health = await fetch(clientApiPath("/api/video-to-short/health"), {
        cache: "no-store",
      });
      if (health.status === 404) {
        if (!isCancelled?.()) {
          setMode("missing-api");
          setFiles([]);
        }
        return;
      }
      if (health.ok) {
        const h = (await health.json()) as { drive_inbox_configured?: boolean };
        healthConfigured = Boolean(h.drive_inbox_configured);
      }

      if (isCancelled?.()) return;

      const r = await fetch(clientApiPath("/api/video-to-short/drive/inbox"), {
        cache: "no-store",
      });
      if (r.status === 404) {
        if (!isCancelled?.()) {
          setMode("missing-api");
          setFiles([]);
        }
        return;
      }
      if (!r.ok) {
        const text = await r.text();
        if (!isCancelled?.()) {
          setMode(healthConfigured ? "error" : "not-configured");
          setError(`Drive inbox: ${text}`);
          setFiles([]);
        }
        return;
      }
      const data = (await r.json()) as {
        configured?: boolean;
        files?: DriveInboxFile[];
      };
      if (isCancelled?.()) return;
      const inboxConfigured = Boolean(data.configured);
      const ready = inboxConfigured || healthConfigured;
      setMode(ready ? "ready" : "not-configured");
      setFiles(data.files ?? []);
    } catch {
      if (!isCancelled?.()) {
        setMode("error");
        setError("Could not load Google Drive inbox");
        setFiles([]);
      }
    } finally {
      if (!isCancelled?.()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setSelectedIds([]);
      setError(null);
      setMode("loading");
      setFiles([]);
      return;
    }
    let cancelled = false;
    void loadInbox(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [open, loadInbox]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const pickedInOrder = (): DriveInboxFile[] | null => {
    if (selectedIds.length < 1) {
      setError("Select at least one video");
      return null;
    }
    const picked = selectedIds
      .map((id) => files.find((f) => f.id === id))
      .filter((f): f is DriveInboxFile => Boolean(f));
    if (picked.length !== selectedIds.length) {
      setError(
        "Some selected videos are no longer in the inbox. Refresh and try again."
      );
      return null;
    }
    setError(null);
    return picked;
  };

  const addSelectedClips = () => {
    const picked = pickedInOrder();
    if (!picked || !onAddClips) return;
    if (onAddClips(picked)) onClose();
  };

  const autoGroupSelected = () => {
    const picked = pickedInOrder();
    if (!picked || !onAutoGroup) return;
    if (picked.length > MAX_STITCH_AUTO_GROUP_FILES) {
      setError(
        `Auto-group supports up to ${MAX_STITCH_AUTO_GROUP_FILES} videos. Deselect some first.`
      );
      return;
    }
    onAutoGroup(picked);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drive-clip-picker-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-stone-900/50"
        aria-label="Close Google Drive picker"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[min(88vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
          <h2
            id="drive-clip-picker-title"
            className="text-base font-semibold text-stone-900"
          >
            {autoGroupMode ? "Auto-group from Google Drive" : "Google Drive"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm font-medium text-stone-600 hover:bg-stone-100"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <p className="rounded-lg border border-palette-teal/40 bg-palette-pale/25 px-3 py-2 text-xs text-stone-800">
            {autoGroupMode ? (
              <>
                <strong>Transcripts stay on the server.</strong> Select the
                batch (Select all is fine). They are transcribed, then grouped
                into stitch vs solo rows. Idle rows on this page are replaced.
                Up to {MAX_STITCH_AUTO_GROUP_FILES} videos per run.
              </>
            ) : (
              <>
                <strong>No download happens here.</strong> Selected videos are
                only queued on the Stitch page. They download when you click{" "}
                <strong>Process … → home</strong> at the bottom of that page.
              </>
            )}
          </p>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadInbox()}
                disabled={loading || disabled}
                className="rounded-lg border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
              >
                {loading ? "Refreshing…" : "Refresh"}
              </button>
              {mode === "ready" && files.length > 0 ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    setSelectedIds((prev) =>
                      prev.length === files.length ? [] : files.map((f) => f.id)
                    )
                  }
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                >
                  {selectedIds.length === files.length ? "Clear all" : "Select all"}
                </button>
              ) : null}
            </div>
            {selectedIds.length > 0 ? (
              <span className="text-xs text-stone-600">
                {selectedIds.length} selected
              </span>
            ) : null}
          </div>

          {mode === "loading" ? (
            <p className="mt-3 text-xs text-stone-500">Loading inbox…</p>
          ) : null}

          {mode === "missing-api" ? (
            <p className="mt-3 text-xs text-amber-800">
              Drive import isn’t available yet.
            </p>
          ) : null}

          {mode === "not-configured" ? (
            <p className="mt-3 text-xs text-stone-600">
              Drive is not connected yet.
            </p>
          ) : null}

          {error ? (
            <p className="mt-3 whitespace-pre-wrap text-xs text-red-700">{error}</p>
          ) : null}

          {mode === "ready" ? (
            files.length === 0 ? (
              <p className="mt-3 text-xs text-stone-500">No videos in the inbox yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {files.map((f) => {
                  const idx = selectedIds.indexOf(f.id);
                  const selected = idx >= 0;
                  return (
                    <li
                      key={f.id}
                      className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-xs ${
                        selected
                          ? "border-palette-teal bg-palette-pale/20"
                          : "border-stone-200 bg-stone-50"
                      }`}
                    >
                      <label className="flex shrink-0 cursor-pointer items-center gap-1">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={disabled}
                          onChange={() => toggleSelect(f.id)}
                        />
                        {selected ? (
                          <span className="font-bold text-palette-depth">
                            {idx + 1}
                          </span>
                        ) : null}
                      </label>
                      <DriveInboxThumbnail file={f} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-stone-900">
                          {f.name}
                        </p>
                        <p className="text-stone-500">
                          {f.size_mb != null ? `${f.size_mb} MB` : "Unknown size"}
                          {f.modified_at
                            ? ` · ${new Date(f.modified_at).toLocaleString()}`
                            : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          ) : null}

          {mode === "error" && !files.length && error ? (
            <p className="mt-3 whitespace-pre-wrap text-xs text-red-700">{error}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-stone-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={disabled || mode !== "ready" || selectedIds.length < 1}
            onClick={autoGroupMode ? autoGroupSelected : addSelectedClips}
            className="rounded-lg bg-palette-moss px-4 py-1.5 text-xs font-semibold text-white hover:bg-palette-depth disabled:opacity-50"
          >
            {autoGroupMode
              ? selectedIds.length < 1
                ? "Transcribe & group"
                : `Transcribe & group ${selectedIds.length}`
              : selectedIds.length < 1
                ? "Queue clips"
                : `Queue ${selectedIds.length} clip${selectedIds.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
