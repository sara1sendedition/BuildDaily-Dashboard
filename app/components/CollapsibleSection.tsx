"use client";

import { useId, useState, type ReactNode } from "react";

export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const buttonId = useId();

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-50/80">
      <button
        id={buttonId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-stone-900 transition hover:bg-stone-100/90"
      >
        <span>{title}</span>
        <span
          className={`shrink-0 text-stone-500 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        >
          ▼
        </span>
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          className="border-t border-stone-200 bg-white px-4 py-4"
        >
          {children}
        </div>
      )}
    </div>
  );
}
