# Phase 14: CSS Foundation - Context

**Gathered:** 2026-02-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract all hardcoded style values (colors, spacing, borders, shadows, typography) into CSS custom properties AND apply a new dark-mode grayscale palette with bright blue accent. This is both a structural refactor and a visual redesign in one phase. No layout changes — just values.

</domain>

<decisions>
## Implementation Decisions

### Variable naming & grouping
- Organized by type: --color-*, --spacing-*, --radius-*, --shadow-*, --font-*
- Two layers: base variables (--color-gray-800) and semantic aliases (--color-bg-primary: var(--color-gray-900))
- Defined in :root block at top of styles.css
- No prefix — standalone app, no namespace needed

### Color palette
- Dark mode: near-black background, white text, grades of gray for surfaces/cards
- Replace purple-pink gradient theme entirely with grayscale
- Primary accent: bright blue (#3b82f6) for action buttons and interactive elements
- Status badges: adapted/muted versions of green, red, blue, gray that fit dark backgrounds
- Navigation: same dark tone as page, subtle border or slight shade difference for separation
- Login button: blue accent (#3b82f6), consistent with new primary action color

### Inline style migration
- Extract hardcoded hex/px values in inline cssText and replace with var() references
- Keep inline cssText structure intact — don't move to CSS classes yet
- Add // TODO: migrate to CSS class comments on inline cssText blocks for Phase 18
- Cover ALL views: login, upload, job-list, job-detail, device-progress

### Scope of extraction
- Full design token system: colors, spacing, border-radius, shadows, font sizes, line heights
- Gradient extracted as --gradient-primary (updated to grayscale or removed)
- New palette applied in this phase — not deferred to Phase 18

### Claude's Discretion
- Exact gray scale values (how many shades, which hex codes)
- Exact muted badge color values for dark backgrounds
- How to handle the gradient (replace with solid dark or subtle dark gradient)
- Font weight variable naming

</decisions>

<specifics>
## Specific Ideas

- "Black and white plus grades of black" — monochrome feel, not just dark gray
- Action buttons should "stand out" against the dark background — blue is the pop of color
- App should feel like a tool, not a colorful web app

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 14-css-foundation*
*Context gathered: 2026-02-09*
