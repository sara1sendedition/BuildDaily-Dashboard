import OpenAI from "openai";
import type { SocialMicroSnapshot, TranscriptSegment } from "./types";
import { stripEmDashes } from "./strip-em-dash";
import { MAX_COPY_CONTEXT_CHARS } from "./copy-context";
import { TWITTER_THREADS_PLAYBOOK } from "./prompts/twitter-threads-playbook";

const MAX_TWEET_CHARS = 280;
const MAX_THREADS_CHARS = 500;

/**
 * Removes common model glitches (stray "Copy", bad ampersands, lone ©) before length clamp.
 */
function sanitizeSocialPostText(s: string): string {
  let t = stripEmDashes(s.trim());
  // Mid-sentence " Copy " / " copy " artifacts (never valid as a standalone word here)
  t = t.replace(/\s+Copy\s+/gi, " ");
  t = t.replace(/\s+copy\s+/g, " ");
  // "clause & #Tag" → end clause, then tag
  t = t.replace(/\s+&\s*(#\w+)/g, ". $1");
  // Standalone & between words → " and "
  t = t.replace(/\s+&\s+/g, " and ");
  // Stray copyright symbol (not from transcript—model decoration)
  t = t.replace(/\s*©+\s*/g, " ");
  t = t.replace(/©+$/g, "");
  return t.replace(/\s{2,}/g, " ").trim();
}

function transcriptBlock(segments: TranscriptSegment[]): string {
  return segments
    .map(
      (s, i) =>
        `[${i}] ${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)}s: ${s.text}`
    )
    .join("\n");
}

function clampTweet(s: string): string {
  const t = sanitizeSocialPostText(s);
  if (t.length <= MAX_TWEET_CHARS) return t;
  return stripEmDashes(t.slice(0, MAX_TWEET_CHARS - 1).trimEnd() + "…");
}

function clampThreads(s: string): string {
  const t = sanitizeSocialPostText(s);
  if (t.length <= MAX_THREADS_CHARS) return t;
  return stripEmDashes(t.slice(0, MAX_THREADS_CHARS - 1).trimEnd() + "…");
}

function normalizeStringArray(raw: unknown, clamp: (s: string) => string): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) {
    const s = clamp(String(x ?? ""));
    if (s.length > 0) out.push(s);
  }
  return out;
}

export async function generateSocialMicroFromTranscript(
  segments: TranscriptSegment[],
  apiKey: string,
  options?: { copyContext?: string }
): Promise<SocialMicroSnapshot> {
  const openai = new OpenAI({ apiKey });
  const copy = options?.copyContext?.trim()?.slice(0, MAX_COPY_CONTEXT_CHARS);

  const user = [
    copy
      ? `COPY CONTEXT (voice, brand, audience—must not contradict transcript):\n${copy}\n`
      : "",
    "Transcript (ground truth for all claims):\n",
    transcriptBlock(segments),
  ].join("");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `${TWITTER_THREADS_PLAYBOOK}

Return JSON only with this exact shape:
{"twitterThread":["tweet1","tweet2",...],"threadsPosts":["post1","post2",...],"threadsVisualSuggestion":"one line"}

- twitterThread: ordered array; index 0 = first on X, then replies in order. Aim 6–9 tweets (1 hook + 5–8 points); each ≤280 chars; follow jargon, emoji, hashtag, CTA, and artifact rules above.
- threadsPosts: ordered array; prefer 3–5 posts (2–4 if the arc is short). Each ≤500 chars; warm, unified voice; 1–2 #TopicTags per post where natural; no stray words or "&" glues.
- threadsVisualSuggestion: single line describing ideal still or clip aspect (4:5 or 9:16).`,
      },
      { role: "user", content: user },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: {
    twitterThread?: unknown;
    threadsPosts?: unknown;
    threadsVisualSuggestion?: unknown;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return stubSocialMicroFromTranscript(segments);
  }

  let twitterThread = normalizeStringArray(parsed.twitterThread, clampTweet);
  let threadsPosts = normalizeStringArray(parsed.threadsPosts, clampThreads);
  const threadsVisualSuggestion = stripEmDashes(
    String(parsed.threadsVisualSuggestion ?? "").trim().slice(0, 400)
  );

  if (twitterThread.length === 0) {
    twitterThread = stubSocialMicroFromTranscript(segments).twitterThread;
  }
  if (threadsPosts.length === 0) {
    threadsPosts = stubSocialMicroFromTranscript(segments).threadsPosts;
  }

  return {
    twitterThread,
    threadsPosts,
    threadsVisualSuggestion:
      threadsVisualSuggestion ||
      "Use a strong mid-video frame that shows the main technique—4:5 crop for Threads.",
  };
}

export function stubSocialMicroFromTranscript(
  segments: TranscriptSegment[]
): SocialMicroSnapshot {
  const snippet = stripEmDashes(
    segments.map((s) => s.text).join(" ").slice(0, 220)
  );
  return {
    twitterThread: [
      clampTweet(
        "Stub: set OPENAI_API_KEY for real X/Threads copy from your transcript."
      ),
      clampTweet(
        snippet
          ? `From your clip: ${snippet}${snippet.length >= 220 ? "…" : ""}`
          : "Add a real video and API key to generate a threaded breakdown."
      ),
    ],
    threadsPosts: [
      clampThreads(
        snippet
          ? `Friendly stub: ${snippet.slice(0, 380)}${snippet.length > 380 ? "…" : ""} #Climbing`
          : "Stub Threads post—enable the API for authentic multi-post drafts."
      ),
    ],
    threadsVisualSuggestion:
      "Attach a 4:5 or 9:16 still from your video that shows the key move.",
  };
}
