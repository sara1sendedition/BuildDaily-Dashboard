"use client";

import type { FrameColorAdjust } from "@/lib/frame-color-adjust";
import {
  frameColorAdjustFromUiSliders,
  frameColorAdjustToUiSliders,
} from "@/lib/frame-color-adjust";

type FrameColorAdjustSlidersProps = {
  value: FrameColorAdjust;
  onChange: (next: FrameColorAdjust) => void;
  disabled?: boolean;
  /** Prefix for stable input ids (e.g. `carousel` / `image-post`). */
  idPrefix: string;
};

export function FrameColorAdjustSliders({
  value,
  onChange,
  disabled = false,
  idPrefix,
}: FrameColorAdjustSlidersProps) {
  const ui = frameColorAdjustToUiSliders(value);

  const patch = (
    partial: Partial<{
      brightness: number;
      hue: number;
      saturation: number;
      highlights: number;
    }>
  ) => {
    onChange(
      frameColorAdjustFromUiSliders({
        brightness: partial.brightness ?? ui.brightness,
        hue: partial.hue ?? ui.hue,
        saturation: partial.saturation ?? ui.saturation,
        highlights: partial.highlights ?? ui.highlights,
      })
    );
  };

  return (
    <div className="space-y-4 text-sm text-stone-700">
      <p className="text-xs leading-relaxed text-stone-500">
        The preview above updates live (CSS).{" "}
        <strong className="font-medium text-stone-700">Rebuild / Apply</strong>{" "}
        bakes the same settings into the PNG with FFmpeg (can differ slightly).
        Neutral = no change.
      </p>
      <div>
        <label
          htmlFor={`${idPrefix}-brightness`}
          className="flex items-center justify-between gap-2 text-xs font-medium text-stone-600"
        >
          <span>Brightness</span>
          <span className="tabular-nums text-stone-500">{ui.brightness}</span>
        </label>
        <input
          id={`${idPrefix}-brightness`}
          type="range"
          min={-100}
          max={100}
          step={1}
          value={ui.brightness}
          disabled={disabled}
          onChange={(e) =>
            patch({ brightness: Number.parseInt(e.target.value, 10) || 0 })
          }
          className="mt-1.5 w-full accent-palette-moss disabled:opacity-50"
        />
      </div>
      <div>
        <label
          htmlFor={`${idPrefix}-highlights`}
          className="flex items-center justify-between gap-2 text-xs font-medium text-stone-600"
        >
          <span>Highlights</span>
          <span className="tabular-nums text-stone-500">{ui.highlights}</span>
        </label>
        <input
          id={`${idPrefix}-highlights`}
          type="range"
          min={-100}
          max={100}
          step={1}
          value={ui.highlights}
          disabled={disabled}
          onChange={(e) =>
            patch({
              highlights: Number.parseInt(e.target.value, 10) || 0,
            })
          }
          className="mt-1.5 w-full accent-palette-moss disabled:opacity-50"
        />
        <p className="mt-1 text-[11px] leading-snug text-stone-500">
          Bright tones: positive lifts, negative tames clipped whites.
        </p>
      </div>
      <div>
        <label
          htmlFor={`${idPrefix}-hue`}
          className="flex items-center justify-between gap-2 text-xs font-medium text-stone-600"
        >
          <span>Hue</span>
          <span className="tabular-nums text-stone-500">{ui.hue}°</span>
        </label>
        <input
          id={`${idPrefix}-hue`}
          type="range"
          min={-180}
          max={180}
          step={1}
          value={ui.hue}
          disabled={disabled}
          onChange={(e) =>
            patch({ hue: Number.parseInt(e.target.value, 10) || 0 })
          }
          className="mt-1.5 w-full accent-palette-moss disabled:opacity-50"
        />
      </div>
      <div>
        <label
          htmlFor={`${idPrefix}-saturation`}
          className="flex items-center justify-between gap-2 text-xs font-medium text-stone-600"
        >
          <span>Saturation</span>
          <span className="tabular-nums text-stone-500">{ui.saturation}%</span>
        </label>
        <input
          id={`${idPrefix}-saturation`}
          type="range"
          min={0}
          max={200}
          step={1}
          value={ui.saturation}
          disabled={disabled}
          onChange={(e) =>
            patch({
              saturation: Number.parseInt(e.target.value, 10) || 0,
            })
          }
          className="mt-1.5 w-full accent-palette-moss disabled:opacity-50"
        />
      </div>
    </div>
  );
}
