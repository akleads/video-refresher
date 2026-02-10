# Requirements: Video Refresher

**Defined:** 2026-02-09
**Core Value:** Upload video creatives, get multiple unique variations ready for ad platform rotation — fast, without waiting at the screen.

## v4.0 Requirements

Requirements for v4.0 Polish & Format Support. Each maps to roadmap phases.

### Format Support

- [ ] **FMT-01**: User can upload .mov video files via click or drag-and-drop
- [ ] **FMT-02**: Uploaded .mov files are validated and accepted alongside .mp4, with output always in MP4 format

### Unified Job History

- [ ] **HIST-01**: Device-processed results are uploaded to the server after processing completes
- [ ] **HIST-02**: Device-processed jobs create a job record in the database with source filenames, variation count, and timestamps
- [ ] **HIST-03**: Device-processed jobs appear in the job list alongside server-processed jobs

### Job Cards & UX

- [ ] **UX-01**: Job cards display original source video filenames instead of generic "Job N" labels
- [ ] **UX-02**: Job card layout properly aligns video count, variation count, and timestamp
- [ ] **UX-03**: Job cards display video preview thumbnails for quick identification
- [ ] **UX-04**: User receives browser notification when a server job completes (with permission prompt)

### Visual Polish

- [ ] **UI-01**: Colors, spacing, and typography values extracted into CSS custom properties
- [ ] **UI-02**: Improved spacing and visual hierarchy across all views
- [ ] **UI-03**: Upload drop zone redesigned with better visual feedback during drag interactions
- [ ] **UI-04**: Job card styling refined with better spacing and cleaner design

## Future Requirements

### Deferred

- **FUTURE-01**: SSE real-time progress (replace polling)
- **FUTURE-02**: Retry failed videos
- **FUTURE-03**: Resumable uploads for large files
- **FUTURE-04**: Metadata manifest in ZIP download
- **FUTURE-05**: Re-process from history without re-uploading

## Out of Scope

| Feature | Reason |
|---------|--------|
| Video formats beyond MP4/MOV | MP4 and MOV cover ad platform needs |
| MOV output format | Ad platforms prefer MP4; always output MP4 |
| Manual effect selection | Defeats "quick refresh" value prop |
| Individual user accounts | Shared password sufficient for small team |
| Dark mode | Not requested, visual polish keeps current theme |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FMT-01 | — | Pending |
| FMT-02 | — | Pending |
| HIST-01 | — | Pending |
| HIST-02 | — | Pending |
| HIST-03 | — | Pending |
| UX-01 | — | Pending |
| UX-02 | — | Pending |
| UX-03 | — | Pending |
| UX-04 | — | Pending |
| UI-01 | — | Pending |
| UI-02 | — | Pending |
| UI-03 | — | Pending |
| UI-04 | — | Pending |

**Coverage:**
- v4.0 requirements: 13 total
- Mapped to phases: 0
- Unmapped: 13 (pending roadmap creation)

---
*Requirements defined: 2026-02-09*
*Last updated: 2026-02-09 after initial definition*
