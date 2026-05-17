import { NextResponse } from "next/server";
import { MAX_COPY_CONTEXT_CHARS } from "@/lib/copy-context";
import {
  generateSocialMicroFromTranscript,
  stubSocialMicroFromTranscript,
} from "@/lib/llm-twitter-threads";
import type { TranscriptSegment } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

function parseTranscriptJson(raw: unknown): TranscriptSegment[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: TranscriptSegment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (typeof s !== "object" || s === null) return null;
    const o = s as Record<string, unknown>;
    if (typeof o.text !== "string" || !String(o.text).trim()) return null;
    if (typeof o.startSec !== "number" || !Number.isFinite(o.startSec)) {
      return null;
    }
    if (typeof o.endSec !== "number" || !Number.isFinite(o.endSec)) return null;
    out.push({
      id: typeof o.id === "number" ? o.id : i,
      text: o.text,
      startSec: o.startSec,
      endSec: o.endSec,
    });
  }
  return out;
}

export async function POST(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const o = body as Record<string, unknown>;
  const transcript = parseTranscriptJson(o.transcript);
  if (!transcript) {
    return NextResponse.json(
      { error: "Body must include a non-empty transcript array." },
      { status: 400 }
    );
  }

  const copyContextRaw = String(o.copyContext ?? "").trim();
  const copyContext =
    copyContextRaw.length > 0
      ? copyContextRaw.slice(0, MAX_COPY_CONTEXT_CHARS)
      : undefined;

  try {
    if (useStub) {
      const plan = stubSocialMicroFromTranscript(transcript);
      return NextResponse.json(plan);
    }
    const plan = await generateSocialMicroFromTranscript(transcript, key, {
      copyContext,
    });
    return NextResponse.json(plan);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed";
    console.error(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
