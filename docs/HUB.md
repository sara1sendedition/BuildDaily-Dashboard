# BuildDaily Hub

The hub lives at `/` on `app.builddaily.app`. Multiplier is at `/multiplier`.

## Environment variables

```bash
# Video Studio (StoryTrack)
NEXT_PUBLIC_STORYTRACK_URL=http://localhost:3000
STORYTRACK_API_URL=http://localhost:3000
HUB_STORYTRACK_SECRET=shared-secret-with-storytrack
# Optional dev shortcut when Clerk metadata is not set:
HUB_STORYTRACK_USER_ID=supabase-auth-user-uuid

# Comment Converter
NEXT_PUBLIC_COMMENT_INBOX_URL=http://localhost:3010
COMMENT_INBOX_API_URL=http://localhost:3010
HUB_COMMENT_INBOX_SECRET=shared-secret
```

## Clerk public metadata (optional)

- `storytrackUserId` — Supabase `auth.users.id` for StoryTrack hub stats on `/`.
- `commentInboxWorkspaceId` — Comment Converter workspace id for inbox stats proxy.

## StoryTrack

Deploy StoryTrack (e.g. `studio.builddaily.app`) and set the same `HUB_STORYTRACK_SECRET` on both apps. StoryTrack exposes `GET /api/hub/summary?userId=…` with `Authorization: Bearer <secret>`.

## Metrics

Lifetime counters (`clipsStitched`, `videosMultiplied`) are stored in browser `localStorage` (`builddaily-hub-metrics-v1`). Scheduled post counts are derived from `video-studio-scheduled-carousels-v1` and the publish daemon file.
