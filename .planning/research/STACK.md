# Technology Stack: v3.0 Hybrid Processing & Job Cancellation

**Project:** Video Refresher v3.0
**Research Focus:** Stack additions for hybrid client/server processing and job cancellation
**Researched:** 2026-02-07

## Overview

v3.0 adds two new capabilities to the existing v2.0 server-side architecture:

1. **Client-side processing option** - Re-introduce FFmpeg.wasm for device-side video processing
2. **Job cancellation** - Kill in-progress server FFmpeg processes on user request

This document covers ONLY the stack additions/changes needed for these features. The existing v2.0 stack (Express 5, better-sqlite3, native FFmpeg, Cloudflare Pages) remains unchanged.

---

## Client-Side Processing Stack

### Core: FFmpeg.wasm 0.12.x

| Package | Version | Purpose | Integration Point |
|---------|---------|---------|------------------|
| `@ffmpeg/ffmpeg` | **0.12.15** (latest) | Main FFmpeg.wasm library | Frontend ES modules (CDN) |
| `@ffmpeg/util` | **0.12.2** | Utilities (fetchFile, toBlobURL) | Frontend ES modules (CDN) |
| `@ffmpeg/core-mt` | **0.12.10** | Multi-threaded core | Loaded when SharedArrayBuffer available |
| `@ffmpeg/core-st` | **0.12.10** | Single-threaded core | Fallback when COOP/COEP missing |

**Why FFmpeg.wasm 0.12.15:**
- Already validated in v1.0 (used 0.12.14, current is 0.12.15)
- Only 0.12.x version change since v1.0 was bug fixes (no breaking changes)
- Multi-threading support with SharedArrayBuffer (10x faster than single-threaded)
- jsdelivr CDN proven reliable for wasm module delivery
- Self-hosting worker required (CDN blob URLs break ES module imports)

**Installation:**
```html
<!-- Import from jsdelivr CDN -->
<script type="module">
  import { FFmpeg } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/+esm';
  import { fetchFile, toBlobURL } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/+esm';
</script>
```

**Memory Transfer Gotcha (critical):**
v1.0 discovery: `ffmpeg.writeFile()` uses `postMessage` with transferable ArrayBuffers, which **neuters** the original buffer. Always pass `new Uint8Array(buffer)` when the buffer needs reuse. See commit 8cbd4b3.

**Confidence:** HIGH - v1.0 validated with 0.12.14, 0.12.15 is latest stable release.

**Sources:**
- [@ffmpeg/ffmpeg npm](https://www.npmjs.com/package/@ffmpeg/ffmpeg) - Version 0.12.15 confirmed
- [FFmpeg.wasm GitHub Releases](https://github.com/ffmpegwasm/ffmpeg.wasm/releases) - Release history

### ZIP Generation: JSZip

| Library | Version | Purpose | Integration Point |
|---------|---------|---------|------------------|
| JSZip | **3.10.1** (latest) | Browser ZIP generation | Frontend ES modules (CDN) |

**Why JSZip 3.10.1:**
- Already validated in v1.0
- Mature library (last update 2022, stable API)
- STORE compression mode (no re-compression of H.264 video)
- Stream-friendly for large file handling
- No better alternatives for browser-side ZIP

**Installation:**
```html
<script type="module">
  import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';
</script>
```

**Confidence:** HIGH - v1.0 validated, no breaking changes.

**Source:** [jszip npm](https://www.npmjs.com/package/jszip) - 3.10.1 confirmed

### Cross-Origin Isolation: COOP/COEP Headers

**Requirement:** SharedArrayBuffer (for multi-threaded FFmpeg.wasm) requires cross-origin isolation.

**Implementation:** Cloudflare Pages `_headers` file

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

**Why `_headers` file:**
- Native Cloudflare Pages feature (no Workers needed)
- Applies to all static assets automatically
- Already exists in project (was removed in v2.0, needs restoration)

**Confidence:** HIGH - Official Cloudflare Pages documentation confirms support.

**Source:** [Cloudflare Pages Headers Documentation](https://developers.cloudflare.com/pages/configuration/headers/)

### What NOT to Add

| Library | Why Not |
|---------|---------|
| Service worker COOP/COEP patches | Unnecessary - Cloudflare Pages `_headers` works natively |
| Separate build tools (Webpack, Vite) | Vanilla JS ES modules work directly, no bundling needed |
| WebAssembly polyfills | Target is modern browsers only (SharedArrayBuffer support) |
| Separate wasm hosting | jsdelivr CDN proven reliable in v1.0 |

---

## Server-Side Job Cancellation Stack

### Process Management

No new dependencies needed. Node.js built-ins are sufficient.

**Current implementation (v2.0):**
- `child_process.spawn()` for FFmpeg processes
- PID stored in `job_files.current_ffmpeg_pid` column (SQLite)
- Process handle returned from `spawnFFmpeg()` function

**What's needed for cancellation:**
1. Kill FFmpeg process by PID
2. Clean up partial output files
3. Update job status to 'cancelled'

### Option 1: `process.kill()` + stdin 'q' (Recommended)

**Approach:** Use Node.js built-in `process.kill()` with graceful 'q' command to FFmpeg stdin.

**Rationale:**
- Zero new dependencies
- FFmpeg gracefully closes files when sent 'q' to stdin
- `process.kill(pid, 'SIGTERM')` for forceful fallback
- Two-stage shutdown: try graceful, then forceful after timeout

**Implementation pattern:**
```javascript
// Graceful: Write 'q' to stdin (FFmpeg interactive quit)
ffmpegProcess.stdin.write('q\n');

// Forceful fallback after 5s timeout
setTimeout(() => {
  if (ffmpegProcess.exitCode === null) {
    process.kill(pid, 'SIGTERM');
  }
}, 5000);
```

**Why this works:**
- FFmpeg recognizes 'q' as interactive quit command
- Allows FFmpeg to close output file properly (avoid corruption)
- SIGTERM as fallback for stuck processes
- Node.js `process.kill()` is built-in (no deps)

**Confidence:** HIGH - Confirmed by Node.js FFmpeg community patterns.

**Sources:**
- [How to gently terminate FFmpeg](https://forums.raspberrypi.com/viewtopic.php?t=284030)
- [Recommended way to kill process (fluent-ffmpeg)](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/138)

### Option 2: tree-kill (Alternative)

**Package:** `tree-kill@1.2.2`

**What it does:** Kills process tree (parent + all children) with signal support.

**Why consider it:**
- Handles child processes spawned by FFmpeg (e.g., if FFmpeg spawns sub-processes)
- Works across platforms (Windows, Linux, macOS)
- Lightweight (no dependencies)

**Why NOT recommended for v3.0:**
- FFmpeg typically doesn't spawn sub-processes in this use case
- Built-in `process.kill()` is sufficient for single FFmpeg child process
- Adds dependency for edge case that likely won't occur
- Can add later if real-world usage shows FFmpeg spawning sub-processes

**If needed later:**
```bash
npm install tree-kill@1.2.2
```

```javascript
import kill from 'tree-kill';
kill(pid, 'SIGTERM');
```

**Confidence:** MEDIUM - Useful for complex scenarios, but overkill for current needs.

**Source:** [tree-kill npm](https://www.npmjs.com/package//tree-kill)

### Database Schema (Already Exists)

v2.0 already tracks FFmpeg PIDs in `job_files` table:

```sql
current_ffmpeg_pid INTEGER DEFAULT NULL
```

**No schema changes needed.** Cancellation logic can:
1. Query `job_files.current_ffmpeg_pid` for active job
2. Call `process.kill(pid, 'SIGTERM')`
3. Update `job_files.status = 'cancelled'`
4. Delete partial output files

---

## Integration Strategy

### Client-Side Processing Flow

1. User toggles "Process on device" on upload page
2. Frontend loads FFmpeg.wasm (CDN import)
3. Process videos in browser (same effects as v1.0)
4. Generate ZIP with JSZip (same as v1.0)
5. Download ZIP directly (no API call)

**Code reuse:** v1.0 client-side code can be largely reused. Key files from commit 8cbd4b3:
- `app.js` - FFmpeg.wasm initialization, progress handling
- `ffmpeg-worker.js` - Worker for multi-threaded mode (self-hosted)

**New code needed:**
- Toggle UI component
- Conditional routing (device vs server flow)
- Progress display unification (match v2.0 UX)

### Server-Side Cancellation Flow

1. User clicks "Cancel" on job detail page
2. Frontend calls `DELETE /api/jobs/:jobId` endpoint
3. Server queries `job_files.current_ffmpeg_pid` for job
4. Server writes 'q' to FFmpeg stdin (graceful shutdown)
5. Server waits 5s, then sends SIGTERM if still running
6. Server deletes partial output files
7. Server updates job status to 'cancelled'

**New API endpoint:**
```
DELETE /api/jobs/:jobId
Authorization: Bearer <token>
Response: 200 { message: "Job cancelled" }
```

**New server code:**
- `routes/jobs.js` - DELETE handler
- `lib/cancellation.js` - Process kill + cleanup logic

---

## Version Summary

### Frontend (No Changes to Dependencies)

FFmpeg.wasm and JSZip are loaded via CDN (no package.json changes).

### Backend (No New Dependencies)

| Package | Current Version | v3.0 Version | Change |
|---------|----------------|--------------|--------|
| express | 5.2.0 | 5.2.0 | No change |
| better-sqlite3 | 12.6.0 | 12.6.0 | No change |
| archiver | 7.0.1 | 7.0.1 | No change |
| cors | 2.8.5 | 2.8.5 | No change |
| multer | 2.0.2 | 2.0.2 | No change |
| nanoid | 5.0.0 | 5.0.0 | No change |

**No `npm install` needed for v3.0.**

Process cancellation uses Node.js built-ins (`child_process`, `process.kill()`).

---

## Configuration Changes

### Cloudflare Pages: `_headers` File

**Current state (v2.0):**
```
# Cloudflare Pages custom headers
# COOP/COEP removed - no longer needed without FFmpeg.wasm SharedArrayBuffer
```

**v3.0 change:**
```
# Cloudflare Pages custom headers
# COOP/COEP required for FFmpeg.wasm SharedArrayBuffer multi-threading
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

**Impact:**
- Enables SharedArrayBuffer for multi-threaded FFmpeg.wasm
- Required for device processing option
- No impact on server-side processing (API calls unaffected)

---

## Testing Considerations

### FFmpeg.wasm Browser Compatibility

| Feature | Requirement | Fallback |
|---------|------------|----------|
| SharedArrayBuffer | COOP/COEP headers | Single-threaded core (@ffmpeg/core-st) |
| WebAssembly | Modern browser | Unsupported (show error message) |
| File API | Modern browser | Unsupported (show error message) |

**Detection:**
```javascript
const supportsMultiThreading = typeof SharedArrayBuffer !== 'undefined' && crossOriginIsolated === true;
```

**Recommendation:** Show warning if SharedArrayBuffer unavailable ("Processing will be slower without multi-threading").

### Job Cancellation Edge Cases

| Scenario | Handling |
|----------|----------|
| Process already completed | Return 400 "Job already completed" |
| Process not yet started | Update status to 'cancelled', skip spawn |
| PID missing/invalid | Log error, clean up files, mark cancelled |
| SIGTERM fails | Force kill with SIGKILL after 10s timeout |

---

## Migration Path

### Phase 1: Restore Client-Side Processing
1. Restore `_headers` file with COOP/COEP
2. Copy v1.0 FFmpeg.wasm code (app.js, ffmpeg-worker.js)
3. Update to FFmpeg.wasm 0.12.15 (from 0.12.14)
4. Add processing mode toggle UI
5. Wire toggle to route between client and server flows

### Phase 2: Add Job Cancellation
1. Add DELETE `/api/jobs/:jobId` endpoint
2. Implement graceful shutdown (stdin 'q' + SIGTERM fallback)
3. Add cleanup for partial output files
4. Add "Cancel" button to job detail page
5. Handle edge cases (job completed, PID missing, etc.)

**No dependency installation needed.** All required libraries are either CDN-loaded (frontend) or Node.js built-ins (backend).

---

## Confidence Assessment

| Area | Confidence | Rationale |
|------|------------|-----------|
| FFmpeg.wasm 0.12.15 | **HIGH** | Already validated in v1.0 with 0.12.14, only bug fix release since |
| JSZip 3.10.1 | **HIGH** | Already validated in v1.0, stable API, no breaking changes |
| COOP/COEP headers | **HIGH** | Official Cloudflare Pages feature, documented and supported |
| Process.kill() cancellation | **HIGH** | Node.js built-in, confirmed pattern for FFmpeg graceful shutdown |
| tree-kill necessity | **MEDIUM** | Likely unnecessary, but available if sub-process issues arise |

---

## Open Questions

None. All stack decisions can be made with high confidence based on:
1. v1.0 validated FFmpeg.wasm implementation
2. v2.0 validated server-side FFmpeg spawning
3. Official documentation for Cloudflare Pages headers
4. Community-confirmed patterns for Node.js FFmpeg process management

---

## Sources

**FFmpeg.wasm:**
- [@ffmpeg/ffmpeg npm](https://www.npmjs.com/package/@ffmpeg/ffmpeg) - Version 0.12.15 confirmed
- [FFmpeg.wasm GitHub Releases](https://github.com/ffmpegwasm/ffmpeg.wasm/releases) - Release history

**JSZip:**
- [jszip npm](https://www.npmjs.com/package/jszip) - Version 3.10.1 confirmed

**Cross-Origin Isolation:**
- [Cloudflare Pages Headers Documentation](https://developers.cloudflare.com/pages/configuration/headers/)
- [Making your website cross-origin isolated using COOP and COEP](https://web.dev/articles/coop-coep)

**Job Cancellation:**
- [How to gently terminate FFmpeg](https://forums.raspberrypi.com/viewtopic.php?t=284030) - stdin 'q' pattern
- [Recommended way to kill process (fluent-ffmpeg)](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/138) - Community consensus
- [tree-kill npm](https://www.npmjs.com/package//tree-kill) - Alternative for complex scenarios

---

*Research completed: 2026-02-07*
*Ready for roadmap creation: YES*
