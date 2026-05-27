"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoQueueItem } from "@/context/carousel-workspace-context";
import { queueItemDisplayLabel } from "@/lib/queue-display-label";

type Props = {
  item: VideoQueueItem;
  onSelect: () => void;
  onRename: (id: string, displayLabel: string) => void;
  truncateAt?: number;
  className?: string;
};

export function QueueItemEditableTitle({
  item,
  onSelect,
  onRename,
  truncateAt = 36,
  className = "min-w-0 flex-1 truncate text-left text-sm font-medium text-stone-900 hover:text-palette-depth",
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const display = queueItemDisplayLabel(item);
  const shown =
    display.length > truncateAt
      ? `${display.slice(0, Math.max(0, truncateAt - 1))}…`
      : display;

  const commit = useCallback(() => {
    const next = draft.trim();
    onRename(item.id, next);
    setEditing(false);
  }, [draft, item.id, onRename]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(display);
  }, [display]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className="min-w-0 flex-1 rounded-md border border-palette-teal/50 bg-white px-2 py-0.5 text-sm font-medium text-stone-900 outline-none ring-2 ring-palette-pale/60"
        aria-label="Rename video"
        maxLength={120}
      />
    );
  }

  return (
    <button
      type="button"
      title={`${display} — double-click to rename`}
      onClick={onSelect}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDraft(display);
        setEditing(true);
      }}
      className={className}
    >
      {shown}
    </button>
  );
}
