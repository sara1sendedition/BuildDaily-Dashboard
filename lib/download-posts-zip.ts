/**
 * Client-side zip: one folder per post with post.png + caption.txt (caption + alt text).
 */

export type PostZipSource = {
  imageBase64: string;
  caption: string;
  altText: string;
};

export function safeFolderNameForPost(fileName: string, index: number): string {
  const base = fileName.replace(/\.[^.]+$/i, "") || "video";
  const safe = base
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "video";
  return `${String(index + 1).padStart(2, "0")}_${safe}`;
}

export async function buildPostsZipBlob(
  items: { folderName: string; result: PostZipSource }[]
): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const { folderName, result } of items) {
    const folder = zip.folder(folderName);
    if (!folder) continue;
    const bin = atob(result.imageBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    folder.file("post.png", bytes);
    const captionTxt = [
      result.caption.trim(),
      "",
      "---",
      "",
      "Alt text (Instagram):",
      result.altText.trim(),
    ].join("\n");
    folder.file("caption.txt", captionTxt);
  }
  return zip.generateAsync({ type: "blob" });
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
