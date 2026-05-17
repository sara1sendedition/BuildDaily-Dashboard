import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { GlobalFonts } from "@napi-rs/canvas";

let poppinsRegistered = false;
let antonRegistered = false;

/** Load Poppins from @fontsource/poppins for @napi-rs/canvas (server-side PNG export). */
export function ensurePoppinsFonts(): void {
  if (poppinsRegistered) return;
  const base = join(
    process.cwd(),
    "node_modules/@fontsource/poppins/files"
  );
  const regular = join(base, "poppins-latin-400-normal.woff2");
  const semibold = join(base, "poppins-latin-600-normal.woff2");
  const bold = join(base, "poppins-latin-700-normal.woff2");
  if (!existsSync(regular) || !existsSync(bold)) {
    return;
  }
  try {
    GlobalFonts.register(readFileSync(regular), "Poppins");
    if (existsSync(semibold)) {
      GlobalFonts.register(readFileSync(semibold), "Poppins SemiBold");
    }
    GlobalFonts.register(readFileSync(bold), "Poppins Bold");
    poppinsRegistered = true;
  } catch {
    // Fall back to system fonts in render
  }
}

/** Anton display face (single weight) for carousel reference-style renders. */
export function ensureAntonFonts(): void {
  if (antonRegistered) return;
  const path = join(
    process.cwd(),
    "node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2"
  );
  if (!existsSync(path)) return;
  try {
    GlobalFonts.register(readFileSync(path), "Anton");
    antonRegistered = true;
  } catch {
    // Fall back to system fonts
  }
}

/** Register any bundled fonts needed for the given canvas font family names. */
export function ensureSlideFonts(famPrimary: string, famSecondary: string): void {
  ensurePoppinsFonts();
  const a = `${famPrimary} ${famSecondary}`.toLowerCase();
  if (a.includes("anton")) ensureAntonFonts();
}
