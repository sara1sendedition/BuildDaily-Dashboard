import { clientApiPath } from "@/lib/client-api-path";

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(header);
  if (m?.[1]) {
    try {
      return decodeURIComponent(m[1].replace(/"/g, ""));
    } catch {
      return m[1];
    }
  }
  return fallback;
}

function videoMimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  if (lower.endsWith(".m4v")) return "video/x-m4v";
  return "video/mp4";
}

/** Download one Drive inbox video through the app proxy into a browser File. */
export async function downloadDriveInboxClip(
  driveId: string,
  fallbackName: string
): Promise<File> {
  const r = await fetch(
    clientApiPath(
      `/api/video-to-short/drive/inbox/${encodeURIComponent(driveId)}/download`
    ),
    { cache: "no-store" }
  );
  if (!r.ok) {
    const detail = await r.text();
    throw new Error(
      detail.trim() || `Could not download "${fallbackName}" from Google Drive.`
    );
  }
  const blob = await r.blob();
  const name = filenameFromDisposition(
    r.headers.get("content-disposition"),
    fallbackName
  );
  const type =
    blob.type && blob.type !== "application/octet-stream"
      ? blob.type
      : videoMimeFromName(name);
  return new File([blob], name, { type });
}
