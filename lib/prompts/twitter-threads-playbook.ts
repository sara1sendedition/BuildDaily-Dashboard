/**
 * Platform guidance for generating X (Twitter) vs Threads copy from video transcript.
 * Distilled from creator best-practice notes + quality guardrails (clarity, artifacts, engagement).
 */
export const TWITTER_THREADS_PLAYBOOK = `
## X (Twitter): real-time, debate-friendly, reply-weighted
- Algorithm favors early engagement; replies matter more than likes alone.
- Use X for sharp hooks, contrarian angles, numbered tips, or analytical breakdowns.
- **Thread structure:** Tweet 1 = strong hook (question, stat, or bold claim). Then 5–8 follow-ups (each ONE clear idea), 6–9 tweets total including the hook. If the topic is thin, fewer tweets is fine—do not pad with empty fragments.
- **Clarity over jargon:** If the transcript uses niche movement terms (e.g. "throwing" for dynamic movement), do NOT assume all readers know them. Prefer plain phrasing first: "big reaches", "reaching dynamically", "leaping for holds", or briefly define once ("dynamic moves—big reaches to the next hold"). Avoid unexplained insider shorthand in the hook.
- **Fragments:** Do not leave tweets as vague fragments. Each tweet should stand alone enough to scan; merge or lightly expand if needed for context.
- **Tone:** Punchy and scannable, with a touch of encouragement where it fits (supportive, not preachy).
- **Emojis:** Put 1 relevant emoji at the start of tweet 1 when it boosts energy (e.g. strength, question, pointer). Use 0–2 emojis per tweet total; do not emoji-stuff every line.
- **Hashtags:** 1–2 per tweet where they fit. Mix broad + niche when relevant (e.g. #Climbing plus #ClimbingTips or #ClimbingTraining). Never truncate a hashtag to fit the limit—shorten the sentence instead, or drop one hashtag. Spell tags fully (e.g. #ClimbingTips not half-cut).
- **Length:** Each tweet max 280 characters (hard cap). Shorter often reads better.
- **CTAs:** Final tweet should drive replies with an active question ("Share your tip!", "What do YOU use?") not only passive "comment below". Optional: 👇 or similar once for the CTA tweet.
- **Links:** If you mention a URL, prefer saying it belongs in a follow-up reply (X down-ranks links in the first tweet)—this thread usually has no URL; skip unless transcript implies one.
- **Truth:** Ground every claim in the transcript; do not invent facts or quotes not supported by the video.

## Threads: Instagram-adjacent, warm, visual-forward
- Discovery via Meta "For You" and network; topic-style # tags help matching even when not "classic" clickable hashtags everywhere.
- **Tone:** Friendly, authentic, personal—storytelling, relatable. Unify voice across posts (pick "we" community OR direct "you" coaching—do not mix jarringly in adjacent sentences).
- **Format:** Up to 500 characters per post. Prefer **3–5 posts** in the series when the story needs it; 2–4 is fine for shorter arcs. First post: hook + setup but keep it tight—avoid one huge 200+ character ramble; split ideas across posts instead of one wall.
- **Readability:** Each post is a single flowing paragraph unless a short line break genuinely helps. Do not break mid-sentence in awkward places. Prefer "and" or a new sentence over a bare "&" between clauses. Do not end posts with redundant "below!" if "in the comments" is already clear.
- **Emojis:** Use 1–2 per post where they add warmth or emphasis (e.g. climber, thinking face, checkmark for CTA)—not every sentence.
- **Topic tags:** End posts with 1–2 relevant # tags when natural (e.g. #Climbing #TrainingTips #ClimbingCommunity). Same rule: never truncate a tag mid-word.
- **Visuals:** In field "threadsVisualSuggestion", give one concrete line: what image or 9:16/4:5 clip from the video would pair best (e.g. "Use the foot swap demo frame—4:5 crop").
- **Truth:** Same transcript grounding as X.

## Hard bans (quality / artifact prevention)
- Never output the literal word **Copy** (or **copy**) as filler in the middle of a sentence—that is a common model/UI glitch; write natural prose only.
- Do not output stray **©** or decorative symbols unless they appear verbatim in the transcript as meaningful content.
- Do not glue sentences with **&**—use "and", a period, or a semicolon.
- Hashtags must be complete words after #; if you are near the character limit, shorten plain text, never chop a tag.

## Shared
- Never use the Unicode em dash (U+2014). Use commas, periods, colons, or " - " with spaces.
- Consistent punctuation and capitalization (sentence case for body; optional single-word emphasis like YOU sparingly in CTAs).
- Merge brand/voice from COPY CONTEXT when provided without contradicting the transcript.
`.trim();
