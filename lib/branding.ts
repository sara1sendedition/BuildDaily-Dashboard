import type { BrandingPreset } from "./types";

export const DEFAULT_BRANDING: BrandingPreset = {
  id: "default",
  name: "Default",
  primary: "#0f172a",
  secondary: "#334155",
  background: "#0f172a",
  text: "#f8fafc",
  accent: "#38bdf8",
  fontFamilyTitle: "Poppins Bold",
  fontFamilyBody: "Poppins SemiBold",
};

export const ALT_BRANDING: BrandingPreset = {
  id: "warm",
  name: "Warm",
  primary: "#1c1917",
  secondary: "#44403c",
  background: "#292524",
  text: "#fafaf9",
  accent: "#f97316",
  fontFamilyTitle: "Poppins Bold",
  fontFamilyBody: "Poppins SemiBold",
};

export const BRANDING_PRESETS: BrandingPreset[] = [DEFAULT_BRANDING, ALT_BRANDING];

export function getBrandingById(id: string | undefined): BrandingPreset {
  if (!id) return DEFAULT_BRANDING;
  return BRANDING_PRESETS.find((b) => b.id === id) ?? DEFAULT_BRANDING;
}
