# Project Research Summary

**Project:** Video Refresher v3.0 Hybrid Processing Milestone
**Domain:** Hybrid client/server video processing with job cancellation
**Researched:** 2026-02-07
**Confidence:** HIGH

## Executive Summary

Video Refresher v3.0 adds hybrid processing to an existing video variation generator: users toggle between "Process on device" (FFmpeg.wasm 0.12.15 in browser) and "Send to server" (existing Fly.io queue). This is an additive integration on top of v2.0's server-only architecture, reintroducing the v1.0 client-side flow as an alternative path. The key architectural insight is that device and server modes are completely independent workflows—device processing never creates job records, bypasses the API entirely, and generates ZIPs client-side with JSZip. Server mode remains unchanged from v2.0, gaining only job cancellation capability (DELETE endpoint that kills FFmpeg PIDs and cleans partial files).

The recommended approach is to design a unified processor abstraction layer upfront (Strategy pattern) that isolates mode-specific logic behind a common interface: init(), process(), cancel(), download(). This prevents the catastrophic code duplication and feature drift that plagues hybrid architectures. The upload view branches on mode selection but shares validation, progress UI, and download UX through the abstraction. Both modes must restore COOP/COEP headers for SharedArrayBuffer (FFmpeg.wasm multi-threading), but this breaks cross-origin API calls—the backend must add Cross-Origin-Resource-Policy headers before frontend headers are enabled, or server mode will fail with opaque CORS errors.

Critical risks include JSZip memory crashes (3 videos x 20 variations = 1.2GB in browser memory), FFmpeg.wasm load failures requiring graceful fallback to server mode, and state management hell when users switch modes mid-session. Mitigation: use JSZip streaming mode, detect SharedArrayBuffer availability before showing device toggle, and disable mode switching during active processing. The biggest trap is implementing modes as separate code paths without abstraction—this leads to unmaintainable duplication and divergent feature sets. Build the processor interface in Phase 1, before writing any device-mode code.

## Key Findings

### Recommended Stack

v3.0 requires no new backend dependencies—job cancellation uses Node.js built-ins (process.kill with SIGTERM + graceful FFmpeg stdin 'q' quit command). Frontend additions are CDN-loaded libraries from the validated v1.0 stack: FFmpeg.wasm 0.12.15 (latest patch release since v1.0's 0.12.14) and JSZip 3.10.1 (unchanged, stable API). The only configuration change is restoring the Cloudflare Pages _headers file with COOP/COEP for SharedArrayBuffer support, removed in v2.0.

**Core technologies:**
- **FFmpeg.wasm 0.12.15** (CDN): Browser-side video processing — v1.0 validated, only bug fix updates since 0.12.14, multi-threading via SharedArrayBuffer
- **JSZip 3.10.1** (CDN): Client-side ZIP generation — v1.0 validated, STORE compression for videos, streaming mode prevents memory crashes
- **COOP/COEP headers** (Cloudflare Pages _headers): Enable SharedArrayBuffer — required for multi-threaded FFmpeg.wasm (10x performance gain), but breaks cross-origin API calls unless backend adds CORP headers
- **process.kill() + stdin 'q'** (Node.js built-in): Server job cancellation — graceful FFmpeg termination (2.5s SIGTERM grace period, then SIGKILL fallback)

**Critical v1.0 memory note:** FFmpeg.wasm 0.12.x neuters ArrayBuffers on writeFile() due to transferable postMessage. Always copy buffers before reuse: `new Uint8Array(buffer)`. This bug (commit 8cbd4b3) will resurface when reintroducing device processing.

### Expected Features

Users expect a clear toggle between device and server processing modes with mode-specific tradeoffs explained (privacy vs speed). Device mode replicates v1.0's synchronous workflow (inline progress, ZIP download, no job history), while server mode extends v2.0 with job cancellation (DELETE endpoint, kill FFmpeg, clean files). The toggle uses radio buttons (not a toggle switch—users need to see both options simultaneously to compare tradeoffs), with localStorage persistence across sessions.

**Must have (table stakes):**
- Processing mode toggle (radio buttons) with clear labels: "Process on device (private, stay on page)" vs "Send to server (faster, can close tab)"
- Mode-specific UX flow — device: inline progress → ZIP download; server: job redirect → polling → download
- COOP/COEP headers restored for SharedArrayBuffer (FFmpeg.wasm multi-threading)
- Job cancellation button for server jobs in "processing" state
- Graceful FFmpeg termination (SIGTERM with grace period, not immediate SIGKILL)
- Partial file cleanup on cancellation (delete job directory, update status to 'cancelled')
- Download blocked for cancelled jobs (410 Gone or hide download button)
- Cancellation confirmation ("Are you sure? This cannot be undone")

**Should have (competitive differentiators):**
- Automatic capability detection — if WebAssembly/SharedArrayBuffer unavailable, hide device option and explain why
- Mode recommendation badges — "Recommended for privacy" (device) vs "Recommended for speed" (server)
- Cancel progress indicator — "Cancelling job..." spinner during FFmpeg kill
- Server unavailable fallback — auto-switch to device mode if server returns 5xx

**Defer (v2+ anti-features):**
- Toggle switch for mode selection (use radio buttons instead — toggles imply on/off settings, not workflow choices)
- Hybrid mode (split processing across device + server) — adds complexity, unpredictable results, confusing UX
- Automatic mode switching mid-job — corrupts state, defeats purpose of mode choice
- Per-video mode selection — batch should use one consistent mode
- Pause/resume for device processing — FFmpeg.wasm 0.12.x doesn't expose mid-encoding pause API
- Retry from checkpoint — requires storing partial state, adds complexity for minimal value

### Architecture Approach

v3.0 is an additive integration where device and server modes are completely independent paths after upload view mode selection. The upload view branches on processing mode: device calls lib/device-processor.js (orchestrates Web Worker FFmpeg.wasm execution, JSZip generation, blob download) while server calls existing v2.0 API flow (POST /api/jobs, poll status, stream ZIP). Device processing runs FFmpeg.wasm in a dedicated Web Worker (required for multi-threading), shares effect generation logic with server via extracted lib/effects.js, and never creates job records. Server mode gains DELETE /api/jobs/:id endpoint that kills FFmpeg by PID (stored in job_files.current_ffmpeg_pid), cleans partial output files, and marks status as 'cancelled'.

**Major components:**
1. **views/upload.js** (modified) — toggle UI + mode-aware submit handler that branches to device or server flow
2. **lib/device-processor.js** (new) — orchestrate local FFmpeg.wasm processing: create worker, send messages (LOAD/PROCESS/TERMINATE), aggregate progress, generate ZIP with JSZip streaming, trigger download
3. **workers/ffmpeg-worker.js** (new, restored from v1.0) — Web Worker running FFmpeg.wasm 0.12.x, handles LOAD/PROCESS/TERMINATE messages, copies buffers to avoid neutering
4. **lib/effects.js** (new, extracted from server) — shared effect generation algorithm for deterministic variations across both modes
5. **server/routes/jobs.js** (modified) — add DELETE /:id endpoint for cancellation: kill FFmpeg PID (SIGTERM with 2.5s grace), clean job directory, update status to 'cancelled'
6. **Cloudflare Pages _headers** (restored) — COOP: same-origin, COEP: require-corp for SharedArrayBuffer, requires backend CORP headers or API calls break

**Critical pattern:** Design processor abstraction upfront (Strategy pattern) with common interface: init(), process(files, variations, onProgress), cancel(), download(result). Device and server modes implement this interface independently. Upload view uses processor instance without knowing implementation details. This prevents catastrophic code duplication and feature drift.

### Critical Pitfalls

Top 5 pitfalls from research that cause rewrites or breaking changes:

1. **COOP/COEP headers break server API calls** — Enabling Cross-Origin-Embedder-Policy: require-corp for SharedArrayBuffer forces ALL cross-origin resources (including API calls to Fly.io backend) to opt-in via CORP headers. Without Cross-Origin-Resource-Policy: cross-origin on backend responses, server mode fails with opaque CORS errors. Prevention: Add CORP header to all backend responses BEFORE enabling frontend COEP, or use COEP: credentialless mode (strips credentials from cross-origin requests).

2. **Dual processing modes without abstraction layer** — Implementing device and server modes as separate code paths leads to massive duplication: upload validation, progress tracking, error handling, result presentation all duplicated with slight variations. Over time, modes diverge—bugs fixed in one aren't fixed in the other. Prevention: Design unified processor interface (Strategy pattern) in Phase 1 BEFORE writing device-mode code. Both modes implement init(), process(), cancel(), download() behind common abstraction.

3. **JSZip browser memory crashes with large batches** — Processing 3 videos x 20 variations = 60 videos at 20MB each = 1.2GB of video data. JSZip's default behavior buffers entire ZIP in RAM before download, causing "Out of memory" tab crashes (Chrome: 2GB limit, Safari: 1GB). Prevention: Use JSZip streaming mode (streamFiles: true) and STORE compression (no re-compression of already-compressed H.264 videos), or cap device mode at 3 files x 10 variations.

4. **No graceful degradation when FFmpeg.wasm fails to load** — CDN timeout, blocked jsdelivr, missing COOP/COEP headers, Safari incompatibility all cause FFmpeg.wasm to fail loading. User sees infinite spinner or cryptic error with no fallback. Prevention: Detect SharedArrayBuffer availability before showing device toggle, add timeout on FFmpeg load (10s) with confirm() fallback to server mode, show loading state ("Loading FFmpeg.wasm...") with disabled button until ready.

5. **State management hell when switching modes mid-session** — User starts device processing, realizes it's slow, tries to switch to server mid-job. App state corrupts: some files processed, progress UI shows wrong values, FFmpeg memory not released, Blob URLs leak. Prevention: Disable mode switching during active processing (grey out toggle, show "Cannot switch modes during processing" warning), implement full cleanup on mode switch (terminate worker, revoke Blob URLs, abort fetch), use state machine for valid transitions.

## Implications for Roadmap

Based on research, v3.0 should be structured in 4 phases ordered by dependencies and risk mitigation. The most critical insight is that Phase 1 must establish the processor abstraction layer and restore COOP/COEP infrastructure before any device-mode code is written—retrofitting abstraction after both modes exist is 5x harder. Server job cancellation can be developed independently as Phase 3 (no frontend dependency), allowing parallel work after Phase 2 completes.

### Phase 1: Foundation & Infrastructure
**Rationale:** Both device and server modes depend on this infrastructure. COOP/COEP headers must be deployed with backend CORP headers before device processing code exists, or server mode breaks. Processor abstraction prevents catastrophic code duplication if designed upfront (impossible to retrofit cleanly later).

**Delivers:**
- Backend CORP headers added to all API responses (prevents COEP from breaking server mode)
- Cloudflare Pages _headers file restored with COOP/COEP (enables SharedArrayBuffer)
- Processor abstraction interface designed (Strategy pattern: init, process, cancel, download)
- Effect generation extracted from server to shared lib/effects.js
- Browser capability detection (SharedArrayBuffer, crossOriginIsolated, WebAssembly)

**Addresses features:**
- COOP/COEP headers (table stakes from FEATURES.md)
- Mode-specific UX flow routing infrastructure

**Avoids pitfalls:**
- Pitfall 1 (COEP breaks API calls) — backend CORP headers prevent this
- Pitfall 2 (no abstraction layer) — design upfront, not retrofit
- Pitfall 4 (no FFmpeg load fallback) — capability detection infrastructure

**Validation:** Deploy _headers, verify SharedArrayBuffer available, test server API calls still work, smoke test server processing unchanged.

### Phase 2: Device Processing Core
**Rationale:** Build device processing against the processor abstraction designed in Phase 1. Web Worker is architectural decision that affects all device-mode code (multi-threading requires Worker scope), must come before upload view integration. Dependencies: Phase 1 (COOP/COEP headers, processor interface).

**Delivers:**
- workers/ffmpeg-worker.js (Web Worker running FFmpeg.wasm 0.12.15)
- lib/device-processor.js implementing processor interface
- JSZip streaming integration for client-side ZIP generation
- Promise-based worker communication wrapper
- ArrayBuffer copying to prevent neutering (v1.0 bug fix)

**Addresses features:**
- Device processing path (replicates v1.0 synchronous workflow)
- ZIP download for device mode

**Avoids pitfalls:**
- Pitfall 3 (JSZip memory crash) — use streamFiles: true, STORE compression
- Pitfall 8 (FFmpeg not in Worker) — run FFmpeg in Worker from start, not main thread
- v1.0 buffer neutering bug — copy buffers before writeFile()

**Uses stack:** FFmpeg.wasm 0.12.15, JSZip 3.10.1, lib/effects.js for filter strings

**Validation:** Test single file + single variation in isolation (no UI), verify multi-threading active (DevTools Performance tab), test ZIP download with 3 files x 5 variations (memory stress test).

### Phase 3: Server Job Cancellation (Parallel with Phase 4)
**Rationale:** Server-side change with no frontend dependency until Phase 4. Can be developed in parallel with upload view integration. Graceful FFmpeg termination (stdin 'q' + SIGTERM grace period) prevents corrupting partial output files.

**Delivers:**
- DELETE /api/jobs/:id endpoint (kill FFmpeg by PID, clean files, update status)
- Graceful FFmpeg termination logic (stdin 'q\r\n', 2.5s SIGTERM grace, SIGKILL fallback)
- Partial file cleanup (delete job directory from Fly Volume)
- CANCELLED job state in SQLite (distinct from FAILED/EXPIRED)
- Download endpoint guard (410 Gone for cancelled jobs)

**Addresses features:**
- Job cancellation button (table stakes from FEATURES.md)
- Partial file cleanup
- Download blocked for cancelled jobs

**Avoids pitfalls:**
- Pitfall 6 (no backend cancellation API) — build this before showing cancel button in UI

**Uses stack:** process.kill() + stdin 'q' (Node.js built-ins), existing SQLite job_files.current_ffmpeg_pid

**Validation:** Start server job, call DELETE endpoint, verify FFmpeg process killed (ps aux), verify partial files deleted, verify status updated to 'cancelled', verify download returns 410.

### Phase 4: Upload View Integration
**Rationale:** Wires device-processor and server-processor to UI through mode toggle. Depends on Phase 2 (device-processor exists) and Phase 3 (cancellation API exists) for full feature parity. Mode toggle designed with radio buttons (not toggle switch—users need to see both options simultaneously).

**Delivers:**
- Processing mode toggle UI (radio buttons with clear labels)
- Submit handler branching (device → processLocally, server → existing v2.0 flow)
- localStorage mode preference persistence
- Shared progress UI between modes (onProgress callback abstraction)
- Cancel button in job-detail view (calls DELETE endpoint for server jobs)
- Cancellation confirmation modal ("Are you sure? This cannot be undone")
- Error handling and fallback (FFmpeg load failure → confirm switch to server)

**Addresses features:**
- Processing mode toggle with clear labels (table stakes)
- Mode preference persistence (localStorage)
- Cancel button UI with confirmation
- Automatic capability detection (show/hide device option)

**Avoids pitfalls:**
- Pitfall 5 (state management hell) — disable mode switching during processing
- Pitfall 7 (upload flow divergence) — unified validation before mode split
- Pitfall 9 (mode persistence confusion) — clear state on page load, reset on FFmpeg failure

**Uses stack:** Both processors (device-processor.js, server-processor.js via API), localStorage for preference

**Validation:** Toggle between modes with files selected (verify no leaks), start device processing and cancel (verify worker terminated), start server processing and cancel (verify FFmpeg killed), refresh page mid-processing (verify sane recovery), test mode selection with SharedArrayBuffer unavailable (verify device hidden).

### Phase Ordering Rationale

- **Phase 1 first:** Backend CORP headers must exist before frontend COEP enabled (or server mode breaks instantly). Processor abstraction impossible to retrofit after separate code paths exist. Capability detection needed before showing device toggle.
- **Phase 2 before 4:** Device-processor must exist before upload view can call it. Web Worker architecture decision affects all subsequent code.
- **Phase 3 parallel with 4:** Server cancellation endpoint has no frontend dependency. Can develop in parallel with upload view integration for schedule efficiency.
- **Phase 4 last:** Integration phase that depends on both device-processor (Phase 2) and cancellation API (Phase 3) existing. Wires everything together.

**Critical path:** Phase 1 → Phase 2 → Phase 4 (device processing). Phase 1 → Phase 3 → Phase 4 (server cancellation). Both paths converge in Phase 4.

**Avoid:** Don't skip processor abstraction in Phase 1 ("we'll refactor later"). Don't enable COEP before backend CORP headers exist. Don't write device mode code before confirming FFmpeg runs in Worker. These shortcuts create unfixable architecture debt.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Server Cancellation):** FFmpeg graceful termination timing (optimal grace period between SIGTERM and SIGKILL), handling edge cases (PID missing, process already dead, partial files mid-write)
- **Phase 4 (State Management):** State machine design for valid mode transitions, localStorage vs sessionStorage tradeoffs, worker lifecycle management

Phases with standard patterns (skip research-phase):
- **Phase 1 (COOP/COEP Setup):** Well-documented Cloudflare Pages feature, official MDN guides available
- **Phase 2 (FFmpeg.wasm Integration):** v1.0 validated implementation exists (commit 8cbd4b3), only need to update to 0.12.15

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | FFmpeg.wasm 0.12.15 and JSZip 3.10.1 validated in v1.0 (only bug fix updates since). process.kill() is Node.js built-in. COOP/COEP headers are official Cloudflare Pages feature. |
| Features | MEDIUM-HIGH | Mode toggle UX patterns verified via NN/g research. Job cancellation patterns confirmed via community consensus. 78% on-device AI preference stat from single source (needs validation). |
| Architecture | HIGH | Processor abstraction is standard Strategy pattern. Web Worker requirement verified via FFmpeg.wasm docs and SharedArrayBuffer specs. v1.0 and v2.0 provide concrete implementation reference. |
| Pitfalls | HIGH | COOP/COEP breaking API calls verified via MDN docs and web.dev guide. JSZip memory limits confirmed via GitHub issues. Code duplication risk is universal software pattern (high confidence in mitigation). |

**Overall confidence:** HIGH

Research is strong enough to proceed to roadmap creation with minimal validation risk. The combination of v1.0 validated client-side code, v2.0 validated server-side code, and official documentation for integration points (COOP/COEP, SharedArrayBuffer) provides high certainty. The processor abstraction pattern is well-established software engineering (Strategy pattern), reducing architecture risk.

### Gaps to Address

Areas where research was inconclusive or needs validation during implementation:

- **Optimal SIGTERM grace period:** Research suggests 2.5-5s for graceful FFmpeg shutdown, but not benchmarked for this specific workload. Recommendation: Start with 2.5s (conservative), add telemetry to measure actual FFmpeg exit times, adjust if needed.

- **JSZip memory threshold:** Research shows browser memory limits (Chrome 2GB, Safari 1GB) but exact crash point depends on user's device and other tabs. Recommendation: Cap device mode at 3 files x 10 variations (conservative ~600MB), add pre-flight check that warns if estimated ZIP >500MB.

- **Device mode processing time estimates:** Research cites 10-20x speedup (native FFmpeg vs FFmpeg.wasm) but not benchmarked for this specific effect pipeline. Recommendation: Don't show time estimates in MVP, add after collecting real-world data in Phase 5 polish.

- **COEP credentialless browser support:** Alternative to require-corp that's less disruptive, but browser support varies (Chrome 96+, Firefox/Safari unclear). Recommendation: Start with require-corp + backend CORP headers (universal support), consider credentialless in v3.1 if CORP causes third-party script issues.

- **Cancelled jobs and storage quota:** Should cancelled job metadata (SQLite) count toward 3GB volume quota? Research unclear. Recommendation: SQLite metadata doesn't count (it's in database file, not job directories). Only files on disk count toward quota. Document this decision in cancellation implementation.

## Sources

### Primary (HIGH confidence)
- **v1.0 Implementation** (commit 8cbd4b3) — FFmpeg.wasm 0.12.14 validated, ArrayBuffer neutering bug fix, JSZip ZIP generation, BlobURLRegistry pattern
- **v2.0 Codebase** (existing) — Server-side FFmpeg spawning, job queue patterns, SQLite schema (job_files.current_ffmpeg_pid), API authentication
- **[@ffmpeg/ffmpeg npm](https://www.npmjs.com/package/@ffmpeg/ffmpeg)** — Version 0.12.15 confirmed latest, API documentation
- **[FFmpeg.wasm Official Docs](https://ffmpegwasm.netlify.app/)** — Class API, usage patterns, multi-threading requirements
- **[JSZip Documentation](https://stuk.github.io/jszip/)** — API reference, limitations (memory), streaming mode (streamFiles: true)
- **[MDN: Cross-Origin-Embedder-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)** — COEP behavior, require-corp vs credentialless
- **[MDN: SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)** — Browser support, cross-origin isolation requirements
- **[web.dev: Making your website cross-origin isolated using COOP and COEP](https://web.dev/articles/coop-coep)** — How COOP/COEP enable SharedArrayBuffer, impact on resources
- **[Cloudflare Pages Headers Documentation](https://developers.cloudflare.com/pages/configuration/headers/)** — _headers file syntax, propagation timing

### Secondary (MEDIUM confidence)
- **[Nielsen Norman Group: Toggle Switch Guidelines](https://www.nngroup.com/articles/toggle-switch-guidelines/)** — When to use toggles vs radio buttons (toggles for immediate effect, radio for choice)
- **[Nielsen Norman Group: Cancel vs Close](https://www.nngroup.com/articles/cancel-vs-close/)** — Distinguishing cancel actions, confirmation patterns
- **[FFmpeg.wasm Performance Docs](https://ffmpegwasm.netlify.app/docs/performance/)** — 10-20x slower than native (cited but not benchmarked for this workload)
- **[JSZip GitHub Issues #135](https://github.com/Stuk/jszip/issues/135)** — Memory issues with large batches confirmed by community
- **[JSZip GitHub Issues #308](https://github.com/Stuk/jszip/issues/308)** — Streaming solutions, streamFiles flag
- **[LogRocket: Nondestructive Cancel Buttons](https://blog.logrocket.com/ux-design/how-to-design-nondestructive-cancel-buttons/)** — Confirmation dialog patterns
- **[FFmpeg Termination Best Practices (ServiioWiki)](https://wiki.serviio.org/doku.php?id=ffmpeg_term)** — stdin 'q' for graceful stop, SIGTERM before SIGKILL
- **[Fluent-FFmpeg: Recommended Kill Process Pattern (GitHub Issue #138)](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/138)** — Community consensus on FFmpeg termination
- **[On-Device AI Guide (F22 Labs)](https://www.f22labs.com/blogs/what-is-on-device-ai-a-complete-guide/)** — User preference stats (78% refuse cloud AI for privacy)

### Tertiary (LOW confidence)
- **Processing time estimates** (10-20x speedup native vs wasm) — Widely cited but not benchmarked for this specific workload
- **User preference stats** (78% refuse cloud, 91% pay for on-device) — Single source (F22 Labs), not independently verified
- **2.5 second grace period** for SIGTERM — Common pattern but no authoritative source for optimal duration
- **Device memory threshold** (4GB recommendation) — Heuristic, not verified for FFmpeg.wasm specifically

---
*Research completed: 2026-02-07*
*Supersedes v2.0 server-side research summary*
*Ready for roadmap: yes*
