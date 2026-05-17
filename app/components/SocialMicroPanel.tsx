"use client";

import { useCallback, useState } from "react";
import { useCarouselWorkspace } from "@/context/carousel-workspace-context";

function CopyTextButton({
  label,
  text,
  disabled,
}: {
  label: string;
  text: string;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(async () => {
    if (!text.trim() || disabled) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [disabled, text]);
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={disabled || !text.trim()}
      className="shrink-0 rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function SocialMicroPanel() {
  const {
    socialMicro,
    socialMicroError,
    socialMicroBusy,
    regenerateSocialMicro,
    transcript,
    loading,
  } = useCarouselWorkspace();

  const [copiedThread, setCopiedThread] = useState(false);
  const [copiedThreads, setCopiedThreads] = useState(false);

  const threadAll =
    socialMicro?.twitterThread?.map((t) => t.trim()).filter(Boolean).join(
      "\n\n"
    ) ?? "";
  const threadsAll =
    socialMicro?.threadsPosts?.map((t) => t.trim()).filter(Boolean).join(
      "\n\n---\n\n"
    ) ?? "";

  const copyThreadAll = useCallback(async () => {
    if (!threadAll) return;
    try {
      await navigator.clipboard.writeText(threadAll);
      setCopiedThread(true);
      window.setTimeout(() => setCopiedThread(false), 2000);
    } catch {
      setCopiedThread(false);
    }
  }, [threadAll]);

  const copyThreadsAll = useCallback(async () => {
    if (!threadsAll) return;
    try {
      await navigator.clipboard.writeText(threadsAll);
      setCopiedThreads(true);
      window.setTimeout(() => setCopiedThreads(false), 2000);
    } catch {
      setCopiedThreads(false);
    }
  }, [threadsAll]);

  const busy = loading || socialMicroBusy;
  const hasTranscript = transcript.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-stone-600">
            Draft copy from your transcript only (no auto-post). X: threaded,
            debate-style hooks. Threads: warmer, 2–4 posts with light topic tags.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void regenerateSocialMicro()}
          disabled={busy || !hasTranscript}
          className="shrink-0 rounded-lg border border-palette-moss bg-white px-3 py-2 text-xs font-semibold text-palette-moss shadow-sm transition hover:bg-palette-pale/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {socialMicroBusy ? "Regenerating…" : "Regenerate"}
        </button>
      </div>

      {socialMicroError ? (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          role="alert"
        >
          <span className="font-semibold">Could not generate copy.</span>{" "}
          {socialMicroError}
        </div>
      ) : null}

      {busy && !socialMicro && !socialMicroError ? (
        <p className="text-sm text-stone-600" role="status">
          {hasTranscript
            ? "Generating X / Threads copy…"
            : "Processing video…"}
        </p>
      ) : null}

      {!busy && !socialMicro && !socialMicroError && hasTranscript ? (
        <p className="text-sm text-stone-600">
          Copy will appear here after processing. Use Regenerate if it did not
          run.
        </p>
      ) : null}

      {!hasTranscript && !busy ? (
        <p className="text-sm text-stone-600">
          Transcript appears after your video is processed.
        </p>
      ) : null}

      {socialMicro ? (
        <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-stone-900">
                X (Twitter) thread
              </h3>
              <button
                type="button"
                onClick={() => void copyThreadAll()}
                disabled={!threadAll}
                className="rounded-md border border-stone-200 bg-white px-2.5 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copiedThread ? "Copied thread" : "Copy full thread"}
              </button>
            </div>
            <ol className="list-decimal space-y-3 pl-5 text-sm text-stone-800">
              {socialMicro.twitterThread.map((tweet, i) => (
                <li key={i} className="pl-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed">
                      {tweet}
                    </pre>
                    <CopyTextButton label="Copy" text={tweet} />
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-stone-900">Threads</h3>
              <button
                type="button"
                onClick={() => void copyThreadsAll()}
                disabled={!threadsAll}
                className="rounded-md border border-stone-200 bg-white px-2.5 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copiedThreads ? "Copied posts" : "Copy all posts"}
              </button>
            </div>
            <ol className="list-decimal space-y-3 pl-5 text-sm text-stone-800">
              {socialMicro.threadsPosts.map((post, i) => (
                <li key={i} className="pl-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed">
                      {post}
                    </pre>
                    <CopyTextButton label="Copy" text={post} />
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {socialMicro.threadsVisualSuggestion.trim() ? (
            <section className="space-y-2 rounded-lg border border-stone-200 bg-stone-50/80 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-stone-900">
                  Visual suggestion (Threads)
                </h3>
                <CopyTextButton
                  label="Copy"
                  text={socialMicro.threadsVisualSuggestion}
                />
              </div>
              <p className="text-sm leading-relaxed text-stone-800">
                {socialMicro.threadsVisualSuggestion}
              </p>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
