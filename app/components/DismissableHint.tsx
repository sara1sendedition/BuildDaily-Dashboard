"use client";

import { useEffect, useState, type ReactNode } from "react";

const STORAGE_PREFIX = "bd-hint-dismissed:";

export function DismissableHint({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(`${STORAGE_PREFIX}${id}`) !== "1") {
        setVisible(true);
      }
    } catch {
      setVisible(true);
    }
  }, [id]);

  if (!visible) return null;

  return (
    <div className={`relative pr-7 ${className ?? ""}`}>
      {children}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          try {
            window.localStorage.setItem(`${STORAGE_PREFIX}${id}`, "1");
          } catch {
            /* ignore quota / private mode */
          }
          setVisible(false);
        }}
        className="absolute right-0 top-0 rounded px-1.5 py-0.5 text-xs font-medium text-stone-400 hover:bg-stone-100 hover:text-stone-700"
      >
        ×
      </button>
    </div>
  );
}
