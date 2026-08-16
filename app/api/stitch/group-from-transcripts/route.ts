import { NextResponse } from "next/server";
import { ownerApiGuard } from "@/lib/auth/owner-access";
import { groupClipsForStitch } from "@/lib/llm-stitch-groups";
import {
  excerptTranscript,
  MAX_STITCH_AUTO_GROUP_FILES,
  type StitchGroupClipInput,
} from "@/lib/stitch-group-plan";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseClips(raw: unknown): StitchGroupClipInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (raw.length > MAX_STITCH_AUTO_GROUP_FILES) return null;
  const out: StitchGroupClipInput[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const o = item as Record<string, unknown>;
    const fileId = typeof o.fileId === "string" ? o.fileId.trim() : "";
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!fileId || !name || seen.has(fileId)) return null;
    seen.add(fileId);
    const durationSec =
      typeof o.durationSec === "number" && Number.isFinite(o.durationSec)
        ? o.durationSec
        : null;
    const modifiedAt =
      typeof o.modifiedAt === "string" && o.modifiedAt.trim()
        ? o.modifiedAt.trim()
        : null;
    const text =
      typeof o.text === "string" ? excerptTranscript(o.text) : "";
    out.push({ fileId, name, modifiedAt, durationSec, text });
  }
  return out.length > 0 ? out : null;
}

/**
 * LLM (or heuristic stub) grouping of Drive clips into stitch vs solo rows.
 */
export async function POST(request: Request) {
  const denied = await ownerApiGuard();
  if (denied) return denied;

  const key = process.env.OPENAI_API_KEY ?? "";
  const useStub =
    process.env.USE_STUB_LLM === "true" || process.env.USE_STUB_LLM === "1";
  if (!key && !useStub) {
    return NextResponse.json(
      {
        error:
          "Missing OPENAI_API_KEY. Set it in .env.local or enable USE_STUB_LLM=true for UI testing.",
      },
      { status: 400 }
    );
  }

  let body: { clips?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const clips = parseClips(body.clips);
  if (!clips) {
    return NextResponse.json(
      {
        error: `Provide 1–${MAX_STITCH_AUTO_GROUP_FILES} unique clips with fileId and name.`,
      },
      { status: 400 }
    );
  }

  try {
    const groups = await groupClipsForStitch(clips, key || "stub", {
      useStubLlm: useStub,
    });
    return NextResponse.json({ groups });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Grouping failed";
    console.error(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
