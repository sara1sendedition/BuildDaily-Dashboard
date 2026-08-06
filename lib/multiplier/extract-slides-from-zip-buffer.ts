import JSZip from "jszip";

const YT_FOLDER = "youtube_1x1";
const IG_FOLDER = "instagram_4x5";

function sortedSlideNames(
  all: string[],
  folderPrefix: string | null,
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

/** Extract 1:1 and 4:5 slide PNG buffers from a carousel ZIP. */
export async function extractSlideBuffersFromZip(
  zipBuffer: Buffer,
): Promise<{ youtube: Buffer[]; instagram: Buffer[] }> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const all = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir);
  const ytFolder = sortedSlideNames(all, YT_FOLDER);
  const legacy = sortedSlideNames(all, null);
  const youtubeNames = ytFolder.length > 0 ? ytFolder : legacy;
  const instagramNames = sortedSlideNames(all, IG_FOLDER);

  const youtube: Buffer[] = [];
  for (const name of youtubeNames) {
    const f = zip.files[name];
    if (!f) continue;
    const buf = await f.async("nodebuffer");
    if (buf.length > 0) youtube.push(buf);
  }
  const instagram: Buffer[] = [];
  for (const name of instagramNames) {
    const f = zip.files[name];
    if (!f) continue;
    const buf = await f.async("nodebuffer");
    if (buf.length > 0) instagram.push(buf);
  }
  return { youtube, instagram };
}
