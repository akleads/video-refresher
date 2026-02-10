# Phase 12: Server Job Cancellation - Context

**Gathered:** 2026-02-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can cancel in-progress (and queued) server jobs. The server gracefully kills FFmpeg processes and cleans up partial files. Completed variations from before cancellation are preserved for download. Cancelled jobs display a distinct status in the UI.

</domain>

<decisions>
## Implementation Decisions

### Cancel button UX
- Confirmation dialog required before cancelling (not instant)
- Cancel button appears on both the job list page (inline per row) and the job detail page
- While cancellation is in progress: button disables + text changes to "Cancelling..."
- After cancellation completes: user stays on the same page, status updates in-place to Cancelled

### Partial results handling
- Completed variations are kept and remain downloadable after cancellation
- Normal download button (no special "partial" labeling) — file count speaks for itself
- Job detail page shows completion count: "3 of 10 variations completed"
- Jobs cancelled with 0 completed variations still appear in history (not auto-deleted)

### Cancellation timing & edge cases
- Queued jobs can also be cancelled (instant, no FFmpeg to kill)
- Race condition: if all variations finish before kill takes effect, job is marked Completed (completed wins)
- Graceful escalation timeouts: stdin 'q' → wait 2s → SIGTERM → wait 2s → SIGKILL
- If cancel request fails (server error, process already dead): show error to user, re-enable Cancel button for retry

### Status & feedback
- Cancelled jobs visually distinct from failed jobs: Cancelled = neutral/gray, Failed = red
- Status label format: "Cancelled (3/10)" — includes completion count at a glance
- Same 24-hour auto-expiry as completed jobs (consistent cleanup behavior)
- Job detail page shows cancel timestamp alongside created/started times

### Claude's Discretion
- Confirmation dialog styling and wording
- Cancel button placement within existing job list row layout
- Error toast/alert implementation for failed cancel requests
- How cancel timestamp is stored in the database schema

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-server-job-cancellation*
*Context gathered: 2026-02-09*
