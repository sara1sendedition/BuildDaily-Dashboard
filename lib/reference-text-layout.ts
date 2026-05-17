import type {
  ReferenceTextPlacement,
  ReferenceTextPlacementHorizontal,
  ReferenceTextPlacementVertical,
} from "@/lib/slide-canvas-types";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function defaultCenterYNorm(v: ReferenceTextPlacementVertical): number {
  switch (v) {
    case "top":
      return 0.18;
    case "upper":
      return 0.3;
    case "lower":
      return 0.62;
    case "bottom":
      return 0.74;
    case "center":
    default:
      return 0.5;
  }
}

export function normalizeVertical(
  raw: string | undefined | null
): ReferenceTextPlacementVertical {
  const s = (raw ?? "center").toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "top" || s === "upper" || s === "upper_center" || s === "uppercenter") {
    return s === "top" ? "top" : "upper";
  }
  if (s === "bottom" || s === "lower" || s === "lower_center" || s === "lowercenter") {
    return s === "bottom" ? "bottom" : "lower";
  }
  if (s === "middle" || s === "mid" || s === "center" || s === "centre") return "center";
  return "center";
}

export function normalizeHorizontal(
  raw: string | undefined | null
): ReferenceTextPlacementHorizontal {
  const s = (raw ?? "center").toLowerCase();
  if (s === "left" || s === "l") return "left";
  if (s === "right" || s === "r") return "right";
  return "center";
}

/**
 * Resolves anchor X, canvas textAlign, and vertical center of the text block for reference-matched layout.
 */
export function resolveReferenceTextAnchor(params: {
  width: number;
  height: number;
  contentInset: number;
  placement: ReferenceTextPlacement;
  /** Total height of the wrapped title + body block (px). */
  blockHeight: number;
  /** Reserve bottom area for slide counter + chevrons. */
  bottomReservePx: number;
}): {
  anchorX: number;
  blockCenterY: number;
  textAlign: "left" | "center" | "right";
} {
  const { width, height, contentInset: inset, placement, blockHeight, bottomReservePx } =
    params;

  let yn =
    placement.textBlockCenterYNorm != null &&
    Number.isFinite(placement.textBlockCenterYNorm)
      ? placement.textBlockCenterYNorm
      : defaultCenterYNorm(placement.vertical);
  yn = clamp(yn, 0.06, 0.94);
  let blockCenterY = yn * height;

  const minCy = inset + blockHeight / 2;
  const maxCy = height - bottomReservePx - blockHeight / 2;
  if (minCy <= maxCy) {
    blockCenterY = clamp(blockCenterY, minCy, maxCy);
  } else {
    blockCenterY = (minCy + maxCy) / 2;
  }

  let textAlign: "left" | "center" | "right" = "center";
  let anchorX = width / 2;

  if (placement.horizontal === "left") {
    textAlign = "left";
    anchorX = inset;
  } else if (placement.horizontal === "right") {
    textAlign = "right";
    anchorX = width - inset;
  } else {
    textAlign = "center";
    const xn =
      placement.textBlockCenterXNorm != null &&
      Number.isFinite(placement.textBlockCenterXNorm)
        ? clamp(placement.textBlockCenterXNorm, 0.08, 0.92)
        : 0.5;
    anchorX = xn * width;
    anchorX = clamp(anchorX, inset + 24, width - inset - 24);
  }

  return { anchorX, blockCenterY, textAlign };
}
