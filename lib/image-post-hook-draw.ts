/**
 * Build per-canvas-line hook rows: newline-separated paragraphs, each word-wrapped,
 * with an optional color per paragraph (cycles {@link ImageHookOverlayStyle.hookLineFills}).
 */

import type { ImageHookOverlayStyle } from "@/lib/visual-reference-types";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export type HookCanvasLine = { text: string; fill: string };

function wrapLines(
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    const m = ctx.measureText(test);
    if (m.width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines.slice(0, maxLines);
}

/**
 * Split `hook` on newlines, wrap each paragraph, assign fills from `hookLineFills`
 * (cycling) or `defaultFill` when unset.
 */
export function buildHookCanvasLines(
  hook: string,
  ctx: import("@napi-rs/canvas").SKRSContext2D,
  maxWidth: number,
  maxTotalLines: number,
  defaultFill: string,
  style?: ImageHookOverlayStyle | null
): HookCanvasLine[] {
  const fills = style?.hookLineFills?.filter((c) => HEX6.test(c.trim())) ?? [];
  const raw = hook.trim();
  if (!raw) return [];

  const paragraphs = raw
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const blocks = paragraphs.length > 0 ? paragraphs : [raw.replace(/\s+/g, " ").trim()];

  const out: HookCanvasLine[] = [];
  let budget = maxTotalLines;

  for (let pi = 0; pi < blocks.length && budget > 0; pi++) {
    const fill =
      fills.length > 0
        ? fills[pi % fills.length]!.trim()
        : defaultFill;
    const wrapped = wrapLines(ctx, blocks[pi]!, maxWidth, budget);
    budget -= wrapped.length;
    for (const w of wrapped) {
      out.push({ text: w, fill: HEX6.test(fill) ? fill : defaultFill });
    }
  }
  return out;
}
