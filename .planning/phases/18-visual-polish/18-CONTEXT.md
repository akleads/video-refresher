# Phase 18: Visual Polish - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Improve spacing, visual hierarchy, and interaction feedback across all existing views (upload, history, login). No new features — refine what exists to look and feel polished. Drop zone states, consistent spacing scale, job card hierarchy, and login page branding.

</domain>

<decisions>
## Implementation Decisions

### Drop zone experience
- Dashed border with upload cloud icon and helper text in idle state
- Drag-over: border changes to accent color with glow effect, zone scales up slightly (transform: scale)
- After files are accepted, drop zone collapses/minimizes — progress shown in separate section below
- Click anywhere on zone opens file picker (equally prominent as drag-and-drop, not just a small link)
- Three distinct visual states: idle (dashed border + icon), drag-over (glow + scale), collapsed (after file acceptance)

### Spacing & hierarchy
- Current spacing is inconsistent — normalize to a consistent rhythm
- Direction: compact / data-dense — minimize whitespace, fit more on screen, tool-like and efficient
- Establish a strict spacing scale in CSS variables (e.g., 4/8/12/16/24/32px) and use only those values
- Full-width layout — use all available screen space, no max-width container

### Job card refinement
- Primary issue: poor info hierarchy — filenames, badges, metadata all compete for attention
- Source filenames should be the most prominent element (biggest/boldest text on card)
- Multi-column grid layout: 2-3 cards per row on desktop, responsive to single column on narrow screens
- Source badge (Device/Server) should be subtle/secondary — small label or icon, doesn't compete with filenames

### Login page
- Branded but simple — app name/logo, clean centered form, subtle background, feels intentional
- Vertically centered on the page
- Heading: "Video Refresher" with a tagline underneath (Claude writes the tagline)
- Overall feel: polished entry point that sets the tone for the tool

### Claude's Discretion
- Exact spacing scale values (proposed 4/8/12/16/24/32px but Claude can adjust)
- Login page tagline copy
- Drag-over glow color/intensity and scale amount
- Grid breakpoints for job card columns
- Drop zone collapse animation (if any)

</decisions>

<specifics>
## Specific Ideas

- Drop zone should feel responsive — the glow + scale on drag-over should make it obvious where to drop
- Job cards: think "data table meets card" — scannable, efficient, filenames jump out
- Login: centered, branded but not over-designed — team tool, not a consumer product

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 18-visual-polish*
*Context gathered: 2026-02-10*
