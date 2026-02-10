# Phase 13: Upload View Integration - Context

**Gathered:** 2026-02-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Upload page presents a clear choice between device and server processing, remembers the user's preference, and routes submissions to the correct processing path. Device processing (Phase 11) and server cancellation (Phase 12) are already built — this phase wires them into the upload UI.

</domain>

<decisions>
## Implementation Decisions

### Toggle presentation
- Radio buttons (not segmented control or switch)
- Two options: "Process on device" and "Send to server"
- Labels only — no descriptive subtext underneath
- Placed above the file drop zone (user decides mode first, then selects files)
- Minimal styling — just the radio buttons inline, no container/border/section header

### Capability messaging
- When SharedArrayBuffer is unavailable, device radio is grayed out (disabled) with simple text: "Not supported in this browser" or similar
- No technical jargon — keep the message simple
- No guidance about which mode is better for certain situations — user just picks
- No trade-off hints or recommendations

### Mode switching behavior
- User can freely switch mode after selecting files — files stay selected
- Radio buttons lock (disabled) once processing starts — no switching mid-batch
- After processing completes, navigate to results view (same as current server flow)
- Device mode results use the same results page as server results — unified view

### Default & persistence
- Server is the default for first-time users
- Preference saved to localStorage on radio button selection (not on submit)
- Returning users see their last choice pre-selected silently — no "(last used)" indicator
- If saved preference is device but SharedArrayBuffer unavailable: silent fallback to server (no notification)
- Preference persists across auth sessions (survives logout/re-login)

### Claude's Discretion
- localStorage key naming
- Exact radio button styling to match existing upload page aesthetic
- How device results are represented in the unified results page
- Loading/transition states between mode selection and processing start

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. The upload page already exists; this adds the mode toggle and wires routing.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 13-upload-view-integration*
*Context gathered: 2026-02-09*
