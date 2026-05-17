import { MetaGraphError } from "./errors";

/** Opt-in for passing `scheduled_publish_time` to Instagram Content Publishing (partner / allowlisted apps). */
export function instagramNativeScheduleEnvEnabled(): boolean {
  const v = process.env.META_INSTAGRAM_NATIVE_SCHEDULE?.trim().toLowerCase();
  return v === "true" || v === "1";
}

/**
 * Meta often responds with (#3) User must be on whitelist when `scheduled_publish_time`
 * is sent to Instagram `/media` unless the app is in an approved scheduling program.
 * Facebook Page `/{page-id}/feed` scheduling is separate and does not use this gate.
 */
export function assertInstagramFuturePublishSupported(
  publishInstagram: boolean,
  scheduledPublishTime: number | undefined
): void {
  if (!publishInstagram) return;
  if (scheduledPublishTime == null || !Number.isFinite(scheduledPublishTime)) {
    return;
  }
  if (instagramNativeScheduleEnvEnabled()) return;
  throw new MetaGraphError({
    error: {
      message:
        'Instagram native scheduling is not enabled for this server. Meta usually returns "(#3) User must be on whitelist" when scheduled_publish_time is sent to Instagram unless your app is allowlisted for that feature. Fix: for calendar sends, turn **Instagram off** and keep **Facebook on** to use native Page scheduling; or publish to Instagram **without** a future time (immediate). If Meta has explicitly enabled native IG scheduling for your app, set META_INSTAGRAM_NATIVE_SCHEDULE=true in .env.',
    },
  });
}
