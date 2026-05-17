/** StoryTrack / Video Studio (separate Next app). */
export function storytrackPublicUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_STORYTRACK_URL?.trim() || "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

export function storytrackApiUrl(): string {
  const raw =
    process.env.STORYTRACK_API_URL?.trim() || storytrackPublicUrl();
  return raw.replace(/\/$/, "");
}

export function commentInboxPublicUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_COMMENT_INBOX_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

export function commentInboxApiUrl(): string | null {
  const raw = process.env.COMMENT_INBOX_API_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  return commentInboxPublicUrl();
}
