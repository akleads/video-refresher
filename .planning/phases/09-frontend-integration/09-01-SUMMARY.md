---
phase: 09-frontend-integration
plan: 01
subsystem: ui
tags: [spa, hash-router, api-client, css, vanilla-js]

# Dependency graph
requires:
  - phase: 08-api-integration
    provides: Server API endpoints with auth, job creation, status, download
provides:
  - SPA infrastructure with hash-based routing
  - Centralized API client with auth token injection and 401 handling
  - Complete CSS styling for all views
  - View containers and placeholder files
affects: [09-02, 09-03, 09-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hash-based SPA routing with parameterized routes"
    - "Centralized API client with Bearer token authentication"
    - "localStorage for token persistence"
    - "ES modules for all JavaScript files"

key-files:
  created:
    - lib/api.js
    - lib/router.js
    - lib/utils.js
    - views/login.js
    - views/upload.js
    - views/job-list.js
    - views/job-detail.js
  modified:
    - index.html
    - app.js
    - styles.css

key-decisions:
  - "API base URL determined by hostname: localhost uses :8080, production uses Fly.io URL"
  - "XHR used for file uploads to support progress events, fetch used for all other API calls"
  - "Router auth guard redirects to login if token missing (except on login/empty routes)"
  - "Nav hidden on login view, visible on all authenticated views"

patterns-established:
  - "All view render functions receive params object from router"
  - "Status badges color-coded by job status (queued, processing, completed, failed, expired)"
  - "Gradient color scheme #667eea → #764ba2 maintained from v1.0"

# Metrics
duration: 3min
completed: 2026-02-07
---

# Phase 09 Plan 01: SPA Infrastructure Summary

**Hash-based routing, centralized API client with Bearer auth and 401 handling, complete UI styles, and view placeholders for all four pages**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-07T17:47:37Z
- **Completed:** 2026-02-07T17:50:11Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Clean SPA shell with nav tabs and 4 view containers, zero FFmpeg/wasm/JSZip references
- Hash-based router with parameterized routes (job/:id) and auth guard
- API client with automatic Bearer token injection and 401 session expiry handling
- 571 lines of CSS covering login, upload, job list, job detail, progress bars, status badges

## Task Commits

Each task was committed atomically:

1. **Task 1: Create lib/ modules (api.js, router.js, utils.js)** - `dd10f01` (feat)
2. **Task 2: Create index.html shell, app.js entry point, and styles.css** - `a3b0630` (feat)

## Files Created/Modified

**Created:**
- `lib/api.js` - API client with auth header injection, 401 handling, uploadFiles with XHR progress
- `lib/router.js` - Hash router with parameterized routes and auth guard
- `lib/utils.js` - Helpers: formatBytes, timeUntil, timeAgo, $, $$
- `views/login.js` - Login view placeholder
- `views/upload.js` - Upload view placeholder
- `views/job-list.js` - Job list view placeholder
- `views/job-detail.js` - Job detail view placeholder

**Modified:**
- `index.html` - Replaced FFmpeg-based UI with clean SPA shell (nav + 4 view containers)
- `app.js` - Replaced 1001 lines of FFmpeg processing with 76-line routing entry point
- `styles.css` - Replaced old styles with comprehensive 571-line stylesheet

## Decisions Made

- **API base URL auto-detection:** localhost hostname uses http://localhost:8080, otherwise uses Fly.io production URL (https://video-refresher-api.fly.dev)
- **XHR for uploads:** Used XMLHttpRequest instead of fetch for file uploads to support progress events on xhr.upload
- **Auth guard in router:** Router checks isAuthenticated() before rendering any route except login/empty hash, redirects to login if token missing
- **Nav visibility toggling:** Nav hidden when viewName === 'login', visible for all other views

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for view implementation (plans 02-04):**
- All view placeholders exist and are wired into routing
- API client ready for login, job creation, polling, download
- CSS styles ready for all UI components
- Router handles all navigation patterns (tabs, login redirect, job detail params)

**No blockers or concerns.**

---
*Phase: 09-frontend-integration*
*Completed: 2026-02-07*
