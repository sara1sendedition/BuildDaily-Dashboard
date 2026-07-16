"use client";

import Link from "next/link";
import type { HubClientStatus } from "@/lib/hub/types";
import { commentInboxPublicUrl } from "@/lib/hub/env";

import { getShortSourceTool } from "@/lib/short-source-tool";

export type ContinueItem = {
  title: string;
  description: string;
  href: string;
  external?: boolean;
};

export function pickContinueItem(
  client: HubClientStatus,
  commentReplies?: number
): ContinueItem | null {
  if (client.clipStitchHandoffReady) {
    const toEditor = client.clipStitchHandoffDestination === "video-editor";
    return {
      title: "Combined clip ready",
      description: toEditor
        ? "Open Video Editor to turn your stitched video into a short."
        : "Open Multiplier to turn your stitched video into posts.",
      href: toEditor ? "/video-editor" : "/multiplier",
    };
  }
  if (client.shortProcessing) {
    const fromEditor = getShortSourceTool() === "video-editor";
    return {
      title: "Short video processing",
      description: fromEditor
        ? "Your reel is still rendering — open Video Editor to check progress."
        : "Your reel is still rendering — open Multiplier to check progress.",
      href: fromEditor ? "/video-editor" : "/multiplier",
    };
  }
  if (client.nextPublishAtUnix) {
    const when = new Date(client.nextPublishAtUnix * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return {
      title: "Next scheduled post",
      description: `Publishing ${when} — review on the calendar.`,
      href: "/schedule",
    };
  }
  const inbox = commentInboxPublicUrl();
  if (inbox && commentReplies !== undefined && commentReplies > 0) {
    return {
      title: "Comments waiting",
      description: `${commentReplies} replies sent — keep engaging in Comment Converter.`,
      href: inbox,
      external: true,
    };
  }
  return null;
}

type Props = {
  item: ContinueItem | null;
};

export function ContinueBanner({ item }: Props) {
  if (!item) return null;

  const inner = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--bd-green-700)]">
        Continue where you left off
      </p>
      <p className="mt-1 font-semibold text-stone-900">{item.title}</p>
      <p className="mt-0.5 text-sm text-stone-600">{item.description}</p>
      <span className="mt-2 inline-block text-sm font-semibold text-[var(--bd-green-700)]">
        Continue →
      </span>
    </>
  );

  const className =
    "block rounded-xl border border-[var(--bd-green-200)] bg-[var(--bd-green-50)] px-4 py-3 hover:bg-[var(--bd-green-100)] transition-colors";

  if (item.external) {
    return (
      <a href={item.href} className={className} rel="noopener noreferrer">
        {inner}
      </a>
    );
  }

  return (
    <Link href={item.href} className={className}>
      {inner}
    </Link>
  );
}
