# Content Multiplier — Features & Functions

This document describes what the tool does, how data flows through it, and where behavior lives in the codebase. It covers the **main studio** (carousel + image post + X/Threads copy + optional Video to Short), **scheduling**, **Meta publish**, and supporting APIs.

---

## Overview

**Content Multiplier** is a Next.js application that:

1. **Transcribes** uploaded video audio (OpenAI Whisper), typically **once per processing bundle**, then reuses segments for downstream steps.
2. **Classifies** a recommended social-carousel format (GPT) and **generates** slide plans (headlines, body, evidence segment IDs).
3. **Renders** a dual-format ZIP: **YouTube 1:1** and **Instagram 4:5** PNG carousels (`lib/pipeline.ts` → `renderSlidesToZip`).
4. **Generates** a single-frame **4:5 image post** (hook, micro-CTA, caption, alt text) from the same transcript (`lib/pipeline-image-post.ts`).
5. **Generates** **X (Twitter) thread + Threads** post drafts from the transcript (`lib/llm-twitter-threads.ts`) — text only; no auto-post.
6. **Optionally** sends the upload to a separate **Video to Short** API for a captioned vertical reel (`lib/run-video-to-short.ts`); carousel/image always use the **original** upload, not the Short export.
7. Lets users **schedule** posts in a local calendar UI and **publish** carousels, single photos, or reels to **Meta** (Instagram/Facebook Page) when configured.

Heavy work runs on the **Node.js** server (FFmpeg, canvas). The browser uploads files, holds queue state, and displays previews; ZIP/image data travel as base64 for the client.

---

## User-facing features (web UI)

### Home (`/`)

| Feature | Description |
|--------|-------------|
| **Video upload** | Multiple files supported; **queue** processes **one job at a time**. Lenient file acceptance (`video/*`, missing MIME, `application/octet-stream`, common extensions). |
| **Queue** | Per-item status: pending, processing, done, error. Progress text during processing. Click a row to switch the **active** snapshot. |
| **Studio tabs** | **Carousel** — slide viewer, YouTube/Instagram preview toggle, AI **social caption** for IG/FB-style posts. **Image post** — `ImagePostStudioPanel` (PNG preview, edit hook/caption, regenerate copy, re-render overlay). **X / Threads** — `SocialMicroPanel` (thread + Threads drafts, copy buttons, regenerate). **Short** — appears when a Short output file exists; preview MP4, optional re-process with instructions. |
| **Refine (on home)** | `RefinePanel` (accordion): zip download, re-render slides, slide copy edits, link to full-screen **`/refine`**. |
| **Generate / defaults** | User can re-run processing with current layout/post-type/background choices; may **reuse in-memory transcript** to skip a second `/api/transcribe` when slides already exist. |
| **Downloads** | Carousel **ZIP**, image **PNG**, **download all ZIPs** when ≥2 queue items are done. |
| **Schedule → Meta** | Modal/drawer to pick time, caption, IG/FB toggles, content kind (carousel vs single photo vs short reel). Uses `ScheduleProvider` + Meta client helpers. |
| **Process timing** | Optional footer with server upload ingest, server pipeline, browser bundle, or full queue timings when available. |
| **Nav** | Links to **Settings**, **Schedule**, optional **Video to Short** external URL (`NEXT_PUBLIC_VIDEO_TO_SHORT_URL`). |

### Schedule (`/schedule`)

| Feature | Description |
|--------|-------------|
| **Calendar** | Month grid; drag from queue (custom MIME + JSON payload) onto a day to add a scheduled row. |
| **Stored posts** | `ScheduledCarouselPost` in **localStorage** (`video-studio-scheduled-carousels-v1`): caption, time, slide thumbs (JPEG data URLs), content kind, display hook. |
| **Publish** | Resolves live snapshot from `queueSnapshots` + active workspace; calls Meta publish routes (multipart carousel, photo, or reel). |

### Settings (`/settings`)

| Feature | Description |
|--------|-------------|
| **Copy context** | Brand/voice text merged into LLM calls (carousel, image post, social micro), capped by `MAX_COPY_CONTEXT_CHARS`. |
| **Reference sources** | Optional notes for image-post richness. |
| **Copy feedback** | Stored feedback field for regenerations where supported. |
| **Learned from edits** | Append-only blob built when user edits carousel/image text and rebuilds; merged with copy context for future generations (`lib/learned-from-edits.ts`). |
| **Frame tone** | Light / color / warmth sliders sent as JSON on process, render, image-post, and social routes (`lib/tone-settings.ts`). |

### Edit Carousel (`/refine`)

Full-screen editor: background source, layout, post type, slide copy, **Update Carousel** (full pipeline vs slide-only re-render per UI). Same dual-format ZIP semantics as home. Redirects to `/` if there is no recommendation/snapshot to edit.

### Image post only (`/image-post`)

Standalone page with its **own** queue: processes videos through **`/api/image-post/process`** only (no carousel ZIP, no social micro in that flow). Optional batch download of post assets as ZIP (`lib/download-posts-zip.ts`). Uses Settings storage for copy context / learnings where applicable.

---

## Transcription strategy (main studio)

- **`postCarouselAndImagePost`** (in `context/carousel-workspace-context.tsx`): either reuses `existingTranscript` or calls **`POST /api/transcribe`** **once**, then runs in **`Promise.allSettled`**: **`POST /api/process`** (with `reuseTranscription` + transcript), **`POST /api/image-post/process`** (reuse transcript), and **`POST /api/social-micro/generate`** (JSON body transcript only — no Whisper on that route).
- **Queue loop**: starts **Video to Short** job in parallel with waiting on **`postVideoTranscript`** once, then **`postCarouselAndImagePost`** with that transcript. Short backend may run its **own** ASR; it does not consume this app’s transcript.
- **`POST /api/render`**: uses client-provided transcript JSON for timing/evidence; **no** new Whisper pass.

---

## ZIP contents (`{basename}_carousel.zip`)

Unchanged layout:

| Path | Size | Typical use |
|------|------|-------------|
| `youtube_1x1/slide_01.png` … | **1080 × 1080** | YouTube / square |
| `instagram_4x5/slide_01.png` … | **1080 × 1350** | Instagram feed portrait |

Download naming: `{sanitized basename}_carousel.zip` (see `carouselZipFilename` in context).

---

## Client workspace (`context/carousel-workspace-context.tsx`)

- **Queue** — `VideoQueueItem[]`: `file`, `status`, `error`, `progress`, optional `shortOutputFile`, `shortJobId`.
- **Snapshots** — `Record<queueId, QueueCarouselSnapshot>` so switching rows restores carousel, image post, and social drafts.
- **`QueueCarouselSnapshot`** includes: `recommendation`, `effectiveType`, `editableSlides`, `transcript`, `durationSec`, `zipBase64`, preview base64s (YouTube + optional Instagram), `socialCaption`, `layoutId`, `carouselOverride`, `backgroundSource`, `backgroundFile`, **`imagePost`**, **`imagePostError`**, **`socialMicro`**, **`socialMicroError`**, **`processTiming`**.
- **Actions** — `generateCarousel`, `reRenderZip`, `regenerateImagePostCopy`, `regenerateSocialMicro`, `patchImagePost`, `rerenderImagePostOverlay`, `reprocessActiveShortOutput`, `flushActiveQueueSnapshot`, downloads, Meta-related state lives on **`app/page.tsx`** / schedule page but snapshots feed scheduling.

---

## Processing pipelines

### Carousel — `lib/pipeline.ts` (`runPipeline`)

1. **Duration** — `probeDurationSec` (`lib/ffmpeg.ts`).
2. **Transcript** — If `existingTranscript` is non-empty, **skip** `transcribeVideoFile`. Else extract audio → Whisper (`lib/transcribe-video-file.ts` / `lib/transcribe.ts`). Stub mode uses stub transcript when not reusing.
3. **Recommendation** — `recommendCarouselType` (`lib/llm.ts`).
4. **Slides** — `generateSlides` (`lib/llm.ts`); hook voice appendix `lib/hook-voice.ts`.
5. **Keyframes** — `normalizeSlidesForKeyframes` (`lib/slide-evidence.ts`).
6. **ZIP** — `renderSlidesToZip` (`lib/render-zip.ts`): both aspect ratios, `renderSlideToPng` (`lib/render.ts`).

### Image post — `lib/pipeline-image-post.ts` (`runImagePostPipeline`)

Same transcript reuse pattern: optional `existingTranscript` skips Whisper. **`generateImagePost`** (`lib/llm-image-post.ts`) → frame time from evidence → **`renderImagePostToBuffer`**. Invoked from **`POST /api/image-post/process`**.

### X / Threads social micro — `lib/llm-twitter-threads.ts`

- **`generateSocialMicroFromTranscript`**: GPT JSON → `twitterThread[]`, `threadsPosts[]`, `threadsVisualSuggestion` (length clamps 280 / 500; **`sanitizeSocialPostText`** strips common artifacts).
- Playbook: **`lib/prompts/twitter-threads-playbook.ts`**.
- **`POST /api/social-micro/generate`**: JSON body `transcript` + optional `copyContext`; stub when `USE_STUB_LLM`.

### Stub mode

`USE_STUB_LLM=true` (or `1`): stub transcript/slides/carousel caption where applicable; social micro uses **`stubSocialMicroFromTranscript`**. OpenAI key still required for routes that don’t stub unless stub is wired for that path (see each route).

---

## Keyframe timing (`slideTimestampSec`)

Unchanged — see `lib/slide-time.ts` (midpoint of evidence segments, spread when degenerate, `effectiveDurationSec`).

---

## Rendering & export

Unchanged at a high level — `lib/ffmpeg.ts`, `lib/render.ts`, `lib/render-zip.ts`, branding `lib/branding.ts`, fonts `lib/fonts.ts`.

---

## UI previews from ZIP

Unchanged — `lib/zip-slide-previews.ts` (`extractCarouselSlidePreviewsFromZip`, …).

---

## HTTP API (summary)

| Route | Role |
|--------|------|
| **`POST /api/transcribe`** | Multipart `video` → Whisper segments + duration (`maxDuration` 300s). |
| **`POST /api/process`** | Full carousel pipeline; multipart fields per table below (`maxDuration` 300s). |
| **`POST /api/render`** | Re-render ZIP from edited `slides` + `transcript` JSON (`maxDuration` 300s). |
| **`POST /api/image-post/process`** | Image post PNG + plan; supports `reuseTranscription` + `transcript` (`maxDuration` 300s). |
| **`POST /api/image-post/render-post`** | Re-composite image with new hook/microCta text (`maxDuration` 120s). |
| **`POST /api/social-micro/generate`** | JSON: `transcript`, optional `copyContext` (`maxDuration` 120s). |
| **`GET /api/video-to-short/status`** | Integration flags / backend reachability for UI. |
| **`POST /api/video-to-short/jobs`** | Create Short job (proxies to `VIDEO_TO_SHORT_API_URL`). |
| **`GET …/jobs/[id]`**, **`GET …/download`**, **`POST …/reprocess`** | Job status, download Short file, reprocess with new text options. |
| **`GET /api/integrations/meta/status`** | Whether Meta env is configured + optional limit summary. |
| **`GET /api/integrations/meta/verify`** | Lightweight Graph check. |
| **`POST /api/integrations/meta/publish`** | Carousel or photo publish (multipart / session flow). |
| **`POST /api/integrations/meta/publish/*`** | `init`, `part`, `finalize` for chunked carousel uploads when used. |
| **`POST /api/integrations/meta/publish-reel`** | Reel video upload path. |

### `POST /api/process` (multipart)

| Field | Required | Description |
|-------|----------|-------------|
| `video` | Yes | Video file. |
| `background` | No | Static background image (per-format cover crop in ZIP). |
| `title`, `hint` | No | LLM steering (UI may omit). |
| `layoutId` | No | `stacked_center` or `split_lower_third`. |
| `brandingId` | No | Preset id; default `default`. |
| `carouselType` | No | Override one of four `CarouselType` values. |
| `reuseTranscription` | No | `1` / `true` + non-empty `transcript` JSON → **skip Whisper** on server. |
| `transcript` | When reuse | JSON array `{ id?, text, startSec, endSec }`. |
| `copyContext` | No | Merged brand/voice text (capped). |
| `frameTone` | No | JSON string; frame/light adjustments. |

Response includes `recommendation`, `effectiveType`, `transcript`, `slides`, `durationSec`, `zipBase64`, `firstSlidePreviewBase64`, `socialCaption`, timing fields when implemented in route.

### `POST /api/render` (multipart)

| Field | Required | Description |
|-------|----------|-------------|
| `video` | Yes | Same source video. |
| `background` | No | Same as process. |
| `slides` | Yes | JSON slide array. |
| `transcript` | Yes | JSON segments. |
| `layoutId`, `brandingId`, `frameTone` | No | Same semantics as process. |

### `POST /api/image-post/process` (multipart)

Key fields: `video`, optional `background`, `reuseTranscription` + `transcript`, `copyContext`, `copyFeedback`, `previousPlan` (JSON for regeneration), `referenceSources`, `frameTone`. Returns plan fields + `imageBase64` + transcript + timings.

### `POST /api/social-micro/generate` (JSON)

Body: `{ "transcript": [...], "copyContext?": "..." }`. Returns `{ twitterThread, threadsPosts, threadsVisualSuggestion }` or `{ error }`.

---

## Meta publishing (conceptual)

- **Server** — `lib/meta/publish.ts` and route handlers under `app/api/integrations/meta/*` use **`META_PAGE_ACCESS_TOKEN`**, **`META_PAGE_ID`**, optional **`META_GRAPH_API_VERSION`** (default `v21.0`).
- **Limits** — `META_PUBLISH_MAX_BODY_BYTES`, `META_REEL_MAX_BODY_BYTES` (see `lib/meta/publish-limits.ts`; Vercel defaults noted in code).
- **Client** — `lib/meta/publish-meta-client.ts` orchestrates init/part/finalize or single-shot flows from `app/page.tsx` and `app/schedule/page.tsx`.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Whisper + GPT (required unless stub-only paths). |
| `USE_STUB_LLM` | `true` / `1` — stub LLM/transcript/slides/social where implemented. |
| `MAX_UPLOAD_MB` | Upload cap while streaming to disk (1–2000, default 500). |
| `VIDEO_TO_SHORT_API_URL` | Base URL for Short FastAPI backend (studio proxies job create/status/download/reprocess). |
| `VIDEO_TO_SHORT_INTEGRATION` | Set `false` to disable Short server-side. |
| `NEXT_PUBLIC_SKIP_VIDEO_TO_SHORT` | Client skips Short calls; uses raw file for “short” slot behavior. |
| `NEXT_PUBLIC_VIDEO_TO_SHORT_URL` | Optional link to Short **web** app (new tab). |
| `META_PAGE_ACCESS_TOKEN` | Meta Page access token for publish. |
| `META_PAGE_ID` | Meta Page id. |
| `META_GRAPH_API_VERSION` | Optional Graph version string. |
| `META_PUBLISH_MAX_BODY_BYTES` | Override per-request body limit for carousel/photo chunks. |
| `META_REEL_MAX_BODY_BYTES` | Override reel upload body limit. |

See **`.env.example`** for templates; Meta vars are documented in code errors and above.

---

## NPM scripts

| Script | Command |
|--------|---------|
| `clean` | Deletes `.next`. |
| `dev` | Next.js dev server. |
| `build` | Production build. |
| `start` | Production server. |
| `lint` | ESLint. |

---

## Core modules (function-level map)

| Module | Role |
|--------|------|
| `context/carousel-workspace-context.tsx` | Queue, snapshots, `postProcessAndBuildSnapshot`, `postCarouselAndImagePost`, `postVideoTranscript`, `postSocialMicroFromTranscript`, image post helpers, `generateCarousel`, `reRenderZip`, regenerates, Short reprocess, downloads. |
| `context/schedule-context.tsx` | Scheduled posts + localStorage persistence. |
| `lib/pipeline.ts` | `runPipeline` — carousel transcribe → LLM → ZIP. |
| `lib/pipeline-image-post.ts` | `runImagePostPipeline` — image post. |
| `lib/llm-twitter-threads.ts` | Social micro JSON generation + stub + sanitize/clamp. |
| `lib/prompts/twitter-threads-playbook.ts` | System prompt rules for X vs Threads. |
| `lib/llm.ts` | Carousel classification + slide JSON. |
| `lib/llm-image-post.ts` | Image post plan generation. |
| `lib/transcribe-video-file.ts` / `lib/transcribe.ts` | Whisper with segments. |
| `lib/hook-voice.ts` | Hook-friendly copy appendix. |
| `lib/learned-from-edits.ts` | Merge learnings with copy context; diff baselines for carousel/image. |
| `lib/copy-context.ts`, `lib/copy-feedback.ts`, `lib/reference-sources.ts` | Settings storage keys + caps. |
| `lib/tone-settings.ts` | Frame tone JSON for APIs. |
| `lib/run-video-to-short.ts` | Create job, poll, download, reprocess. |
| `lib/meta/publish.ts`, `lib/meta/publish-meta-client.ts`, `lib/meta/publish-limits.ts` | Server + client Meta publish. |
| `lib/schedule/*` | Calendar thumbs, caption helpers, Meta slide prep from snapshots. |
| `lib/slide-evidence.ts`, `lib/slide-time.ts` | Evidence + timestamps. |
| `lib/ffmpeg.ts`, `lib/render.ts`, `lib/render-zip.ts` | Media + compositing + ZIP. |
| `lib/zip-slide-previews.ts` | Client preview extraction from ZIP base64. |
| `lib/types.ts` | Shared types including `SocialMicroSnapshot`, `ImagePostPlan`, etc. |
| `app/page.tsx` | Main studio UI, tabs, schedule drawer, Meta publish. |
| `app/schedule/page.tsx` | Calendar scheduling + publish. |
| `app/settings/page.tsx` | Copy context, sources, learnings, tone. |
| `app/refine/page.tsx` | Full-screen carousel editor. |
| `app/image-post/page.tsx` | Standalone image-post-only queue. |
| `app/components/RefinePanel.tsx` | Home refine accordion. |
| `app/components/CarouselSlideViewer.tsx` | Slide viewer + optional caption editor. |
| `app/components/ImagePostStudioPanel.tsx` | Image post tab UI. |
| `app/components/SocialMicroPanel.tsx` | X / Threads tab UI. |
| `app/api/*/route.ts` | HTTP handlers listed above. |

---

## External dependencies (conceptual)

- **OpenAI** — Whisper + GPT (carousel, image post, social micro).
- **FFmpeg / ffprobe** — On server `PATH` (with macOS Homebrew fallbacks in code paths that probe binaries).
- **@napi-rs/canvas** — Server-side PNG rendering.
- **jszip** — ZIP assembly and client-side “download all zips”.
- **busboy** — Multipart streaming for uploads.
- **Video to Short** — Optional separate service (HTTP from Next routes + browser polling).
- **Meta Graph API** — Optional publish when env configured.

---

## Limits & operational notes

- Route **`maxDuration`** values: **300s** for heavy routes (`/api/process`, `/api/render`, `/api/transcribe`, `/api/image-post/process`, Meta publish/reel); **120s** for `/api/social-micro/generate` and `/api/image-post/render-post`; Video-to-Short **reprocess** 60s (see each `route.ts`).
- **Video uploads** stream to temp disk; **`MAX_UPLOAD_MB`** cap; temp dirs removed in **`finally`** after process/render.
- **ZIP / image base64** in JSON responses use server RAM; dual-format carousels mean **two** PNG sets per run.
- **`next.config.ts`** may set large body limits for experiments; production publish prefers chunked multipart per Meta helpers.

---

## Known UX / edge cases

- Selecting a **queue item still processing** may show an empty workspace until a snapshot exists; switch back to a **done** item to see prior results.
- If **Instagram** preview list is empty while **YouTube** previews exist, the UI falls back to YouTube for the aspect toggle.
- **Social micro** and **image post** failures are **non-fatal** to the carousel in `Promise.allSettled`; errors surface in UI per tab (`imagePostError`, `socialMicroError`).
- **Short** requires backend job retention for **reprocess**; if the job is gone, user must re-upload.

For install and quick start, see **`README.md`**.
