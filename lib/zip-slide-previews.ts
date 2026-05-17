import JSZip from "jszip";

/** Must match folders in `lib/render-zip.ts` (avoid importing server-only modules here). */
const YT_FOLDER = "youtube_1x1";
const IG_FOLDER = "instagram_4x5";

function sortedSlideNames(
  all: string[],
  folderPrefix: string | null
): string[] {
  const pat = folderPrefix
    ? new RegExp(`^${folderPrefix}/slide_\\d{2}\\.png$`, "i")
    : /^slide_\d{2}\.png$/i;
  return all
    .filter((n) => pat.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/(\d+)/)?.[1] ?? "0", 10);
      const nb = parseInt(b.match(/(\d+)/)?.[1] ?? "0", 10);
      return na - nb;
    });
}

/** Avoid per-byte string concat (quadratic cost) on multi‑MB PNGs. */
function uint8ArrayToBinaryString(bytes: Uint8Array): string {
  const chunk = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    parts.push(String.fromCharCode.apply(null, slice as unknown as number[]));
  }
  return parts.join("");
}

async function readZipEntryBase64(
  zip: JSZip,
  name: string
): Promise<string> {
  const f = zip.files[name];
  if (!f) return "";
  const buf = await f.async("uint8array");
  return btoa(uint8ArrayToBinaryString(buf));
}

export type CarouselZipPreviews = {
  youtube: string[];
  instagram: string[];
};

/** Extract 1:1 and 4:5 slide PNGs from a carousel ZIP (single parse). */
export async function extractCarouselSlidePreviewsFromZip(
  zipBase64: string
): Promise<CarouselZipPreviews> {
  const bin = atob(zipBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const zip = await JSZip.loadAsync(bytes);
  const all = Object.keys(zip.files).filter((n) => !zip.files[n].dir);

  const ytFolder = sortedSlideNames(all, YT_FOLDER);
  const legacy = sortedSlideNames(all, null);
  const youtubeNames = ytFolder.length > 0 ? ytFolder : legacy;
  const instagramNames = sortedSlideNames(all, IG_FOLDER);

  const youtube: string[] = [];
  for (const name of youtubeNames) {
    const b64 = await readZipEntryBase64(zip, name);
    if (b64.length > 0) youtube.push(b64);
  }
  const instagram: string[] = [];
  for (const name of instagramNames) {
    const b64 = await readZipEntryBase64(zip, name);
    if (b64.length > 0) instagram.push(b64);
  }
  return { youtube, instagram };
}

/** YouTube / legacy flat slides only (for callers that need a single list). */
export async function extractSlidePngBase64sFromZip(
  zipBase64: string
): Promise<string[]> {
  const { youtube } = await extractCarouselSlidePreviewsFromZip(zipBase64);
  return youtube;
}
