# Video Refresher

## What This Is

A browser-based batch video variation generator that takes an uploaded video creative and produces multiple unique "refreshed" variations with random visual effects (rotation, brightness, contrast, saturation) ready for ad platform rotation. It runs entirely client-side using FFmpeg.wasm 0.12.x with multi-threading support and is deployed on Cloudflare Pages.

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
- ✓ User can specify number of variations (1-20) via number input — v1.0
- ✓ Each variation receives unique random effect combination — v1.0
- ✓ All variations downloadable as single ZIP file — v1.0
- ✓ Processing speed optimized with ultrafast preset and buffer reuse — v1.0
- ✓ Memory management with BlobURLRegistry, bounded arrays, eviction — v1.0
- ✓ FFmpeg instance recovery from corruption errors — v1.0

### Active

(None — define in next milestone)

### Out of Scope

- Server-side video processing — keeping it fully client-side, no backend
- Video format support beyond MP4 — MP4 is standard for ad platforms
- Persistent video history across sessions — session-based is sufficient
- User accounts or authentication — single-user local tool
- Mobile app — web-only
- Manual effect selection per variation — defeats "quick refresh" value prop
- Variation comparison UI — memory nightmare with 20 video blobs in DOM

## Context

- FFmpeg.wasm 0.12.14 with multi-threading via SharedArrayBuffer + automatic single-threaded fallback
- Self-hosted FFmpeg class worker (ffmpeg-worker.js) for CORS-safe loading
- All processing client-side in WebAssembly — constrained by browser memory (~100-200MB per file)
- Batch processing: sequential variations with buffer reuse and orchestration-layer cancellation
- 1,785 LOC across app.js (1001), styles.css (497), index.html (105), ffmpeg-worker.js (182)
- No automated tests — app.js untested
- Known tech debt: XSS risk from innerHTML with filenames, growing app.js may benefit from module splitting

## Constraints

- **Platform**: Must remain a static site deployable to Cloudflare Pages — no server-side processing
- **Browser**: Requires SharedArrayBuffer support (Chrome, Firefox, Edge — latest versions)
- **CDN**: FFmpeg loaded from jsdelivr CDN — application non-functional without CDN access
- **Memory**: Browser memory limits processing to ~100MB files; variations multiply memory pressure
- **File format**: MP4 input and output only

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep processing client-side | No backend infrastructure to maintain, zero hosting costs beyond static CDN | ✓ Good |
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

---
*Last updated: 2026-02-07 after v1.0 milestone*
