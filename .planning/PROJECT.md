# Video Refresher

## What This Is

A browser-based tool that takes uploaded video creatives and applies random visual effects (zoom, color shift, noise, speed changes, mirroring) to produce "refreshed" variations that appear unique to ad platforms. It runs entirely client-side using FFmpeg.wasm and is deployed on Cloudflare Pages.

## Core Value

Upload one video creative, get multiple unique variations ready for ad platform rotation — fast and without leaving the browser.

## Requirements

### Validated

- ✓ Upload MP4 video files via click or drag-and-drop — existing
- ✓ Apply random visual effects (zoom, color, noise, speed, mirror) to videos — existing
- ✓ Preview original and processed videos in browser — existing
- ✓ Download individual processed videos — existing
- ✓ Queue multiple files for sequential processing — existing
- ✓ Progress indication during processing — existing
- ✓ File size validation with user warnings (>100MB) — existing
- ✓ Deployed to Cloudflare Pages with required COOP/COEP headers — existing

### Active

- [ ] User can specify number of variations to generate from a single upload (number input field)
- [ ] Each variation receives a different random combination of effects
- [ ] All variations downloadable as a single ZIP file
- [ ] Processing speed optimized — reduce per-video processing time
- [ ] Memory management improved — revoke blob URLs, clean up processed video state
- [ ] FFmpeg instance lifecycle hardened — recovery from partial failures

### Out of Scope

- Server-side video processing — keeping it fully client-side, no backend
- Video format support beyond MP4 — MP4 is standard for ad platforms
- Persistent video history across sessions — session-based is sufficient
- User accounts or authentication — single-user local tool
- Mobile app — web-only

## Context

- Existing codebase uses FFmpeg.wasm 0.11.6 (outdated, released ~2021). Newer versions (0.12.x+) have better memory management
- All processing happens client-side in WebAssembly — constrained by browser memory (~100-200MB per file)
- Current architecture processes one video at a time sequentially via a queue
- Typical use case: 5-20 variations per uploaded creative
- No automated tests exist — all 523 lines of app.js are untested
- Known concerns: memory leaks from unreleased blob URLs, XSS risk from innerHTML with filenames, race conditions in queue processing

## Constraints

- **Platform**: Must remain a static site deployable to Cloudflare Pages — no server-side processing
- **Browser**: Requires SharedArrayBuffer support (Chrome, Firefox, Edge — latest versions)
- **CDN**: FFmpeg loaded from esm.sh/unpkg.com CDNs — application non-functional without CDN access
- **Memory**: Browser memory limits processing to ~100MB files; variations multiply memory pressure
- **File format**: MP4 input and output only

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep processing client-side | No backend infrastructure to maintain, zero hosting costs beyond static CDN | — Pending |
| ZIP download for bulk variations | User processes 5-20 variations; individual downloads impractical at scale | — Pending |
| Random effect mix per variation | Each variation needs to appear unique to ad platform algorithms | — Pending |

---
*Last updated: 2026-02-06 after initialization*
