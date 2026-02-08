# Phase 9: Frontend Integration - Context

**Gathered:** 2026-02-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace client-side FFmpeg.wasm frontend with an API-driven UI. Users interact through login, multi-video upload, progress polling, job history, and ZIP download. All FFmpeg.wasm code, worker files, and client-side processing logic are removed entirely.

</domain>

<decisions>
## Implementation Decisions

### Upload & submit flow
- Drag-and-drop zone + file picker button (similar to v1 pattern)
- Files accumulate across multiple drag/pick actions (not replaced)
- File list shows filename + file size with remove button per file (no video thumbnails)
- Single variation count input for entire batch (not per-video), capped at 1-20
- MP4 check + size warning >100MB (same validation as v1)
- Overall progress bar during upload to server (not per-file)
- After submit: navigate to job progress page immediately

### Progress & status display
- Overall job progress bar only (no per-video breakdown)
- Show all four status states: Queued, Processing, Completed, Failed
- On completion: download button + summary (total variations generated, file count) — no auto-download
- Partial failures shown as count: "8 of 10 variations succeeded" with download for successful ones

### Job history & results
- Separate "My Jobs" page accessible from tab navigation
- Tab-style nav at top: "New Job" and "My Jobs"
- Compact job rows: status badge, file count x variations, submitted time
- Auto-poll to refresh job statuses while page is open
- Expired jobs (24h+) shown with "Expired" badge, download button removed
- Completed jobs show "expires in Xh" countdown next to download button
- Download available unlimited times until job expires
- Cancel button for queued/processing jobs

### Login & session handling
- Minimal login screen: centered password input + submit button, app name above
- Token stored in localStorage (persists across tabs and restarts)
- Session lasts 24 hours (matches job expiry)
- On session expiry: redirect to login page with "Session expired" message

### Claude's Discretion
- Polling interval for job status and job list
- Exact visual styling, spacing, colors
- Loading/skeleton states
- Error state handling for network failures
- Page routing implementation (hash-based vs history API vs simple show/hide)

</decisions>

<specifics>
## Specific Ideas

- Navigation should feel like a simple 2-tab app: upload new jobs, view existing jobs
- Job detail page doubles as the progress page — navigate there after submit, return to it from job list
- Keep the "fire-and-forget" feel: submit, close tab, come back to "My Jobs" later and download

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-frontend-integration*
*Context gathered: 2026-02-07*
