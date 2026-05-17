/**
 * Video to Short requests are proxied from Next to the FastAPI backend. We normalize
 * multipart fields here so deploys (Coolify, Docker) get consistent editorial + audio
 * behavior without rebuilding the client — set VIDEO_TO_SHORT_AUDIO_MODE on the server.
 */

/** Always merged into `editorial_notes` before upstream (plus optional creator brief). */
export const DEFAULT_SHORT_EDITORIAL_GUIDANCE = `
Smart editorial: aggressively trim filler words and verbal crutches (e.g. um, uh, like, you know), false starts, stumbles, and long pauses.

Opening: cut leading silence and dead air so playback starts on the first substantive line—not on a throwaway "ok", "okay", "kay", "kk", "right", "yeah", "alright", or "so" unless it is clearly intentional scripted copy. Treat standalone affirmations at the top as disposable unless they carry unique information.

Closing: trim standalone tag questions and mic-check phrases at the very end when they add no content (e.g. "good?", "cool?", "make sense?", "you know?", "right?")—especially after the main thought already landed.

Repetition: when the speaker repeats the same sentence, clause, or nearly identical wording (including after a pause or restart), keep the clearest single take and remove the duplicates. When they circle the same idea with different words, keep one tight version.

Preserve meaning and the speaker's authentic voice; do not replace content with generic summary prose unless removing redundancy. Aim for tight, listenable pacing without sounding artificially rushed.
`.trim();

export function mergeShortEditorialNotes(userNotes: string): string {
  const u = userNotes.trim();
  if (!u) return DEFAULT_SHORT_EDITORIAL_GUIDANCE;
  return `${DEFAULT_SHORT_EDITORIAL_GUIDANCE}\n\n--- Creator brief ---\n${u}`;
}

/**
 * Server-only env wins (Coolify secrets), then public build-time env, then whatever the
 * browser sent, then studio default. Common backend values: original | fast | deepfilter.
 * Default `deepfilter` matches the Video to Short FastAPI form default.
 */
export function resolveShortAudioMode(clientSent: string | null): string {
  const server = process.env.VIDEO_TO_SHORT_AUDIO_MODE?.trim();
  if (server) return server;
  const pub = process.env.NEXT_PUBLIC_VIDEO_TO_SHORT_AUDIO_MODE?.trim();
  if (pub) return pub;
  const c = clientSent?.trim();
  if (c) return c;
  return "deepfilter";
}

/** Strips and replaces `editorial_notes` / `audio_mode` so proxy owns canonical values. */
export function rewriteVideoToShortProxyFormData(incoming: FormData): FormData {
  let userEditorial = "";
  let clientAudio: string | null = null;
  /** Upload parts must stay last — some multipart stacks assume `file` / `files` close the body. */
  const uploadParts: Array<[string, FormDataEntryValue]> = [];
  const out = new FormData();

  for (const [key, value] of incoming.entries()) {
    if (key === "editorial_notes") {
      if (typeof value === "string") userEditorial = value;
      continue;
    }
    if (key === "audio_mode") {
      if (typeof value === "string") clientAudio = value;
      continue;
    }
    if (key === "file" || key === "files") {
      uploadParts.push([key, value]);
      continue;
    }
    out.append(key, value);
  }

  out.append("editorial_notes", mergeShortEditorialNotes(userEditorial));
  out.append("audio_mode", resolveShortAudioMode(clientAudio));

  for (const [key, value] of uploadParts) {
    out.append(key, value);
  }

  return out;
}
