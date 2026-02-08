# Feature Landscape: Hybrid Client/Server Processing with Job Cancellation

**Domain:** Hybrid processing mode toggle (FFmpeg.wasm vs server-side) with job cancellation for existing video variation generator
**Researched:** 2026-02-07
**Confidence:** MEDIUM-HIGH (synthesized from web research on hybrid processing patterns, job cancellation UX, WebAssembly fallback strategies, and processing mode toggles; cross-verified with multiple sources)

## Research Context

This feature analysis focuses on **v3.0: hybrid client/server processing** for an existing video variation generator that already has:

**v1.0 (shipped 2026-02-07):** Client-side FFmpeg.wasm batch processing with ZIP download
**v2.0 (shipped 2026-02-08):** Server-side native FFmpeg on Fly.io with job queue, fire-and-forget workflow, multi-video upload, and 24h temporary storage

**v3.0 adds:**
1. **Processing mode toggle** on upload page: "Process on device" (FFmpeg.wasm) vs "Send to server" (Fly.io queue)
2. **Device processing** is self-contained: no job tracking, instant ZIP download (v1.0 behavior)
3. **Server processing** uses existing v2.0 queue flow with job history
4. **Job cancellation** for server jobs: kill FFmpeg process, clean up files
5. **User preference persistence**: remember last-used mode in localStorage

**Project constraints:**
- Existing server: Express 5 + SQLite + native FFmpeg on Fly.io
- Existing frontend: Vanilla JS SPA with hash routing (no framework)
- COOP/COEP headers restored for SharedArrayBuffer support (required for FFmpeg.wasm multi-threading)
- Small team tool (<10 users) with shared password auth
- Storage: 3GB Fly Volume with 24h auto-expiry + 85% cap eviction

## Table Stakes

Features users expect from hybrid processing mode and job cancellation. Missing these means the product feels broken or confusing.

| Feature | Why Expected | Complexity | Dependencies on Existing | Notes |
|---------|--------------|------------|--------------------------|-------|
| **Processing mode toggle (visible)** | Users must know they have a choice between device and server processing | Low | New UI component on upload page | Radio buttons, not toggle switch (see UX research below). Both options visible simultaneously |
| **Clear mode labels** | "Process on device" and "Send to server" must communicate privacy, speed, and persistence tradeoffs | Low | None | Labels should hint at consequences: "Process on device (private, stay on page)" vs "Send to server (faster, can close tab)" |
| **Remember user preference** | Users pick a mode once, expect it to stick across sessions | Low | New localStorage integration | Save to localStorage on mode change, load on page init. Standard pattern for settings |
| **Mode-specific UX flow** | Device mode shows progress bar → ZIP download. Server mode redirects to job page | Medium | Routes to existing v1.0 vs v2.0 flows | Device: inline progress, no job ID. Server: create job, redirect to `/jobs/:id` |
| **COOP/COEP headers restored** | FFmpeg.wasm requires SharedArrayBuffer for multi-threading (performance critical) | Low | Cloudflare Pages header config | Headers removed in v2.0, must be restored. Without these, FFmpeg.wasm falls back to single-threaded (10x slower) |
| **Job cancellation button** | Server jobs in "processing" state need a way to abort mid-processing | Medium | New UI element on job status page | "Cancel Job" button appears only when status is "processing". Disabled when "pending" or "completed" |
| **Graceful FFmpeg termination** | Killing FFmpeg mid-process must allow cleanup, not corrupt partial output | Medium | Server-side process management | Send SIGTERM before SIGKILL (2.5s grace period). FFmpeg writes stdin `q\r\n` for graceful stop |
| **Partial file cleanup** | Cancelled jobs should delete any partial variation files from storage | Medium | Extends existing cleanup daemon | Remove job directory from volume, mark job as "cancelled" in SQLite |
| **Cancelled job status** | Users return to cancelled job, see "Cancelled" state, not "Failed" or "Processing" | Low | Extends SQLite job states | New state: `CANCELLED`. Distinct from `FAILED` (error) and `EXPIRED` (24h timeout) |
| **No download for cancelled jobs** | Download link should return 410 Gone or hide entirely for cancelled jobs | Low | Extends existing download endpoint | `GET /jobs/:id/download` checks status, rejects if `CANCELLED` |
| **Cancellation confirmation** | Prevent accidental cancellation with "Are you sure?" dialog | Low | New UI modal or confirm() | Standard pattern: confirm before destructive action. "Cancel this job? This cannot be undone." |

## Differentiators

Features that elevate the hybrid processing experience from functional to polished. Not strictly required, but make v3.0 feel well-thought-out.

| Feature | Value Proposition | Complexity | Dependencies on Existing | Notes |
|---------|-------------------|------------|--------------------------|-------|
| **Automatic capability detection** | If WebAssembly/SharedArrayBuffer unavailable, auto-select server mode and explain why | Medium | New browser feature detection | Check `typeof WebAssembly !== 'undefined'` and `crossOriginIsolated === true`. Show notice: "Device processing unavailable on this browser. Using server mode." |
| **Mode recommendation badge** | Subtle UI hint: "Recommended for privacy" (device) or "Recommended for speed" (server) | Low | None | Helps new users understand tradeoffs without reading docs |
| **Processing time estimate per mode** | "Estimated 30 seconds on device, 5 seconds on server" before user chooses | Medium | New time estimation logic | Based on file size/count. Device: ~10s/video/variation. Server: ~1-2s. Helps inform mode choice |
| **Cancel + retry flow** | After cancelling, offer "Start New Job" button pre-filled with same files | Medium | Extends file state persistence | Keep uploaded File objects in memory until user leaves page. "Cancelled? Start over with same files." |
| **Cancel progress indicator** | Show "Cancelling job..." spinner while FFmpeg terminates | Low | New UI state | Prevents double-cancel clicks. Shows job is responding |
| **Cancellation reason (optional)** | Let user optionally note why they cancelled (wrong files, changed mind) | Low | New job metadata field | Helps team understand usage patterns. Not required, just a text input in cancel modal |
| **Partial results preservation option** | "Job cancelled. Keep variations created so far?" checkbox in cancel flow | High | New storage management logic | Complex: requires tracking which variations completed before cancel. Probably defer to post-v3.0 |
| **Server unavailable fallback** | If server returns 5xx, automatically switch to device mode with notification | Medium | New error handling | "Server unavailable. Switched to device processing." Graceful degradation |
| **Device battery check** | On mobile, warn if battery <20% before device processing starts | Low | New battery status API check | `navigator.getBattery()`. Show: "Low battery detected. Consider using server mode." (Mobile-first consideration) |

## Anti-Features

Features to explicitly NOT build. Common mistakes when adding hybrid processing modes.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Toggle switch for mode selection** | Toggle switches imply binary on/off settings with immediate effect. Processing mode is a choice between two distinct workflows, not a setting. Users need to see both options simultaneously to compare tradeoffs | Use radio buttons with descriptive labels. Both options visible at once. Selection applies on submit, not immediately |
| **Hybrid mode (split processing)** | "Process first 5 videos on device, rest on server" sounds clever but adds UI complexity, unpredictable results, and edge cases (what if device fails mid-batch?). Users want one consistent flow per job | Force mode choice before upload. One mode per job. Keep it simple |
| **Automatic mode switching mid-job** | Switching from device to server (or vice versa) after processing starts leads to inconsistent state, confusing UX, and complex error handling | Mode locked after processing starts. Cancel and restart if user wants different mode |
| **Per-video mode selection** | "Process video 1 on device, video 2 on server" in a multi-video batch is confusing and defeats the hybrid toggle's purpose | Single mode applies to all videos in a batch |
| **Pause/resume for device processing** | FFmpeg.wasm 0.12.x doesn't expose mid-encoding pause API. Orchestration-layer pause means user can't use browser for anything else (tab must stay open) | No pause for device mode. Cancel and restart if needed. Server mode already supports fire-and-forget |
| **Job cancellation for device processing** | Device processing is synchronous in the browser. "Cancel" already exists (stop batch loop). No need for job-style cancellation | Existing v1.0 cancel button works. Job cancellation is server-only |
| **Retry from checkpoint** | "Resume cancelled job from variation 7/10" requires storing partial state, complex recovery logic, and adds edge cases for minimal value | Full job restart. Cancellation means "start over." Keep it simple |
| **Cancel confirmation skip** | "Don't ask me again" checkbox on cancel confirmation is a foot-gun. Accidental cancellation loses work | Always confirm. No skip option. Confirmation dialog is 1 click, not a burden |
| **Queue priority for cancellation** | "Cancel immediately" vs "wait for current variation to finish" adds state complexity for marginal benefit | Cancellation starts immediately, kills FFmpeg with grace period. Current variation may finish if within 2.5s SIGTERM window |
| **Undo cancellation** | Once job is cancelled and files deleted, there's no meaningful undo. Storage cleanup is immediate | No undo. Cancellation is final. Confirmation dialog prevents mistakes |

## Feature Dependencies

```
COOP/COEP headers (Cloudflare Pages config)
    |
    v
SharedArrayBuffer support
    |
    v
FFmpeg.wasm multi-threading capability
    |
    v
Browser capability detection
    |
    +----> Processing mode toggle UI
    |           |
    |           +--> localStorage preference
    |           |
    |           +--> Device mode (v1.0 flow)
    |           |       |
    |           |       +--> FFmpeg.wasm processing
    |           |       |
    |           |       +--> ZIP download
    |           |
    |           +--> Server mode (v2.0 flow)
    |                   |
    |                   +--> POST /jobs (existing)
    |                   |
    |                   +--> Job status page (existing)
    |                           |
    |                           +--> Job cancellation button
    |                                   |
    |                                   +--> POST /jobs/:id/cancel (new endpoint)
    |                                   |       |
    |                                   |       +--> SIGTERM → FFmpeg
    |                                   |       |
    |                                   |       +--> Partial file cleanup
    |                                   |       |
    |                                   |       +--> SQLite status update (CANCELLED)
    |                                   |
    |                                   +--> Cancel confirmation modal
    |                                   |
    |                                   +--> Cancel progress indicator
    |
    v
Download blocked for CANCELLED jobs
```

**Critical path:**
1. COOP/COEP headers → SharedArrayBuffer → FFmpeg.wasm viable
2. Mode toggle UI → Device flow (existing v1.0) OR Server flow (existing v2.0)
3. Job cancellation button → Cancel endpoint → FFmpeg kill → Cleanup

**Blockers:**
- Without COOP/COEP, FFmpeg.wasm runs single-threaded (10x slower, unusable)
- Without localStorage, preference doesn't persist (annoying but not broken)
- Without graceful FFmpeg termination, partial files may corrupt storage

**Independent:**
- Capability detection can be added after toggle works
- Time estimates can be added after mode selection works
- Battery check is purely additive

## MVP Recommendation

For v3.0 MVP, prioritize making the toggle work correctly with minimal polish, then add job cancellation as a separate completable unit.

### Must-Have (Table Stakes)

**Hybrid Processing Toggle:**
1. **COOP/COEP headers restored** -- Cloudflare Pages `_headers` config for SharedArrayBuffer
2. **Processing mode toggle UI** -- Radio buttons on upload page with clear labels
3. **localStorage preference** -- Save/load user's last-used mode
4. **Mode-specific flow routing** -- Device → v1.0 flow (inline progress, ZIP). Server → v2.0 flow (job redirect)
5. **Clear mode labels** -- "Process on device (private, stay on page)" vs "Send to server (faster, can close tab)"

**Job Cancellation:**
6. **Cancel button on job status page** -- Visible only when status is "processing"
7. **POST /jobs/:id/cancel endpoint** -- Server-side cancellation handler
8. **Graceful FFmpeg termination** -- SIGTERM with 2.5s grace period before SIGKILL
9. **Partial file cleanup** -- Delete job directory from Fly Volume
10. **CANCELLED job state** -- New SQLite status, distinct from FAILED/EXPIRED
11. **Cancel confirmation modal** -- "Are you sure? This cannot be undone."
12. **Download blocked for cancelled jobs** -- `GET /jobs/:id/download` returns 410 Gone

### Should-Have (Low-Complexity Differentiators)

13. **Automatic capability detection** -- Detect missing WebAssembly/SharedArrayBuffer, auto-select server mode
14. **Mode recommendation badges** -- "Recommended for privacy" (device) vs "Recommended for speed" (server)
15. **Cancel progress indicator** -- "Cancelling job..." spinner during FFmpeg kill
16. **Server unavailable fallback** -- Auto-switch to device mode if server returns 5xx

### Defer to Post-MVP

- Processing time estimate per mode
- Cancel + retry flow (pre-fill files)
- Cancellation reason (optional text input)
- Partial results preservation option
- Device battery check (mobile consideration)

### Explicitly Reject

- Toggle switch for mode selection (use radio buttons)
- Hybrid mode (split processing across device + server)
- Automatic mode switching mid-job
- Per-video mode selection
- Pause/resume for device processing
- Job cancellation for device processing (not needed)
- Retry from checkpoint
- Cancel confirmation skip ("don't ask again")
- Queue priority for cancellation
- Undo cancellation

## Expected Behavior Patterns

Based on research of hybrid processing systems, job cancellation UX, and browser capability detection, here's how v3.0 features should work.

### Processing Mode Selection Flow

```
1. User lands on upload page
2. UI loads preference from localStorage (default: device mode)
3. Browser capability check runs:
   - If WebAssembly unavailable: disable device option, select server, show notice
   - If crossOriginIsolated === false: disable device option, select server, show notice
   - Otherwise: both options available
4. User sees radio buttons:
   ( ) Process on device (private, stay on page)     [Recommended for privacy]
   (•) Send to server (faster, can close tab)        [Recommended for speed]
5. User selects mode (or keeps default)
6. User uploads files, sets variation count
7. User clicks "Start Processing"
8. localStorage saves selected mode for next session
9a. If device mode: existing v1.0 flow (FFmpeg.wasm, inline progress, ZIP download)
9b. If server mode: existing v2.0 flow (POST /jobs, redirect to status page)
```

**Key UX insights from research:**
- **Radio buttons, not toggle switch**: Toggle switches are for settings with immediate effect (dark mode). Mode selection is a choice between workflows, applied on submit. [NN/g Toggle Guidelines](https://www.nngroup.com/articles/toggle-switch-guidelines/)
- **Both options visible**: Users need to compare tradeoffs. Hidden options reduce discoverability. [Toggle UX Best Practices](https://www.eleken.co/blog-posts/toggle-ux)
- **Recommendation badges**: Subtle guidance helps new users without overwhelming. User preference overrides. [Dynamic Personalization 2026](https://www.uxdesigninstitute.com/blog/the-top-ux-design-trends-in-2026/)

### Job Cancellation Flow

```
1. User submits job in server mode
2. Job status page shows:
   - Status: "Processing"
   - Progress: "Processing video 2/5, variation 3/10 (45%)"
   - [Cancel Job] button (red, secondary action)
3. User clicks [Cancel Job]
4. Confirmation modal appears:
   "Cancel this job?
    All progress will be lost and files will be deleted.
    This cannot be undone.
    [Keep Processing] [Cancel Job]"
5. User clicks [Cancel Job] in modal
6. UI shows "Cancelling job..." spinner (button disabled)
7. Frontend: POST /jobs/:id/cancel
8. Backend:
   - Find running FFmpeg child process for this job
   - Write 'q\r\n' to stdin (graceful stop signal)
   - Wait 2.5 seconds for FFmpeg to finish current frame
   - If still running, send SIGTERM
   - If still running after 2.5s more, send SIGKILL
   - Delete job directory from Fly Volume
   - Update SQLite: status = 'cancelled'
   - Respond 200 OK { status: 'cancelled' }
9. Frontend updates UI:
   - Status: "Cancelled"
   - Progress: "(Job was cancelled)"
   - [Download ZIP] hidden
   - [Start New Job] button (optional differentiator)
10. Job appears in job list with "Cancelled" badge
```

**Key UX insights from research:**
- **Always confirm destructive actions**: Prevents accidental data loss. Standard pattern. [Nondestructive Cancel Buttons](https://blog.logrocket.com/ux-design/how-to-design-nondestructive-cancel-buttons/)
- **Graceful FFmpeg termination**: `q\r\n` to stdin allows FFmpeg cleanup, prevents corruption. SIGTERM before SIGKILL. [FFmpeg Termination Best Practices](https://wiki.serviio.org/doku.php?id=ffmpeg_term)
- **Immediate cancellation, not queued**: Users expect cancel to act now, not wait in queue. [Cancel vs Close UX](https://www.nngroup.com/articles/cancel-vs-close/)
- **CancellationToken pattern**: ASP.NET Core pattern applies to Node.js child_process. Respect cancellation signals. [ASP.NET Cancellation](https://www.rahulpnath.com/blog/abortcontroller-cancellationtoken-dotnet)

### Capability Detection and Fallback

```
// On upload page load
function detectDeviceProcessingSupport() {
  const reasons = [];

  // Check WebAssembly support
  if (typeof WebAssembly === 'undefined') {
    reasons.push('WebAssembly not supported in this browser');
  }

  // Check SharedArrayBuffer (requires COOP/COEP headers)
  if (!crossOriginIsolated) {
    reasons.push('Browser security settings prevent multi-threaded processing');
  }

  // Check if running on low-power device (optional)
  if (navigator.deviceMemory && navigator.deviceMemory < 4) {
    reasons.push('Device has limited memory (recommended: 4GB+)');
  }

  if (reasons.length > 0) {
    // Disable device mode option
    deviceModeRadio.disabled = true;
    serverModeRadio.checked = true;
    showNotice(`Device processing unavailable: ${reasons.join(', ')}. Using server mode.`);
  }
}
```

**Key insights from research:**
- **WebAssembly feature detection**: Use `wasm-feature-detect` library or manual checks. [WebAssembly Feature Detection](https://web.dev/articles/webassembly-feature-detection)
- **crossOriginIsolated check**: Verifies COOP/COEP headers are present. Required for SharedArrayBuffer. [WASM Fallback Patterns](https://platform.uno/blog/the-state-of-webassembly-2025-2026/)
- **Graceful degradation**: When features unavailable, fall back to server mode with clear explanation. [Progressive Enhancement](https://book.leptos.dev/progressive_enhancement/index.html)

### localStorage Preference Persistence

```javascript
// Save preference on mode change
function handleModeChange(mode) {
  localStorage.setItem('videoRefresherProcessingMode', mode); // 'device' or 'server'
}

// Load preference on page init
function initProcessingModeUI() {
  const savedMode = localStorage.getItem('videoRefresherProcessingMode') || 'device'; // default to device

  if (savedMode === 'device' && isDeviceProcessingSupported()) {
    deviceModeRadio.checked = true;
  } else {
    serverModeRadio.checked = true;
  }
}
```

**Key insights from research:**
- **localStorage for preferences**: Standard pattern for user settings that persist across sessions. 5MB limit is more than sufficient. [localStorage Best Practices](https://peerdh.com/blogs/programming-insights/implementing-local-storage-for-user-preferences-in-a-web-app)
- **Sensible defaults**: Default to device mode (privacy-first, 78% user preference). Fall back to server if device unavailable. [On-Device Processing Preferences](https://www.f22labs.com/blogs/what-is-on-device-ai-a-complete-guide/)

## Complexity Estimates

| Feature Category | Complexity | Estimate | Notes |
|------------------|------------|----------|-------|
| **COOP/COEP headers restore** | Low | 15-30 min | Edit Cloudflare Pages `_headers` file, deploy, verify with DevTools |
| **Processing mode toggle UI** | Low | 1-2 hours | Radio buttons, labels, badges, CSS styling |
| **localStorage preference** | Low | 30 min - 1 hour | Save on change, load on init, default handling |
| **Mode-specific flow routing** | Medium | 2-3 hours | Conditional logic: device → v1.0 flow, server → v2.0 flow |
| **Browser capability detection** | Medium | 2-3 hours | WebAssembly check, crossOriginIsolated check, UI updates, notices |
| **Cancel button UI (frontend)** | Low | 1-2 hours | Button component, modal confirmation, loading state |
| **POST /jobs/:id/cancel endpoint** | Medium | 3-4 hours | Express route, job lookup, FFmpeg kill logic, error handling |
| **Graceful FFmpeg termination** | High | 4-6 hours | stdin 'q' signal, SIGTERM with grace period, SIGKILL fallback, process tracking |
| **Partial file cleanup** | Medium | 2-3 hours | Delete job directory from Fly Volume, SQLite update |
| **CANCELLED job state** | Low | 1-2 hours | SQLite schema update, status checks, download endpoint guard |
| **Cancel progress indicator** | Low | 30 min - 1 hour | Spinner, button disabled state |
| **Mode recommendation badges** | Low | 1 hour | Static labels with CSS, optional icons |
| **Processing time estimates** | Medium | 3-4 hours | File size calculation, mode-specific formulas, UI display |
| **Server unavailable fallback** | Medium | 2-3 hours | API error handling, mode switch, user notification |
| **Testing + edge cases** | Medium | 4-6 hours | Test all mode combinations, cancel timing, capability detection edge cases |
| **TOTAL MVP** | | **27-42 hours** | |

## User Preference and Tradeoff Analysis

Based on research, here's how users evaluate processing mode choices:

### Device Processing (FFmpeg.wasm)

**Strengths:**
- **Privacy**: Data never leaves browser. 78% of users refuse cloud AI features for privacy reasons. [On-Device AI Adoption](https://www.f22labs.com/blogs/what-is-on-device-ai-a-complete-guide/)
- **No upload latency**: Processing starts immediately, no upload progress bar
- **Offline capable**: Works without internet after page loads (FFmpeg.wasm cached)
- **Predictable cost**: No server costs, no quotas

**Weaknesses:**
- **Slower processing**: 10-20x slower than native FFmpeg. 30s per video vs 2s. [FFmpeg.wasm Performance](https://ffmpegwasm.netlify.app/docs/performance/)
- **Tab must stay open**: Fire-and-forget not possible, user locked to page
- **Memory intensive**: Large batches (10+ videos) may crash on low-memory devices
- **Browser compatibility**: Requires modern browser with WebAssembly, SharedArrayBuffer

**Best for:**
- Users who prioritize privacy
- Small batches (1-3 videos, 5-10 variations)
- Offline/unreliable network scenarios
- Users who don't mind waiting on-page

### Server Processing (Native FFmpeg on Fly.io)

**Strengths:**
- **10-50x faster**: Native FFmpeg is dramatically faster. 2s per video vs 30s. [Server vs Client Processing](https://dev.to/baojian_yuan/moving-ffmpeg-to-the-browser-how-i-saved-100-on-server-costs-using-webassembly-4l9f)
- **Fire-and-forget**: Close browser, return hours later for results
- **Handles large batches**: 10+ videos, 20 variations per video
- **Universal compatibility**: Works on any browser, any device

**Weaknesses:**
- **Upload time**: 50-100MB videos take 30-60s to upload before processing starts
- **Privacy concern**: Files temporarily stored on server (24h expiry)
- **Server dependency**: Requires Fly.io to be available
- **Storage limits**: 3GB cap, results expire after 24h

**Best for:**
- Users who need speed
- Large batches (5+ videos, 10+ variations)
- Fire-and-forget workflow (upload and walk away)
- Team collaboration (job history shared across users)

### Decision Matrix

| Criterion | Device Mode | Server Mode | Winner |
|-----------|-------------|-------------|--------|
| Privacy | Excellent (data never leaves browser) | Good (24h temp storage) | Device |
| Speed | Slow (10-20x slower) | Fast (native FFmpeg) | Server |
| Batch size | Small (1-3 videos) | Large (10+ videos) | Server |
| Workflow | Must stay on page | Fire-and-forget | Server |
| Compatibility | Modern browsers only | Universal | Server |
| Network dependency | Low (after initial load) | High (upload + download) | Device |

**Recommendation strategy:**
- Default to device mode (privacy-first, matches 78% user preference)
- Badge server mode as "Recommended for speed" for large batches
- Auto-select server mode if device processing unavailable

## Open Questions

1. **Should cancelled jobs count toward storage quota?** Cancelled jobs have no files (cleaned up immediately), but job metadata persists in SQLite. Recommend: SQLite metadata doesn't count toward 3GB volume quota. Only files on disk count.

2. **Can users cancel while job is "pending" (not yet processing)?** Yes -- pending jobs are in queue but not running FFmpeg. Cancel just removes from queue, no FFmpeg to kill. Fast operation.

3. **What happens if user cancels, then server finishes current variation before SIGTERM?** Current variation may complete if FFmpeg exits gracefully within grace period. These files should still be cleaned up (job is cancelled, partial results not downloadable). Cancellation intent overrides partial success.

4. **Should device mode show a "Switch to server mode" link if processing is slow?** Could be helpful, but interrupting mid-processing is complex (would need to cancel device job, re-upload files, start server job). Defer to post-v3.0. Keep mode locked once processing starts.

5. **How to handle COOP/COEP headers breaking third-party scripts (analytics, etc.)?** COOP/COEP isolate the page from cross-origin resources. If using Google Analytics or other third-party scripts, they may break. Recommend: self-host critical scripts or accept degraded analytics. SharedArrayBuffer is required for multi-threaded FFmpeg.wasm.

6. **Should server unavailable fallback ask user, or auto-switch silently?** Auto-switch with clear notification. Users want their job to succeed; they don't want to be blocked by server downtime. "Server unavailable. Switched to device processing." gives user control to cancel if they don't want device mode.

7. **Can users see list of cancelled jobs in job history?** Yes -- cancelled jobs should appear in job list with "Cancelled" status. Helps users understand what happened if they return later. SQLite metadata persists even after files deleted.

## Sources

### HIGH Confidence (official documentation, established patterns)

- [Nielsen Norman Group: Toggle Switch Guidelines](https://www.nngroup.com/articles/toggle-switch-guidelines/) -- when to use toggles vs radio buttons
- [Nielsen Norman Group: Cancel vs Close](https://www.nngroup.com/articles/cancel-vs-close/) -- distinguishing cancel actions in UI
- [FFmpeg.wasm Performance Documentation](https://ffmpegwasm.netlify.app/docs/performance/) -- 10-20x slower than native
- [FFmpeg.wasm Overview](https://ffmpegwasm.netlify.app/docs/overview/) -- browser-based video processing
- [WebAssembly Feature Detection (web.dev)](https://web.dev/articles/webassembly-feature-detection) -- capability detection patterns
- [MDN: Background Tasks API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Tasks_API) -- browser background processing
- [Microsoft Learn: ASP.NET Background Tasks](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/multi-container-microservice-net-applications/background-tasks-with-ihostedservice) -- cancellation token patterns
- [FFmpeg Manual Termination (ServiioWiki)](https://wiki.serviio.org/doku.php?id=ffmpeg_term) -- graceful FFmpeg stop signals

### MEDIUM Confidence (multiple sources agree, verified patterns)

- [The State of WebAssembly 2025-2026](https://platform.uno/blog/the-state-of-webassembly-2025-2026/) -- fallback patterns, browser support
- [Progressive Enhancement (Leptos Book)](https://book.leptos.dev/progressive_enhancement/index.html) -- graceful degradation strategies
- [LogRocket: Nondestructive Cancel Buttons](https://blog.logrocket.com/ux-design/how-to-design-nondestructive-cancel-buttons/) -- confirmation patterns
- [Toggle UX Best Practices (Eleken)](https://www.eleken.co/blog-posts/toggle-ux) -- when to use toggles
- [UX Design Trends 2026 (UX Design Institute)](https://www.uxdesigninstitute.com/blog/the-top-ux-design-trends-in-2026/) -- dynamic personalization, on-device AI trends
- [localStorage for User Preferences](https://peerdh.com/blogs/programming-insights/implementing-local-storage-for-user-preferences-in-a-web-app) -- persistence patterns
- [On-Device AI Guide 2026 (F22 Labs)](https://www.f22labs.com/blogs/what-is-on-device-ai-a-complete-guide/) -- user preference stats (78% refuse cloud, 91% pay for on-device)
- [Moving FFmpeg to Browser (DEV.to)](https://dev.to/baojian_yuan/moving-ffmpeg-to-the-browser-how-i-saved-100-on-server-costs-using-webassembly-4l9f) -- FFmpeg.wasm vs server comparison
- [Online Video Editor: FFmpeg WASM to Server-Side (HN Discussion)](https://news.ycombinator.com/item?id=34903898) -- real-world tradeoffs discussion
- [AbortController and CancellationToken (Rahul Nath)](https://www.rahulpnath.com/blog/abortcontroller-cancellationtoken-dotnet) -- cancellation patterns in APIs
- [Fluent-FFmpeg: Recommended Kill Process Pattern](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/138) -- Node.js FFmpeg termination discussion
- [Transloadit: Real-time Video Filters with FFmpeg](https://transloadit.com/devtips/real-time-video-filters-in-browsers-with-ffmpeg-and-webcodecs/) -- browser video processing patterns

### LOW Confidence (single sources, need validation)

- Processing time estimates (10-20x speedup native vs wasm) -- widely cited but not benchmarked for this specific workload
- User preference stats (78% refuse cloud, 91% pay for on-device) -- from single source (F22 Labs), not independently verified
- 2.5 second grace period for SIGTERM -- common pattern but no authoritative source for optimal duration
- Device memory threshold (4GB recommendation) -- heuristic, not verified for FFmpeg.wasm specifically

---

*This research focuses on v3.0 features (hybrid processing toggle and job cancellation) building on top of existing v1.0 (client-side) and v2.0 (server-side) functionality. v3.0 makes both processing modes available via user choice, with server jobs gaining cancellation capability.*
