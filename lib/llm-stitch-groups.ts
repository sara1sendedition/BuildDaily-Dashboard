import OpenAI from "openai";
import {
  excerptTranscript,
  heuristicStitchGroups,
  parseStitchGroupPlan,
  type StitchGroup,
  type StitchGroupClipInput,
} from "./stitch-group-plan";

function formatClipBlock(clip: StitchGroupClipInput, index: number): string {
  const duration =
    clip.durationSec != null && Number.isFinite(clip.durationSec)
      ? `${clip.durationSec.toFixed(1)}s`
      : "unknown";
  const modified = clip.modifiedAt?.trim() || "unknown";
  const text = excerptTranscript(clip.text) || "(no speech transcribed)";
  return [
    `CLIP ${index + 1}`,
    `fileId: ${clip.fileId}`,
    `name: ${clip.name}`,
    `modifiedAt: ${modified}`,
    `duration: ${duration}`,
    `transcript: ${text}`,
  ].join("\n");
}

const SYSTEM = `You group phone-camera teaching clips into stitch groups vs standalone videos.

The creator records climbing/coaching takes. Camera filenames (IMG_1234, IMG_1235, …) are the strongest grouping signal: consecutive names in time order are usually one piece she paused between. Transcripts confirm continuation and catch list-style scripts.

Stitch (2+ clips, in chronological speaking order) when:
- Filenames are sequential (IMG_1234 / IMG_1235 / IMG_1236). Stitch those unless the transcripts clearly change topic or audience.
- An opener promises a numbered list ("here's 3 ways…", "two cues for…", "a few things") and later clips start with ordinals: "first,", "second,", "next,", "then,", "last,", "finally,". Those follow-ups belong with the opener even if each clip sounds complete on its own.
- The later clip continues the same thought (mid-sentence, "anyway", "so yeah", "as I was saying").
- Same drill/cue, clearly a restart or pickup of the previous take.

Keep solo when:
- Filename sequence breaks (a gap in IMG numbers) AND the transcript is a new complete point.
- Topic, drill, or audience clearly changes.
- Do not glue unrelated sequential files just because they were filmed the same hour if the speech is a new standalone lesson with no list/continuation cues.

Rules:
- Use every fileId exactly once. Do not invent ids.
- Preserve speaking order inside a group (filename sequence, then modifiedAt).
- A promised list should stay one stitch (intro + each "first/next" part). Typical size 2–5; do not dump a whole session into one stitch.
- Sequential filenames outweigh "this clip could stand alone." "First," / "next," after a list intro is continuation, not a new video.

Return JSON only:
{"groups":[{"fileIds":["id1","id2"],"reason":"short why"},{"fileIds":["id3"],"reason":"short why"}]}`;

export async function groupClipsForStitch(
  clips: StitchGroupClipInput[],
  apiKey: string,
  opts?: { useStubLlm?: boolean }
): Promise<StitchGroup[]> {
  const ids = clips.map((c) => c.fileId);
  if (ids.length === 0) return [];
  if (ids.length === 1) {
    return parseStitchGroupPlan(
      { groups: [{ fileIds: ids, reason: "Only one clip in this batch." }] },
      ids
    );
  }

  if (opts?.useStubLlm) {
    return heuristicStitchGroups(clips);
  }

  const openai = new OpenAI({ apiKey });
  const user = clips.map((c, i) => formatClipBlock(c, i)).join("\n\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return heuristicStitchGroups(clips);
  }

  const groups = parseStitchGroupPlan(parsed, ids);
  const allSolo = groups.every((g) => g.kind === "solo");
  const parsedEmpty =
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { groups?: unknown }).groups) ||
    (parsed as { groups: unknown[] }).groups.length === 0;
  if (parsedEmpty && allSolo) {
    return heuristicStitchGroups(clips);
  }
  return groups;
}
