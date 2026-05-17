export type HubWeekStripCell = {
  date: string;
  shortLabel: string;
  complete: boolean;
  isToday: boolean;
};

export type StoryTrackHubSummary = {
  streak: number;
  weekStrip: HubWeekStripCell[];
  videosRecordedThisWeek: number;
  totalRecordingDays: number;
  activeChallenge?: {
    title: string;
    day: number;
    totalDays: number;
  };
  recordTodayUrl: string | null;
};

export type CommentConverterHubStats = {
  commentsPulled: number;
  replies: number;
  directedSomewhere: number;
  connected: boolean;
};

export type HubLifetimeMetrics = {
  clipsStitched: number;
  videosMultiplied: number;
  weekBuckets?: Record<
    string,
    { clipsStitched: number; videosMultiplied: number }
  >;
};

export type HubClientStatus = {
  clipStitchHandoffReady: boolean;
  shortProcessing: boolean;
  shortReady: boolean;
  postsScheduledUpcoming: number;
  nextPublishAtUnix: number | null;
};

export type HubServerSummary = {
  postsScheduledUpcoming?: number;
  postsPublished: number;
  daemonUpcoming: number;
  metaConfigured: boolean;
  youtubeConfigured: boolean;
  shortBackendOk: boolean;
};

export type HubMergedState = {
  metrics: HubLifetimeMetrics;
  client: HubClientStatus;
  server: HubServerSummary | null;
  storytrack: StoryTrackHubSummary | null;
  storytrackLinked: boolean;
  commentConverter: CommentConverterHubStats | null;
};
