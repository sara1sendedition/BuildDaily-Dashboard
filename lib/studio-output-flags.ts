/** Flip to `true` to restore X/Threads in Output formats and the studio tab. */
export const X_THREADS_OUTPUT_ENABLED = false;

export type StudioOutputXPostToggle = { xPost: boolean };

/** Per-run toggles for which deliverables to generate after upload or on “Regenerate”. */
export type StudioOutputToggles = {
  carousel: boolean;
  imagePost: boolean;
  xPost: boolean;
  reelShort: boolean;
};

export const DEFAULT_STUDIO_OUTPUTS: StudioOutputToggles = {
  carousel: true,
  imagePost: true,
  xPost: X_THREADS_OUTPUT_ENABLED,
  reelShort: true,
};

/** Video Editor: Reel/Short only — no carousel, image post, or X. */
export const SHORT_ONLY_STUDIO_OUTPUTS: StudioOutputToggles = {
  carousel: false,
  imagePost: false,
  xPost: false,
  reelShort: true,
};

/** Forces `xPost` off while {@link X_THREADS_OUTPUT_ENABLED} is false. */
export function withEffectiveStudioOutputs<T extends StudioOutputXPostToggle>(
  outputs: T
): T {
  if (X_THREADS_OUTPUT_ENABLED) return outputs;
  if (!outputs.xPost) return outputs;
  return { ...outputs, xPost: false };
}

export function parseStudioOutputs(raw: unknown): StudioOutputToggles | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.carousel !== "boolean" ||
    typeof r.imagePost !== "boolean" ||
    typeof r.xPost !== "boolean" ||
    typeof r.reelShort !== "boolean"
  ) {
    return undefined;
  }
  return withEffectiveStudioOutputs({
    carousel: r.carousel,
    imagePost: r.imagePost,
    xPost: r.xPost,
    reelShort: r.reelShort,
  });
}

export function isShortOnlyStudioOutputs(
  o: StudioOutputToggles | null | undefined,
): boolean {
  if (!o) return false;
  return o.reelShort && !o.carousel && !o.imagePost && !o.xPost;
}

/** Map ProcessingJob `outputsWanted` onto studio toggles. */
export function studioOutputsFromWanted(wanted: {
  carousel: boolean;
  photo: boolean;
  short: boolean;
  xPost?: boolean;
}): StudioOutputToggles {
  return withEffectiveStudioOutputs({
    carousel: wanted.carousel,
    imagePost: wanted.photo,
    xPost: wanted.xPost === true,
    reelShort: wanted.short,
  });
}

/** Keep any previously requested studio outputs when a later enqueue is narrower. */
export function unionStudioOutputs(
  current: StudioOutputToggles | undefined,
  incoming: StudioOutputToggles,
): StudioOutputToggles {
  return withEffectiveStudioOutputs({
    carousel: current?.carousel === true || incoming.carousel,
    imagePost: current?.imagePost === true || incoming.imagePost,
    xPost: current?.xPost === true || incoming.xPost,
    reelShort: current?.reelShort === true || incoming.reelShort,
  });
}

/**
 * Prefer explicit `payload.studioOutputs`. If missing, treat a short-only
 * `outputs` object (no carousel/photo keys) as Video Editor.
 */
export function inferStudioOutputsFromQueuePayload(payload: {
  studioOutputs?: unknown;
  outputs?: unknown;
}): StudioOutputToggles | undefined {
  const parsed = parseStudioOutputs(payload.studioOutputs);
  if (parsed) return parsed;
  const outputs = payload.outputs;
  if (!outputs || typeof outputs !== "object") return undefined;
  const o = outputs as Record<string, unknown>;
  const has = (k: string) => o[k] != null && typeof o[k] === "object";
  if (has("short") && !has("carousel") && !has("photo")) {
    return SHORT_ONLY_STUDIO_OUTPUTS;
  }
  return undefined;
}
