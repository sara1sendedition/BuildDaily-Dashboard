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

The creator records climbing/coaching takes. One teaching point is often split across 2–4 clips because they paused the camera. Other clips are complete on their own and must NOT be concatenated.

Stitch (2+ clips, in chronological speaking order) when:
- The later clip continues the same thought (mid-sentence, "anyway", "so yeah", "as I was saying").
- Same drill/cue, clearly a restart or pickup of the previous take.
- Sequential camera names (IMG_1234 / IMG_1235) AND the transcripts match one take.

Keep solo when:
- The clip is a complete standalone point (even if recorded minutes later in the same session).
- Topic, drill, or audience changes.
- You are unsure. Prefer solo over a wrong stitch.

Rules:
- Use every fileId exactly once. Do not invent ids.
- Preserve speaking order inside a group (usually modifiedAt / filename sequence).
- Prefer small groups (2–4). Do not dump a whole session into one stitch.
- Time proximity and sequential filenames are hints, not proof.

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
