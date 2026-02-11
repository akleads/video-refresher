# Phase 19: Enhanced Job Cards - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Add video thumbnails to job cards for quick visual identification, and browser notifications when server jobs complete. Two capabilities: thumbnail generation/display and notification system. No changes to job processing logic, download flow, or card layout structure (refined in Phase 18).

</domain>

<decisions>
## Implementation Decisions

### Thumbnail appearance
- Position: left side of card, inline — text/metadata flows to the right
- Size: small (48-64px) — just enough to identify the video, doesn't dominate
- Placeholder when missing: generic video/film icon on a muted background
- One thumbnail per card only — always the first source video, even for multi-video jobs
- No stacked/overlapping thumbnails

### Thumbnail generation
- Server jobs: generate during FFmpeg processing — extract a frame while already running, zero extra cost
- Frame to capture: ~2 seconds in — avoids black/blank intros, more likely to show actual content
- Device jobs: generate on server when device results are uploaded — consistent with server jobs
- Format: WebP — smaller file sizes, modern format
- Thumbnails stored alongside job output files on server

### Notification behavior
- Permission prompt: on first server job submission — ask right when they submit
- Notification text: generic message — "Video Refresher: Your videos are ready to download"
- Click action: focus the Video Refresher tab — no navigation to specific job
- Notification style: plain text only — no custom app icon or thumbnail in notification

### Notification scope
- Server jobs only — device jobs finish while user watches, no notification needed
- Background tab only — uses Notification API from the page, no Service Worker/push required
- One notification per job — no batching, each completed job fires independently
- In-app toggle to enable/disable notifications — not just browser permission management

### Claude's Discretion
- Exact thumbnail dimensions within 48-64px range
- Thumbnail aspect ratio handling (crop vs letterbox)
- WebP quality setting
- In-app toggle placement (nav bar, settings area, or inline on upload page)
- Notification auto-dismiss timing
- How to detect "first job submission" for permission prompt (localStorage flag)

</decisions>

<specifics>
## Specific Ideas

- Thumbnails should be unobtrusive — small, left-aligned, supplementary to the filename which remains the primary identifier
- Notifications are specifically for the fire-and-forget server workflow — submit, close tab, get notified when done
- The in-app toggle gives users control without needing to dig into browser settings

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 19-enhanced-job-cards*
*Context gathered: 2026-02-10*
