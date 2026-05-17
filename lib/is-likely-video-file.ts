/**
 * Many browsers omit MIME or use application/octet-stream for valid videos.
 * Keep in sync with `<input accept="...">` hints on upload UIs.
 */
export function isLikelyVideoFile(f: File): boolean {
  const t = f.type.toLowerCase();
  if (t.startsWith("video/")) return true;
  if (t === "application/mp4" || t === "application/x-mp4") return true;
  if (t === "application/octet-stream") return true;
  if (!t) return true;
  return /\.(mp4|mov|webm|m4v|mkv|avi|mpeg|mpg|3gp|ogv|ts|mts|m2ts|asf|wmv|flv|f4v)$/i.test(
    f.name
  );
}
