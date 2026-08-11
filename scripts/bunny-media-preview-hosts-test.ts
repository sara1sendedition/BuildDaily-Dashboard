/**
 * Regression checks for Bunny media host allowlists used by Short preview.
 *
 *   npx tsx scripts/bunny-media-preview-hosts-test.ts
 */
import { isAllowedSourceVideoUrl } from "../lib/allowed-source-video-url";
import {
  isBunnyMediaPreviewHost,
  mobileFriendlyMp4PreviewUrl,
} from "../lib/media/mobile-friendly-mp4-preview-url";

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

expect(isBunnyMediaPreviewHost("foo.b-cdn.net"), "b-cdn subdomain");
expect(isBunnyMediaPreviewHost("cdn.builddaily.app"), "cdn pull zone");
expect(isBunnyMediaPreviewHost("media.builddaily.app"), "media pull zone");
expect(
  !isBunnyMediaPreviewHost("evilbuilddaily.app"),
  "suffix attack on builddaily.app",
);
expect(
  !isBunnyMediaPreviewHost("app.builddaily.app"),
  "app host is not media CDN",
);
expect(
  !isBunnyMediaPreviewHost("hub.builddaily.app"),
  "hub host is not media CDN",
);

expect(
  isAllowedSourceVideoUrl("https://foo.b-cdn.net/reels/a.mp4"),
  "allow b-cdn reel",
);
expect(
  isAllowedSourceVideoUrl("https://cdn.builddaily.app/reels/a.mp4"),
  "allow cdn.builddaily.app reel",
);
expect(
  !isAllowedSourceVideoUrl("https://app.builddaily.app/api/secret"),
  "block app SSRF",
);
expect(
  !isAllowedSourceVideoUrl("https://evilbuilddaily.app/x.mp4"),
  "block suffix attack",
);
expect(
  !isAllowedSourceVideoUrl("http://foo.b-cdn.net/a.mp4"),
  "require https",
);

const proxied = mobileFriendlyMp4PreviewUrl(
  "https://cdn.builddaily.app/reels/a.mp4",
);
expect(proxied?.includes("/api/media/mp4-faststart?url="), "proxy wrap CDN");
expect(
  mobileFriendlyMp4PreviewUrl("blob:https://app/1") === "blob:https://app/1",
  "passthrough blob",
);
expect(
  mobileFriendlyMp4PreviewUrl("https://example.com/a.mp4") ===
    "https://example.com/a.mp4",
  "non-bunny unchanged",
);

console.log("bunny-media-preview-hosts-test: all checks passed.");
