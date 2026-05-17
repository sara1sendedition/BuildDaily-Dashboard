import assert from "node:assert/strict";
import { coverFocusFromFaceBoxPixels } from "../lib/carousel-slide-face-focus";

/** Face high in a 1080×1920 frame — focus y should be well above center (0.5). */
{
  const f = coverFocusFromFaceBoxPixels(400, 680, 120, 380, 1080, 1920);
  assert.ok(f.y < 0.4, `expected top-biased y, got ${f.y}`);
  assert.ok(f.y < 0.5, "should beat center-crop default");
}

/** Center crop would start ~285px from top; focus should target crop nearer top. */
{
  const f = coverFocusFromFaceBoxPixels(400, 680, 150, 400, 1080, 1920);
  const impliedCropTop = 1920 * f.y - 1350 / 2;
  assert.ok(impliedCropTop < 200, `crop top ${impliedCropTop} should stay high`);
}

console.log("carousel-face-focus-test: ok");
