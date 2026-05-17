# BuildDaily Dashboard

Unified creator hub for BuildDaily — deploy at `app.builddaily.app`.

- **`/`** — Hub (Video Studio panel, tool launcher, cross-tool metrics)
- **`/multiplier`** — Content Multiplier (one video → carousel, reel, image post, X/Threads)
- **`/stitch`** — Clip Stitch (combine raw clips → Multiplier)
- **`/schedule`** — Calendar

Video Studio (StoryTrack) is a separate app; link via `NEXT_PUBLIC_STORYTRACK_URL`. See [docs/HUB.md](docs/HUB.md) for environment variables and Clerk metadata.

## Develop

```bash
npm install
npm run dev
```
