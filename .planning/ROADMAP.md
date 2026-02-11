# Roadmap: Video Refresher

## Milestones

- v1.0 Batch Processing MVP - Phases 1-5 (shipped 2026-02-07)
- v2.0 Server-Side Multi-Video Processing - Phases 6-9 (shipped 2026-02-08)
- v3.0 Hybrid Processing - Phases 10-13 (shipped 2026-02-09)
- v4.0 Polish & Format Support - Phases 14-19 (in progress)

## Phases

<details>
<summary>v1.0 Batch Processing MVP (Phases 1-5) - SHIPPED 2026-02-07</summary>

See MILESTONES.md for v1.0 details.

Phases 1-5 delivered browser-based batch video variation generator with FFmpeg.wasm 0.12.x, unique effect combinations, ZIP download, and memory management -- fully client-side on Cloudflare Pages.

</details>

<details>
<summary>v2.0 Server-Side Multi-Video Processing (Phases 6-9) - SHIPPED 2026-02-08</summary>

See milestones/v2.0-ROADMAP.md for full v2.0 details.

Phases 6-9 delivered server-side video processing on Fly.io with multi-video batch uploads, fire-and-forget workflow, and a complete API-driven SPA replacing all client-side FFmpeg.wasm code. 4 phases, 12 plans, 25 requirements shipped.

</details>

<details>
<summary>v3.0 Hybrid Processing (Phases 10-13) - SHIPPED 2026-02-09</summary>

See milestones/v3.0-ROADMAP.md for full v3.0 details.

Phases 10-13 delivered hybrid device/server processing mode with upload page toggle, FFmpeg.wasm in Web Workers, server job cancellation, and shared effects library. 4 phases, 8 plans, 14 requirements shipped.

</details>

### v4.0 Polish & Format Support (In Progress)

**Milestone Goal:** Add MOV input support, unify device/server job history, improve visual polish, and add quality-of-life features (notifications, thumbnails).

#### Phase 14: CSS Foundation
**Goal**: Establish CSS custom properties foundation with new dark-mode grayscale palette
**Depends on**: Phase 13
**Requirements**: UI-01
**Success Criteria** (what must be TRUE):
  1. All colors, spacing, and typography values extracted into CSS custom properties
  2. No hardcoded color/spacing values remain in component styles
  3. New dark-mode grayscale palette with bright blue accent applied throughout (visual redesign)
**Plans**: 1 plan

Plans:
- [x] 14-01-PLAN.md — Define CSS custom properties with dark palette, migrate styles.css and view inline styles to use variables

#### Phase 15: Format Support
**Goal**: Users can upload and process MOV files alongside MP4
**Depends on**: Phase 14
**Requirements**: FMT-01, FMT-02
**Success Criteria** (what must be TRUE):
  1. User can select .mov files via click or drag-and-drop on upload page
  2. MOV files pass validation and are accepted for processing
  3. MOV files process successfully in both device and server modes
  4. Output is always MP4 format regardless of input format
**Plans**: 1 plan

Plans:
- [x] 15-01-PLAN.md — Add MOV acceptance to frontend/server validation, fix extension handling in processor and device worker

#### Phase 16: Device Job History Upload
**Goal**: Device-processed results persist to server and create job records
**Depends on**: Phase 15
**Requirements**: HIST-01, HIST-02
**Success Criteria** (what must be TRUE):
  1. After device processing completes, results upload to server automatically
  2. Device-processed jobs create database records with source filenames, variation count, and timestamps
  3. Upload progress visible to user during result upload
  4. Failed uploads show error message and allow retry
**Plans**: 2 plans

Plans:
- [x] 16-01-PLAN.md — Server endpoint for device result upload (schema migration, POST /api/jobs/device, file storage)
- [x] 16-02-PLAN.md — Frontend upload flow after device processing (progress bar, retry, server persistence)

#### Phase 17: Unified History Display
**Goal**: Device and server jobs appear together in history with improved job card layout
**Depends on**: Phase 16
**Requirements**: HIST-03, UX-01, UX-02
**Success Criteria** (what must be TRUE):
  1. Job list displays both device-processed and server-processed jobs in unified view
  2. Job cards show original source video filenames instead of generic "Job N" labels
  3. Video count, variation count, and timestamp align properly in job card layout
  4. User can distinguish device vs server jobs (visual indicator or label)
**Plans**: 1 plan

Plans:
- [x] 17-01-PLAN.md — Add filenames to job list API, redesign cards with filename titles, source badges, and aligned metadata

#### Phase 18: Visual Polish
**Goal**: Improved spacing, visual hierarchy, and upload experience across all views
**Depends on**: Phase 17
**Requirements**: UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. Spacing and visual hierarchy improved across all views (upload, history, login)
  2. Upload drop zone provides clear visual feedback during drag interactions
  3. Drop zone states (idle, drag-over, processing) visually distinct
  4. Job card styling refined with better spacing and cleaner design
**Plans**: 2 plans

Plans:
- [x] 18-01-PLAN.md — Spacing scale, full-width layout, and branded login page
- [x] 18-02-PLAN.md — Drop zone redesign with 3 states and job card grid refinement

#### Phase 19: Enhanced Job Cards
**Goal**: Job cards display video thumbnails and browser notifications alert users when jobs complete
**Depends on**: Phase 18
**Requirements**: UX-03, UX-04
**Success Criteria** (what must be TRUE):
  1. Job cards display video preview thumbnails for quick identification
  2. Thumbnails generated server-side during processing or on first access
  3. User receives browser notification when server job completes (if permission granted)
  4. Notification permission prompt shown on first job submission
  5. Notifications work even when tab is in background or closed
**Plans**: 2 plans

Plans:
- [ ] 19-01-PLAN.md -- Server-side thumbnail generation, serving endpoint, schema migration
- [ ] 19-02-PLAN.md -- Frontend thumbnail display in job cards, browser notification system with toggle

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-5 | v1.0 | 8/8 | Complete | 2026-02-07 |
| 6. Backend Foundation | v2.0 | 3/3 | Complete | 2026-02-07 |
| 7. FFmpeg Processing Engine | v2.0 | 3/3 | Complete | 2026-02-07 |
| 8. Download, Cleanup, Job Lifecycle | v2.0 | 2/2 | Complete | 2026-02-07 |
| 9. Frontend Integration | v2.0 | 4/4 | Complete | 2026-02-08 |
| 10. Foundation & Abstraction | v3.0 | 2/2 | Complete | 2026-02-08 |
| 11. Device Processing Core | v3.0 | 3/3 | Complete | 2026-02-09 |
| 12. Server Job Cancellation | v3.0 | 2/2 | Complete | 2026-02-09 |
| 13. Upload View Integration | v3.0 | 1/1 | Complete | 2026-02-09 |
| 14. CSS Foundation | v4.0 | 1/1 | Complete | 2026-02-10 |
| 15. Format Support | v4.0 | 1/1 | Complete | 2026-02-10 |
| 16. Device Job History Upload | v4.0 | 2/2 | Complete | 2026-02-10 |
| 17. Unified History Display | v4.0 | 1/1 | Complete | 2026-02-10 |
| 18. Visual Polish | v4.0 | 2/2 | Complete | 2026-02-10 |
| 19. Enhanced Job Cards | v4.0 | 0/0 | Not started | - |
