"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeHtmlImage,
  makeThumbnailDataUrl,
} from "@/lib/visual-reference-analysis";
import type {
  StoredVisualReference,
  VisualReferenceKind,
  VisualReferenceProfile,
} from "@/lib/visual-reference-types";
import { parseImageHookOverlayFromForm } from "@/lib/image-hook-overlay-form";
import { runReferenceImageOcr } from "@/lib/reference-ocr";
import {
  clearStoredVisualReference,
  getStoredVisualReference,
  setStoredVisualReference,
} from "@/lib/visual-reference-storage";
import { DismissableHint } from "@/app/components/DismissableHint";

const KINDS: {
  id: VisualReferenceKind;
  title: string;
  blurb: string;
}[] = [
  {
    id: "carousel",
    title: "Carousel reference",
    blurb: "Multi-slide look: aspect, palette, and tone inform slide renders and copy tone.",
  },
  {
    id: "photo",
    title: "Photo reference",
    blurb:
      "This sets colors and copy tone. Slide photos still come from your video, not this file.",
  },
  {
    id: "image",
    title: "Image post reference",
    blurb: "Image-only / overlay cards (4:5 or square).",
  },
];

function fmt(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-stone-100 bg-stone-50/80 px-3 py-2 text-sm">
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div className="font-mono text-stone-900">{value}</div>
      {hint ? <p className="mt-1 text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}

function ProfileDetails({ p }: { p: VisualReferenceProfile }) {
  const ct = p.colorTone;
  return (
    <div className="mt-4 space-y-4 text-sm text-stone-700">
      <details open className="rounded-xl border border-stone-200 bg-white p-4">
        <summary className="cursor-pointer font-semibold text-stone-900">
          Color + tone (computed)
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Metric
            label="Mean luma (exposure proxy)"
            value={fmt(ct.exposureMeanLuma01, 3)}
          />
          <Metric
            label="EV offset vs ~18% grey (heuristic)"
            value={fmt(ct.exposureOffsetEvEstimate, 2)}
          />
          <Metric label="Highlights (mean L, bright pixels)" value={fmt(ct.highlightsMeanLuma01, 3)} />
          <Metric label="Shadows (mean L, dark pixels)" value={fmt(ct.shadowsMeanLuma01, 3)} />
          <Metric label="Black point (p1 luma)" value={fmt(ct.blackPointLuma01, 3)} />
          <Metric label="White point (p99 luma)" value={fmt(ct.whitePointLuma01, 3)} />
          <Metric label="Tonal spread (p95−p5)" value={fmt(ct.tonalSpread01, 3)} />
          <Metric label="Luma stdev" value={fmt(ct.lumaStd01, 3)} />
          <Metric
            label="Color temp (K, McCamy xy)"
            value={ct.colorTemperatureKelvin ? `${Math.round(ct.colorTemperatureKelvin)} K` : "—"}
            hint={
              ct.colorTemperatureReliable
                ? "Low scene chroma — estimate more trustworthy."
                : "Strong colors skew xy; treat Kelvin as a loose hint."
            }
          />
          <Metric
            label="Tint (CIELAB a*, green − / magenta +)"
            value={fmt(ct.tintGreenMagentaAstar, 1)}
          />
          <Metric label="Saturation index (chroma proxy)" value={fmt(ct.saturationIndex01, 3)} />
          <Metric
            label="Vibrance vs saturation proxy"
            value={fmt(ct.vibranceVsSaturationProxy, 3)}
            hint="Midtone chroma ÷ overall chroma. Not true vibrance (that needs local masking)."
          />
        </div>
      </details>

      <details className="rounded-xl border border-stone-200 bg-white p-4">
        <summary className="cursor-pointer font-semibold text-stone-900">
          Palette (k-means on sampled pixels)
        </summary>
        <div className="mt-3 flex flex-wrap gap-3">
          {p.palette.swatches.map((s) => (
            <div key={s.hex} className="flex items-center gap-2">
              <span
                className="h-10 w-10 rounded-lg border border-stone-200 shadow-inner"
                style={{ backgroundColor: s.hex }}
                title={s.hex}
              />
              <div>
                <div className="font-mono text-xs text-stone-800">{s.hex}</div>
                <div className="text-xs text-stone-500">
                  {(s.weight * 100).toFixed(0)}% of sample
                </div>
              </div>
            </div>
          ))}
        </div>
      </details>

      <details className="rounded-xl border border-stone-200 bg-white p-4">
        <summary className="cursor-pointer font-semibold text-stone-900">
          Gradient &amp; background guess
        </summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Metric label="Gradient detected" value={p.gradient.detected ? "yes" : "no"} />
          <Metric label="Gradient strength" value={fmt(p.gradient.strength01, 3)} />
          <Metric label="Direction" value={p.gradient.direction} />
          <Metric label="Background type" value={p.background.type} />
          <Metric label="Image style" value={p.background.imageStyle} />
        </div>
      </details>

      <details className="rounded-xl border border-stone-200 bg-white p-4">
        <summary className="cursor-pointer font-semibold text-stone-900">
          Composition &amp; balance (heuristic)
        </summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Metric label="Aspect ratio" value={p.composition.aspectRatio.toFixed(3)} />
          <Metric label="Common label" value={p.composition.aspectRatioLabel} />
          <Metric
            label="Text-region likelihood"
            value={fmt(p.composition.textRegionLikelihood01, 2)}
            hint="Edge density in center vs edges — rough proxy only."
          />
          <Metric
            label="Focal point (norm x,y)"
            value={
              p.composition.focalPointNorm
                ? `${p.composition.focalPointNorm.x.toFixed(2)}, ${p.composition.focalPointNorm.y.toFixed(2)}`
                : "—"
            }
          />
          <Metric label="Balance" value={p.composition.balance} />
        </div>
      </details>

      <details className="rounded-xl border border-stone-200 bg-white p-4">
        <summary className="cursor-pointer font-semibold text-stone-900">
          Technical
        </summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Metric label="Dimensions" value={`${p.technical.widthPx}×${p.technical.heightPx}px`} />
          <Metric label="Megapixels" value={String(p.technical.megapixels)} />
          <Metric
            label="Suggested safe inset"
            value={`${(p.technical.safeAreaInsetFraction * 100).toFixed(0)}% of min edge`}
            hint="For platform chrome (notches, captions)."
          />
          <Metric label="Compression score" value={p.technical.compressionArtifactScore01 != null ? fmt(p.technical.compressionArtifactScore01, 2) : "not computed"} />
        </div>
      </details>

      {p.referenceOcr ? (
        <details open className="rounded-xl border border-stone-200 bg-white p-4">
          <summary className="cursor-pointer font-semibold text-stone-900">
            OCR &amp; layout
          </summary>
          <OcrDetails o={p.referenceOcr} />
        </details>
      ) : null}
    </div>
  );
}

function OcrDetails({ o }: { o: NonNullable<VisualReferenceProfile["referenceOcr"]> }) {
  return (
    <div className="mt-3 space-y-3 text-sm text-stone-700">
      <p className="text-xs text-stone-500">
        Scanned {new Date(o.analyzedAtIso).toLocaleString()} · image{" "}
        {o.imageWidth}×{o.imageHeight}px · mean line confidence{" "}
        {o.meanConfidence.toFixed(0)}%
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Metric
          label="Lines / chars"
          value={`${o.lineLengthStats.lineCount} lines · max ${o.lineLengthStats.maxChars} · median ${o.lineLengthStats.medianChars}`}
        />
        <Metric label="Hook format (guess)" value={o.hookFormatGuess} />
        <Metric
          label="Text margins (norm)"
          value={
            o.marginsNorm
              ? `T ${(o.marginsNorm.top * 100).toFixed(0)}% · L ${(o.marginsNorm.left * 100).toFixed(0)}% · R ${(o.marginsNorm.right * 100).toFixed(0)}% · B ${(o.marginsNorm.bottom * 100).toFixed(0)}%`
              : "—"
          }
          hint="Union of line bounding boxes vs canvas edges."
        />
        <Metric
          label="CTA hints"
          value={[
            o.ctaHints.mentionsCaption && "caption",
            o.ctaHints.mentionsSwipe && "swipe",
            o.ctaHints.mentionsLink && "link",
            o.ctaHints.mentionsSave && "save",
            o.ctaHints.mentionsFollow && "follow",
          ]
            .filter(Boolean)
            .join(", ") || "none detected"}
        />
      </div>
      <div className="rounded-lg border border-stone-100 bg-stone-50/80 p-3">
        <div className="text-xs font-medium text-stone-500">Font engine (Tesseract)</div>
        <p className="mt-1 font-mono text-xs text-stone-800">
          median size: {o.fontFromEngine.medianFontSizePx ?? "—"} px · bold majority:{" "}
          {o.fontFromEngine.boldMajority === null
            ? "—"
            : o.fontFromEngine.boldMajority
              ? "yes"
              : "no"}{" "}
          · serif majority:{" "}
          {o.fontFromEngine.serifMajority === null
            ? "—"
            : o.fontFromEngine.serifMajority
              ? "yes"
              : "no"}
        </p>
        {o.fontFromEngine.engineFontNames.length > 0 ? (
          <p className="mt-1 font-mono text-xs text-stone-700">
            names: {o.fontFromEngine.engineFontNames.join(", ")}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-amber-900/90">{o.fontFromEngine.disclaimer}</p>
      </div>
      <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3 text-xs text-stone-700">
        <p className="font-medium text-stone-800">Not inferred from pixels</p>
        <p className="mt-1">{o.layoutDocumentation.logoPlacement}</p>
        <p className="mt-1">{o.layoutDocumentation.grid}</p>
        <p className="mt-1">{o.layoutDocumentation.strokeShadow}</p>
      </div>
      <details className="rounded-lg border border-stone-200 bg-white p-3">
        <summary className="cursor-pointer text-xs font-semibold text-stone-800">
          Raw OCR lines ({o.lines.length})
        </summary>
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono text-xs text-stone-600">
          {o.lines.map((line, i) => (
            <li key={i}>
              <span className="text-stone-400">{line.confidence.toFixed(0)}%</span>{" "}
              {line.text}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function KindPanel({
  spec,
  stored,
  onSave,
  onClear,
}: {
  spec: (typeof KINDS)[number];
  stored: StoredVisualReference | null;
  onSave: (next: StoredVisualReference) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFileRef = useRef<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState("");
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<StoredVisualReference | null>(stored);
  const [shortNotes, setShortNotes] = useState(stored?.profile.manualNotes ?? "");
  const [longNotes, setLongNotes] = useState(
    stored?.profile.manualExtendedMarkdown ?? ""
  );
  const [hookFillsStr, setHookFillsStr] = useState("");
  const [hookLetterStr, setHookLetterStr] = useState("");
  const [hookOutlineStr, setHookOutlineStr] = useState("1");
  const [hookSublineHex, setHookSublineHex] = useState("");

  useEffect(() => {
    setDraft(stored);
    setShortNotes(stored?.profile.manualNotes ?? "");
    setLongNotes(stored?.profile.manualExtendedMarkdown ?? "");
    if (!stored) lastFileRef.current = null;
  }, [stored]);

  useEffect(() => {
    if (spec.id !== "image") {
      setHookFillsStr("");
      setHookLetterStr("");
      setHookOutlineStr("1");
      setHookSublineHex("");
      return;
    }
    const h = draft?.profile?.imageHookOverlay;
    setHookFillsStr(h?.hookLineFills?.join(", ") ?? "");
    setHookLetterStr(
      h?.letterSpacingEm !== undefined && Number.isFinite(h.letterSpacingEm)
        ? String(h.letterSpacingEm)
        : ""
    );
    setHookOutlineStr(
      h?.hookOutlineScale !== undefined && Number.isFinite(h.hookOutlineScale)
        ? String(h.hookOutlineScale)
        : "1"
    );
    setHookSublineHex(h?.sublineFill ?? "");
  }, [spec.id, draft?.profile?.imageHookOverlay, draft?.fileName]);

  const profile = draft?.profile;

  const runFile = useCallback(
    async (file: File | null) => {
      if (!file || !file.type.startsWith("image/")) {
        setError("Choose an image file (PNG, JPEG, WebP…).");
        return;
      }
      setError(null);
      setBusy(true);
      try {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.decoding = "async";
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Could not decode image"));
          img.src = url;
        });
        const thumb = makeThumbnailDataUrl(img);
        const prevShort = shortNotes;
        const prevLong = longNotes;
        const prevHookOverlay =
          spec.id === "image" ? draft?.profile?.imageHookOverlay : undefined;
        const profileNext = analyzeHtmlImage(img, spec.id, file.name, {
          manualNotes: prevShort,
          manualExtendedMarkdown: prevLong,
        });
        const next: StoredVisualReference = {
          schemaVersion: 1,
          kind: spec.id,
          fileName: file.name,
          thumbnailDataUrl: thumb,
          profile: {
            ...profileNext,
            manualNotes: prevShort,
            manualExtendedMarkdown: prevLong,
            ...(prevHookOverlay ? { imageHookOverlay: prevHookOverlay } : {}),
          },
        };
        lastFileRef.current = file;
        setDraft(next);
        URL.revokeObjectURL(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Analysis failed");
      } finally {
        setBusy(false);
      }
    },
    [spec.id, shortNotes, longNotes, draft?.profile?.imageHookOverlay]
  );

  const reanalyzePreservingNotes = useCallback(async () => {
    if (!draft?.thumbnailDataUrl) return;
    setBusy(true);
    setError(null);
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Could not reload thumbnail"));
        img.src = draft.thumbnailDataUrl!;
      });
      const profileNext = analyzeHtmlImage(img, spec.id, draft.fileName, {
        manualNotes: shortNotes,
        manualExtendedMarkdown: longNotes,
      });
      setDraft({
        ...draft,
        profile: {
          ...profileNext,
          manualNotes: shortNotes,
          manualExtendedMarkdown: longNotes,
          ...(spec.id === "image" && draft.profile.imageHookOverlay
            ? { imageHookOverlay: draft.profile.imageHookOverlay }
            : {}),
          ...(draft.profile.referenceOcr
            ? { referenceOcr: draft.profile.referenceOcr }
            : {}),
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-analyze failed");
    } finally {
      setBusy(false);
    }
  }, [draft, spec.id, shortNotes, longNotes]);

  const runOcrOnReference = useCallback(async () => {
    if (!draft?.thumbnailDataUrl) return;
    setOcrError(null);
    setOcrBusy(true);
    setOcrProgress(0);
    setOcrStatus("Loading OCR engine…");
    try {
      const img = new Image();
      img.decoding = "async";
      img.crossOrigin = "anonymous";
      const file = lastFileRef.current;
      if (file) {
        const url = URL.createObjectURL(file);
        try {
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () =>
              reject(new Error("Could not decode the original file for OCR"));
            img.src = url;
          });
        } finally {
          URL.revokeObjectURL(url);
        }
      } else {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () =>
            reject(
              new Error(
                "Could not decode thumbnail for OCR. Re-upload the image for full-resolution OCR."
              )
            );
          img.src = draft.thumbnailDataUrl!;
        });
      }
      const ocr = await runReferenceImageOcr(img, (frac, status) => {
        setOcrProgress(frac);
        setOcrStatus(status);
      });
      setDraft((d) =>
        d
          ? {
              ...d,
              profile: { ...d.profile, referenceOcr: ocr },
            }
          : null
      );
    } catch (e) {
      setOcrError(e instanceof Error ? e.message : "OCR failed");
    } finally {
      setOcrBusy(false);
      setOcrStatus("");
    }
  }, [draft?.thumbnailDataUrl]);

  const clearOcrFromProfile = useCallback(() => {
    setDraft((d) => {
      if (!d) return null;
      const { referenceOcr: _drop, ...restProfile } = d.profile;
      return { ...d, profile: restProfile as VisualReferenceProfile };
    });
    setOcrError(null);
  }, []);

  const downloadJson = useCallback(() => {
    if (!draft) return;
    const blob = new Blob([JSON.stringify(draft.profile, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `visual-ref-${spec.id}-${draft.fileName.replace(/\W+/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [draft, spec.id]);

  const persistLocal = useCallback(() => {
    if (!draft) return;
    const imageHookOverlay =
      spec.id === "image"
        ? parseImageHookOverlayFromForm(
            hookFillsStr,
            hookLetterStr,
            hookOutlineStr,
            hookSublineHex
          )
        : undefined;
    const merged: StoredVisualReference = {
      ...draft,
      profile: {
        ...draft.profile,
        manualNotes: shortNotes,
        manualExtendedMarkdown: longNotes,
        ...(spec.id === "image" ? { imageHookOverlay } : {}),
      },
    };
    onSave(merged);
  }, [
    draft,
    onSave,
    shortNotes,
    longNotes,
    spec.id,
    hookFillsStr,
    hookLetterStr,
    hookOutlineStr,
    hookSublineHex,
  ]);

  return (
    <section className="rounded-2xl border border-stone-200/80 bg-white/90 p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-stone-900">{spec.title}</h2>
      {spec.id === "photo" ? (
        <DismissableHint id="visual-ref-photo-blurb">
          <p className="mt-1 text-sm text-stone-600">{spec.blurb}</p>
        </DismissableHint>
      ) : (
        <p className="mt-1 text-sm text-stone-600">{spec.blurb}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void runFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-100 disabled:opacity-50"
        >
          {busy ? "Working…" : "Upload & analyze"}
        </button>
        {draft ? (
          <>
            <button
              type="button"
              disabled={busy || !draft.thumbnailDataUrl}
              onClick={() => void reanalyzePreservingNotes()}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50"
            >
              Re-run analysis
            </button>
            <button
              type="button"
              disabled={busy || ocrBusy || !draft.thumbnailDataUrl}
              onClick={() => void runOcrOnReference()}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50"
            >
              {ocrBusy ? "OCR running…" : "OCR & layout"}
            </button>
            {draft.profile.referenceOcr ? (
              <button
                type="button"
                disabled={ocrBusy}
                onClick={clearOcrFromProfile}
                className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-50"
              >
                Clear OCR
              </button>
            ) : null}
            <button
              type="button"
              onClick={downloadJson}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"
            >
              Download JSON
            </button>
            <button
              type="button"
              onClick={persistLocal}
              className="rounded-lg bg-palette-moss px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-palette-depth hover:text-stone-950"
            >
              Save to browser
            </button>
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Remove
            </button>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {ocrError ? (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {ocrError}
        </p>
      ) : null}
      {ocrBusy ? (
        <p className="mt-2 text-xs text-stone-600">
          {ocrStatus ? `${ocrStatus} · ` : ""}
          {Math.round(ocrProgress * 100)}%
        </p>
      ) : null}

      {draft?.thumbnailDataUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL preview from local analysis */}
          <img
            src={draft.thumbnailDataUrl}
            alt=""
            className="mt-4 max-h-48 rounded-lg border border-stone-200 object-contain shadow-sm"
          />
        </>
      ) : null}

      {profile ? (
        <>
          <p className="mt-3 text-xs text-stone-500">
            {profile.fileName} · analyzed {new Date(profile.analyzedAtIso).toLocaleString()}
          </p>
          <label className="mt-4 block text-sm font-medium text-stone-700">
            Short notes
          </label>
          <textarea
            value={shortNotes}
            onChange={(e) => setShortNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
            placeholder="e.g. match this black point on gym walls"
          />
          <label className="mt-3 block text-sm font-medium text-stone-700">
            Extended manual spec (markdown)
          </label>
          <textarea
            value={longNotes}
            onChange={(e) => setLongNotes(e.target.value)}
            rows={8}
            className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 font-mono text-xs leading-relaxed"
            placeholder={`# Typography\n- Font: …\n- Weight: semibold headline / regular body\n…`}
          />
          {spec.id === "image" ? (
            <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50/60 p-4">
              <h3 className="text-sm font-semibold text-stone-900">
                Image post hook (multi-color &amp; tracking)
              </h3>
              <p className="mt-1 text-xs text-stone-600">
                In the Image post editor, put each hook line on its own line (line
                breaks). Colors apply per paragraph line in order; extra canvas lines
                from word-wrap reuse the same color as their paragraph.
              </p>
              <label className="mt-3 block text-xs font-medium text-stone-700">
                Line fills (comma-separated #RRGGBB)
              </label>
              <input
                type="text"
                value={hookFillsStr}
                onChange={(e) => setHookFillsStr(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 font-mono text-sm"
                placeholder="#FFEB3B, #FFFFFF, #FFFFFF"
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700">
                    Letter-spacing (em)
                  </label>
                  <input
                    type="text"
                    value={hookLetterStr}
                    onChange={(e) => setHookLetterStr(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 font-mono text-sm"
                    placeholder="-0.02"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700">
                    Hook outline scale
                  </label>
                  <input
                    type="text"
                    value={hookOutlineStr}
                    onChange={(e) => setHookOutlineStr(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 font-mono text-sm"
                    placeholder="1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700">
                    Subline fill (#RRGGBB)
                  </label>
                  <input
                    type="text"
                    value={hookSublineHex}
                    onChange={(e) => setHookSublineHex(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 font-mono text-sm"
                    placeholder="#FFFFFF"
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-stone-500">
                Click <strong className="font-medium">Save to browser</strong> to
                store. Clear all four fields and save to reset hook styling to
                defaults.
              </p>
            </div>
          ) : null}
          <ProfileDetails p={profile} />
        </>
      ) : (
        <p className="mt-6 text-sm text-stone-500">
          No reference stored yet. Upload a representative still or exported slide.
        </p>
      )}
    </section>
  );
}

export default function VisualReferencesSettingsPage() {
  const [carousel, setCarousel] = useState<StoredVisualReference | null>(null);
  const [photo, setPhoto] = useState<StoredVisualReference | null>(null);
  const [image, setImage] = useState<StoredVisualReference | null>(null);

  useEffect(() => {
    setCarousel(getStoredVisualReference("carousel"));
    setPhoto(getStoredVisualReference("photo"));
    setImage(getStoredVisualReference("image"));
  }, []);

  const byKind = useMemo(
    () => ({
      carousel,
      photo,
      image,
    }),
    [carousel, photo, image]
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 pb-24">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Visual references</h1>
          <p className="mt-1 text-sm text-stone-600">
            Upload a look you like, then save.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/settings"
            className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50"
          >
            ← Settings
          </Link>
          <Link
            href="/multiplier"
            className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-50"
          >
            Carousel
          </Link>
        </div>
      </div>

      <div className="space-y-10">
        {KINDS.map((spec) => (
          <KindPanel
            key={spec.id}
            spec={spec}
            stored={byKind[spec.id]}
            onSave={(next) => {
              setStoredVisualReference(next);
              if (spec.id === "carousel") setCarousel(next);
              if (spec.id === "photo") setPhoto(next);
              if (spec.id === "image") setImage(next);
            }}
            onClear={() => {
              clearStoredVisualReference(spec.id);
              if (spec.id === "carousel") setCarousel(null);
              if (spec.id === "photo") setPhoto(null);
              if (spec.id === "image") setImage(null);
            }}
          />
        ))}
      </div>
    </main>
  );
}
