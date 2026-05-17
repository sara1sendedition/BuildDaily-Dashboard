import { getVideoToShortUrl } from "@/lib/video-to-short-url";

const pillClassName =
  "rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm transition hover:border-palette-teal/60 hover:bg-palette-pale/20 hover:text-stone-900";

const plainClassName =
  "text-sm font-medium text-stone-600 underline-offset-2 transition hover:text-stone-900 hover:underline";

type Props = {
  className?: string;
  /** `plain` matches text-style nav (e.g. refine page). */
  variant?: "pill" | "plain";
};

/** Opens the Video to Short tool in a new tab (sibling app, not embedded). */
export function VideoToShortExternalLink({
  className,
  variant = "pill",
}: Props) {
  const href = getVideoToShortUrl();
  const base = variant === "plain" ? plainClassName : pillClassName;
  const merged = className ? `${base} ${className}` : base;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={merged}
      title="Video to Short — turn raw clips into edited, publishable shorts (opens in a new tab)"
    >
      Video to Short
    </a>
  );
}
