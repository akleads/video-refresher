# Video Refresher

## What This Is

A video variation generator for ad creative rotation. Upload multiple MP4 videos, specify how many variations you need, and get uniquely "refreshed" versions with random visual effects — all processed server-side with native FFmpeg on Fly.io. Small team tool with shared password access, temporary result storage (1GB / 24h), and single ZIP download for all outputs.

## Core Value

Upload video creatives, get multiple unique variations ready for ad platform rotation — fast, without waiting at the screen.

## Current Milestone: v2.0 Server-side Multi-video Processing

**Goal:** Move processing to a backend server and support multiple source videos in a single batch job.

**Target features:**
- Upload multiple videos at once, set variations per batch
- Server-side FFmpeg processing (close tab, come back to results)
- Live progress tracking or fire-and-forget workflow
- Temporary result storage with automatic eviction (1GB cap + 24h expiry)
- Single ZIP download with all variations organized by source video
- Shared password authentication for team access

## Requirements

### Validated

- ✓ Upload MP4 video files via click or drag-and-drop — existing
- ✓ Apply random visual effects (zoom, color, noise, speed, mirror) to videos — existing
- ✓ Preview original and processed videos in browser — existing
- ✓ Download individual processed videos — existing
- ✓ Queue multiple files for sequential processing — existing
- ✓ Progress indication during processing — existing
- ✓ File size validation with user warnings (>100MB) — existing
- ✓ Deployed to Cloudflare Pages with required COOP/COEP headers — v1.0
- ✓ User can specify number of variations (1-20) via number input — v1.0
- ✓ Each variation receives unique random effect combination — v1.0
- ✓ All variations downloadable as single ZIP file — v1.0
- ✓ Processing speed optimized with ultrafast preset and buffer reuse — v1.0
- ✓ Memory management with BlobURLRegistry, bounded arrays, eviction — v1.0
- ✓ FFmpeg instance recovery from corruption errors — v1.0

### Active

- [ ] Upload multiple source videos in a single batch
- [ ] Server-side FFmpeg processing on Fly.io
- [ ] Job queue with progress tracking (live + async polling)
- [ ] Temporary result storage with 1GB cap and 24-hour expiry
- [ ] Automatic eviction of oldest results when storage limit hit
- [ ] Single ZIP download with all variations organized by source video
- [ ] Shared password authentication for team access
- [ ] Fire-and-forget UX — close tab, return to results later

### Out of Scope

- Video format support beyond MP4 — MP4 is standard for ad platforms
- Mobile app — web-only
- Manual effect selection per variation — defeats "quick refresh" value prop
- Variation comparison UI — too complex for v2
- Individual user accounts — shared password sufficient for small team
- Persistent history beyond 24 hours — temporary storage is the model
- Real-time WebSocket streaming of video frames — progress percentage is enough

## Context

- v1.0 runs entirely client-side with FFmpeg.wasm 0.12.14 on Cloudflare Pages
- v2.0 moves processing to server-side native FFmpeg on Fly.io (10-50x faster than wasm)
- Frontend will talk to a backend API instead of running FFmpeg locally
- SQLite for job/session tracking — zero-cost, file-based on Fly Volume
- Fly.io persistent volume for temporary video file storage + SQLite database
- Docker container bundles Node.js + native FFmpeg
- Same random effect combinations from v1 (zoom, color, noise, speed, mirror)
- 1,785 LOC in v1 frontend across app.js, styles.css, index.html, ffmpeg-worker.js
- Known tech debt from v1: XSS risk from innerHTML, monolithic app.js

## Constraints

- **Platform**: Fly.io for backend, Cloudflare Pages for frontend (or co-host on Fly)
- **Cost**: Keep hosting costs low — small Fly machine + volume (~$5-10/month)
- **Storage**: 1GB total cap for processed videos + 24-hour auto-expiry
- **File format**: MP4 input and output only
- **Auth**: Shared password — no user management complexity
- **Team size**: Small team (< 10 people), no need for per-user quotas

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep processing client-side (v1) | No backend infrastructure to maintain, zero hosting costs beyond static CDN | ✓ Good |
| ZIP download for bulk variations | User processes 5-20 variations; individual downloads impractical at scale | ✓ Good |
| Random effect mix per variation | Each variation needs to appear unique to ad platform algorithms | ✓ Good |
| Use jsdelivr CDN for FFmpeg.wasm 0.12.x | Proven compatibility with worker files vs esm.sh | ✓ Good |
| Self-host FFmpeg class worker | CDN blob URLs break due to relative ES module imports in worker.js | ✓ Good |
| Cap processedVideos at 20 | Balances memory usage with user experience | ✓ Good |
| Ultrafast encoding preset for all videos | Speed over marginal quality for ad creative workflows | ✓ Good |
| Sequential batch processing | Avoid FFmpeg instance conflicts and CPU thrashing | ✓ Good |
| Orchestration-layer cancellation | FFmpeg.wasm 0.12.x doesn't expose mid-encoding abort API | ✓ Good |
| STORE compression for ZIP | Videos already H.264 compressed; re-compression wastes CPU | ✓ Good |
| Copy buffer before ffmpeg.writeFile | postMessage transfers neuter original ArrayBuffer | ✓ Good |
| Move to server-side FFmpeg (v2) | Workflow convenience — close browser, come back to results; also 10-50x faster | — Pending |
| Fly.io + SQLite | User already uses Fly.io; SQLite is zero-cost and sufficient for job tracking | — Pending |
| 1GB storage + 24h expiry | Keeps costs low, forces regular cleanup, sufficient for daily ad workflow | — Pending |
| Shared password auth | Small team, no need for user management complexity | — Pending |

---
*Last updated: 2026-02-07 after v2.0 milestone start*
