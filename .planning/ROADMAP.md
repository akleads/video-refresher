# Roadmap: Video Refresher

## Milestones

- v1.0 Batch Processing MVP - Phases 1-5 (shipped 2026-02-07)
- v2.0 Server-Side Multi-Video Processing - Phases 6-9 (shipped 2026-02-08)
- v3.0 Hybrid Processing - Phases 10-13 (in progress)

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

### v3.0 Hybrid Processing (In Progress)

**Milestone Goal:** Give users a choice -- process on device (instant, no server) or send to server (faster, fire-and-forget) -- plus the ability to cancel in-progress server jobs.

- [x] **Phase 10: Foundation & Abstraction** - Cross-origin headers, shared effects library, capability detection
- [ ] **Phase 11: Device Processing Core** - FFmpeg.wasm in Web Worker with ZIP download and progress
- [ ] **Phase 12: Server Job Cancellation** - Cancel endpoint, graceful FFmpeg kill, cancelled status
- [ ] **Phase 13: Upload View Integration** - Mode toggle UI, localStorage persistence, mode-aware submit

## Phase Details

### Phase 10: Foundation & Abstraction
**Goal**: Infrastructure and abstractions are in place so both processing modes can share the same effect generation logic, and the browser can use SharedArrayBuffer
**Depends on**: Phase 9 (v2.0 frontend)
**Requirements**: INFRA-06, INFRA-07, MODE-03, DEVC-05
**Success Criteria** (what must be TRUE):
  1. Frontend pages load with COOP/COEP headers active and SharedArrayBuffer is available in browser console
  2. Backend API responses include Cross-Origin-Resource-Policy: cross-origin header, and frontend fetches to the API succeed under COEP
  3. A shared effects module generates identical effect parameter sets when given the same seed, usable from both browser and server contexts
  4. Browser capability detection correctly identifies whether SharedArrayBuffer is available and reports this to the UI layer
**Plans**: 2 plans

Plans:
- [x] 10-01-PLAN.md -- Backend CORP header middleware + shared effects module with seedrandom
- [x] 10-02-PLAN.md -- Frontend COOP/COEP headers + browser capability detection

### Phase 11: Device Processing Core
**Goal**: Users can process videos entirely in the browser using FFmpeg.wasm, with progress feedback and ZIP download, without touching the server API
**Depends on**: Phase 10
**Requirements**: DEVC-01, DEVC-02, DEVC-03, DEVC-04
**Success Criteria** (what must be TRUE):
  1. User can process a video on-device and FFmpeg.wasm runs in a Web Worker with multi-threaded support (no main thread blocking)
  2. Per-variation progress is displayed during device processing (user sees which variation is being processed and approximate completion)
  3. Completed variations are bundled into a ZIP file for download, generated with client-zip streaming
  4. No network requests are made to the server API during device processing -- the entire flow is local
**Plans**: 3 plans

Plans:
- [ ] 11-01-PLAN.md -- Install deps + FFmpeg Web Worker + ZIP generator module
- [ ] 11-02-PLAN.md -- Worker pool manager + progress tracker
- [ ] 11-03-PLAN.md -- Device progress view + SPA routing + verification

### Phase 12: Server Job Cancellation
**Goal**: Users can cancel in-progress server jobs, with the server gracefully killing FFmpeg and cleaning up partial files
**Depends on**: Phase 10 (COEP headers needed for frontend to function)
**Requirements**: CANC-01, CANC-02, CANC-03, CANC-04
**Success Criteria** (what must be TRUE):
  1. Job detail page shows a Cancel button for jobs with "processing" status
  2. Clicking Cancel sends a request that kills the running FFmpeg process on the server and removes partial output files
  3. FFmpeg termination follows the graceful sequence: stdin 'q' first, then SIGTERM, then SIGKILL as escalation
  4. Cancelled jobs display "Cancelled" status in the job history list and on the job detail page
**Plans**: TBD

Plans:
- [ ] 12-01: TBD
- [ ] 12-02: TBD

### Phase 13: Upload View Integration
**Goal**: Upload page presents a clear choice between device and server processing, remembers the preference, and routes submissions accordingly
**Depends on**: Phase 11, Phase 12
**Requirements**: MODE-01, MODE-02
**Success Criteria** (what must be TRUE):
  1. Upload page displays radio buttons for "Process on device" and "Send to server" with server as the default
  2. Selecting a mode and submitting routes to the correct processing path (device-local or server API)
  3. Mode preference persists across browser sessions via localStorage -- returning users see their last choice pre-selected
  4. When SharedArrayBuffer is unavailable, "Process on device" option is disabled with an explanatory note, and server mode is auto-selected
**Plans**: TBD

Plans:
- [ ] 13-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11 -> 12 -> 13

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-5 | v1.0 | 8/8 | Complete | 2026-02-07 |
| 6. Backend Foundation | v2.0 | 3/3 | Complete | 2026-02-07 |
| 7. FFmpeg Processing Engine | v2.0 | 3/3 | Complete | 2026-02-07 |
| 8. Download, Cleanup, Job Lifecycle | v2.0 | 2/2 | Complete | 2026-02-07 |
| 9. Frontend Integration | v2.0 | 4/4 | Complete | 2026-02-08 |
| 10. Foundation & Abstraction | v3.0 | 2/2 | Complete | 2026-02-08 |
| 11. Device Processing Core | v3.0 | 0/3 | Not started | - |
| 12. Server Job Cancellation | v3.0 | 0/TBD | Not started | - |
| 13. Upload View Integration | v3.0 | 0/TBD | Not started | - |
