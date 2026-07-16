/** Remembers which tool last started a Short, for hub Continue links. */

const LS_KEY = "v2s:sourceTool";

export type ShortSourceTool = "video-editor" | "multiplier";

export function setShortSourceTool(tool: ShortSourceTool): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, tool);
  } catch {
    /* ignore */
  }
}

export function getShortSourceTool(): ShortSourceTool | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(LS_KEY);
    if (v === "video-editor" || v === "multiplier") return v;
    return null;
  } catch {
    return null;
  }
}
