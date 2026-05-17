"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { clientApiPath } from "@/lib/client-api-path";
import {
  readHubMetrics,
  metricsForPeriod,
} from "@/lib/hub/metrics-store";
import { readHubClientStatus } from "@/lib/hub/read-client-status";
import type {
  CommentConverterHubStats,
  HubClientStatus,
  HubServerSummary,
  StoryTrackHubSummary,
} from "@/lib/hub/types";
import { storytrackPublicUrl, commentInboxPublicUrl } from "@/lib/hub/env";
import { VideoStudioPanel } from "@/app/components/hub/VideoStudioPanel";
import { HubAggregateStats } from "@/app/components/hub/HubAggregateStats";
import { HubQuickStats } from "@/app/components/hub/HubQuickStats";
import { ContinueBanner, pickContinueItem } from "@/app/components/hub/ContinueBanner";
import { ToolLauncherGrid } from "@/app/components/hub/ToolLauncherGrid";
import type { ToolCardProps } from "@/app/components/hub/ToolCard";
import { CommonPaths } from "@/app/components/hub/CommonPaths";

const POLL_MS = 30_000;

export function HubDashboard() {
  const { user } = useUser();
  const [period, setPeriod] = useState<"week" | "all">("week");
  const [client, setClient] = useState<HubClientStatus | null>(null);
  const [server, setServer] = useState<HubServerSummary | null>(null);
  const [storytrack, setStorytrack] = useState<StoryTrackHubSummary | null>(null);
  const [storytrackLinked, setStorytrackLinked] = useState(false);
  const [inbox, setInbox] = useState<CommentConverterHubStats | null>(null);
  const [metrics, setMetrics] = useState(readHubMetrics);

  const storytrackUrl = storytrackPublicUrl();
  const inboxUrl = commentInboxPublicUrl();

  const refresh = useCallback(async () => {
    setMetrics(readHubMetrics());
    try {
      setClient(await readHubClientStatus());
    } catch {
      setClient(null);
    }

    try {
      const summaryRes = await fetch(clientApiPath("/api/hub/summary"), {
        credentials: "include",
      });
      if (summaryRes.ok) {
        setServer((await summaryRes.json()) as HubServerSummary);
      }
    } catch {
      setServer(null);
    }

    try {
      const stRes = await fetch(clientApiPath("/api/hub/storytrack"), {
        credentials: "include",
      });
      if (stRes.ok) {
        const body = (await stRes.json()) as {
          linked?: boolean;
          summary?: StoryTrackHubSummary | null;
        };
        setStorytrackLinked(Boolean(body.linked));
        setStorytrack(body.summary ?? null);
      }
    } catch {
      setStorytrackLinked(false);
      setStorytrack(null);
    }

    try {
      const ccRes = await fetch(clientApiPath("/api/hub/comment-converter"), {
        credentials: "include",
      });
      if (ccRes.ok) {
        const body = (await ccRes.json()) as {
          connected?: boolean;
          stats?: CommentConverterHubStats | null;
        };
        setInbox(body.connected && body.stats ? body.stats : null);
      }
    } catch {
      setInbox(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const periodMetrics = metricsForPeriod(metrics, period);
  const postsScheduled =
    client?.postsScheduledUpcoming ??
    server?.daemonUpcoming ??
    0;
  const postsPublished = server?.postsPublished ?? 0;
  const streak = storytrack?.streak ?? 0;
  const videosThisWeek = storytrack?.videosRecordedThisWeek ?? 0;

  const continueItem = client
    ? pickContinueItem(client, inbox?.replies)
    : null;

  const toolCards = useMemo((): ToolCardProps[] => {
    const studioStat =
      storytrack && streak > 0
        ? `${streak}-day streak`
        : storytrack && videosThisWeek > 0
          ? `${videosThisWeek} videos this week`
          : "— Record today to start";

    const stitchStat =
      periodMetrics.clipsStitched > 0
        ? `${periodMetrics.clipsStitched} clip${periodMetrics.clipsStitched === 1 ? "" : "s"} stitched`
        : "— Combine your takes in one click";

    const multiplyStat =
      periodMetrics.videosMultiplied > 0
        ? `${periodMetrics.videosMultiplied} video${periodMetrics.videosMultiplied === 1 ? "" : "s"} multiplied`
        : "— Turn your next video into 5 posts";

    const scheduleStat =
      postsScheduled > 0
        ? `${postsScheduled} scheduled`
        : postsPublished > 0
          ? `${postsPublished} published`
          : "— Schedule your next post";

    const inboxStat =
      inbox && inbox.replies > 0
        ? `${inbox.replies} replies sent`
        : inbox && inbox.commentsPulled > 0
          ? `${inbox.commentsPulled} comments pulled`
          : "— Connect to see inbox stats";

    return [
      {
        title: "Video Studio",
        subtitle:
          "Record your story — Build in Public segments, teleprompter, daily video.",
        statLine: studioStat,
        nudge: "Record today to keep your streak",
        href: storytrackUrl,
        cta: "Open Video Studio",
        external: true,
      },
      {
        title: "Clip Stitch",
        subtitle:
          "Already have multiple video files? Combine them, then open Multiplier.",
        statLine: stitchStat,
        nudge: "Combine your takes in one click",
        href: "/stitch",
        cta: "Combine clips",
      },
      {
        title: "Multiplier",
        subtitle: "Turn one video into carousel, reel, image post, and X/Threads.",
        statLine: multiplyStat,
        nudge: "Turn your next video into 5 posts",
        href: "/multiplier",
        cta: "Open Multiplier",
      },
      {
        title: "Calendar",
        subtitle: "Schedule and publish to your connected channels.",
        statLine: scheduleStat,
        nudge: "Schedule your next post",
        href: "/schedule",
        cta: "Open calendar",
      },
      {
        title: "Comment Converter",
        subtitle: "Reply and capture video ideas & product feedback in ~10 minutes.",
        statLine: inboxUrl ? inboxStat : "— Set NEXT_PUBLIC_COMMENT_INBOX_URL",
        nudge: "10 minutes to turn comments into customers",
        href: inboxUrl ?? "#",
        cta: inboxUrl ? "Open inbox" : "Configure URL",
        external: Boolean(inboxUrl),
      },
      {
        title: "Influencer outreach",
        subtitle: "Track collabs, DMs, and partnership opportunities.",
        statLine: "Coming soon",
        nudge: "In development",
        href: "#",
        cta: "Coming soon",
        muted: true,
      },
    ];
  }, [
    storytrack,
    streak,
    videosThisWeek,
    periodMetrics,
    postsScheduled,
    postsPublished,
    inbox,
    storytrackUrl,
    inboxUrl,
  ]);

  const displayName =
    user?.firstName ||
    user?.fullName?.split(" ")[0] ||
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ||
    "there";

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 pb-16">
      <header className="mb-6">
        <h1 className="font-serif text-3xl font-semibold text-[var(--bd-ink)] tracking-tight">
          BuildDaily
        </h1>
        <p className="mt-2 text-stone-600">
          Hi {displayName} — your creator system from blank page to scheduled posts.
        </p>
      </header>

      <HubAggregateStats
        period={period}
        onPeriodChange={setPeriod}
        streak={streak}
        videosRecordedThisWeek={videosThisWeek}
        clipsStitched={periodMetrics.clipsStitched}
        postsMade={periodMetrics.videosMultiplied}
        postsScheduled={postsScheduled}
        storytrackUrl={storytrackUrl}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <VideoStudioPanel
            summary={storytrack}
            linked={storytrackLinked}
            storytrackBaseUrl={storytrackUrl}
          />
        </div>
        <div className="lg:col-span-2">
          <HubQuickStats
            postsScheduled={postsScheduled}
            postsPublished={postsPublished}
            clipsStitched={
              period === "week"
                ? periodMetrics.clipsStitched
                : metrics.clipsStitched
            }
            postsMade={
              period === "week"
                ? periodMetrics.videosMultiplied
                : metrics.videosMultiplied
            }
          />
        </div>
      </div>

      <div className="mt-6">
        <ContinueBanner item={continueItem} />
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500 mb-4">
          Tools
        </h2>
        <ToolLauncherGrid cards={toolCards} />
      </section>

      <CommonPaths />
    </main>
  );
}
