# Phase 11: Device Processing Core - Context

**Gathered:** 2026-02-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can process videos entirely in the browser using FFmpeg.wasm, with progress feedback and ZIP download, without touching the server API. This phase delivers the complete device processing pipeline — Web Worker integration, multi-threaded FFmpeg.wasm, progress UI, and ZIP output. The mode toggle UI and upload page integration are Phase 13.

</domain>

<decisions>
## Implementation Decisions

### Progress feedback
- Both overall progress bar AND per-variation detail (e.g., "Processing 3 of 10" with current variation progress)
- No ETA or time estimates — just progress bars and variation counts
- Distinct view from server processing — make it clear this is happening locally, not reusing the server job progress layout
- No live preview of completed variations — user sees results only after all variations complete

### Processing flow
- Parallel processing: 2-3 variations concurrently using multiple Web Workers
- Process one source video at a time (all variations for video 1, then video 2, etc.)
- On variation failure: retry once, then skip and continue with remaining variations
- Cancel button available during processing — stops all remaining variations and offers to download what completed so far

### Output & download
- Manual download trigger — show a Download button when processing completes, no auto-download
- ZIP folder structure matches server processing output (organized by source video name with numbered variations)
- Partial download available after cancellation — button shows with note like "X of Y variations completed"
- Results stay on screen after download — user can re-download or start a new batch manually

### Error & edge cases
- If SharedArrayBuffer unavailable: fall back to single-threaded FFmpeg.wasm (slower but functional)
- File size warning at 100MB (consistent with existing upload warning) — user can proceed anyway
- beforeunload warning when device processing is active — processing is lost if they leave
- If FFmpeg.wasm fails to load entirely: show error with clear suggestion to switch to server processing

### Claude's Discretion
- Exact number of parallel workers (2 or 3) based on FFmpeg.wasm constraints
- Progress percentage source (FFmpeg log parsing vs time-based estimation)
- Web Worker architecture (shared vs dedicated workers)
- Memory management strategy for holding multiple video buffers

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Key constraint is matching the server ZIP output structure for consistency.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 11-device-processing-core*
*Context gathered: 2026-02-07*
