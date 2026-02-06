# Requirements: Video Refresher

**Defined:** 2026-02-06
**Core Value:** Upload one video creative, get multiple unique variations ready for ad platform rotation — fast and without leaving the browser.

## v1 Requirements

### Batch Generation

- [ ] **BATCH-01**: User can specify number of variations via number input field (1-20 range)
- [ ] **BATCH-02**: Each variation receives a unique random combination of effects (no duplicate combos within batch)
- [ ] **BATCH-03**: User can cancel batch processing mid-operation
- [ ] **BATCH-04**: Processed variations follow consistent naming: `originalname_var1_abc123.mp4`

### Progress & UX

- [ ] **PROG-01**: UI shows per-variation progress: "Processing variation 3/10..." with progress bar
- [ ] **PROG-02**: First completed variation displayed in existing preview area for quality check

### Memory Management

- [ ] **MEM-01**: Blob URLs revoked between variations to prevent memory leaks
- [ ] **MEM-02**: FFmpeg virtual filesystem cleaned between each variation
- [ ] **MEM-03**: processedVideos array managed — old entries cleaned up
- [ ] **MEM-04**: FFmpeg instance recovery on partial failure (reload if corrupted)

### Download

- [ ] **DL-01**: All variations downloadable as single ZIP file via JSZip
- [ ] **DL-02**: ZIP uses STORE compression (no re-compression of video data)

### Performance

- [ ] **PERF-01**: FFmpeg.wasm upgraded from 0.11.6 to 0.12.x for multi-threading support
- [ ] **PERF-02**: Encoding uses ultrafast preset for ~30% speed improvement
- [ ] **PERF-03**: Input video buffer read once and reused across all variations

## v2 Requirements

### Differentiators

- **DIFF-01**: Effect intensity control — slider from "Subtle" to "Dramatic" adjusting random ranges
- **DIFF-02**: Smart effect distribution — ensure batch collectively covers all effect types
- **DIFF-03**: Metadata export — JSON manifest in ZIP describing effects per variation
- **DIFF-04**: Preview all variations — thumbnail grid or carousel before download

## Out of Scope

| Feature | Reason |
|---------|--------|
| Manual effect selection per variation | Creates decision fatigue, defeats "quick refresh" value prop |
| Server-side processing | Adds infrastructure cost, must stay client-side per project constraints |
| Individual variation downloads alongside ZIP | Clutters UI; batch = bulk operation |
| Variation comparison UI | Memory nightmare (20 video blobs in DOM), users compare after download |
| Persistent history across sessions | Session-based sufficient; batch multiplies storage 20x |
| Custom effect presets | Feature creep; random variations are the point |
| Video format conversion beyond MP4 | MP4 is ad platform standard |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PERF-01 | Phase 1 | Pending |
| MEM-01 | Phase 2 | Pending |
| MEM-02 | Phase 2 | Pending |
| MEM-03 | Phase 2 | Pending |
| MEM-04 | Phase 2 | Pending |
| PERF-02 | Phase 3 | Pending |
| PERF-03 | Phase 3 | Pending |
| BATCH-01 | Phase 4 | Pending |
| BATCH-02 | Phase 4 | Pending |
| BATCH-03 | Phase 4 | Pending |
| BATCH-04 | Phase 4 | Pending |
| PROG-01 | Phase 4 | Pending |
| PROG-02 | Phase 4 | Pending |
| DL-01 | Phase 5 | Pending |
| DL-02 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0 (100% coverage)

---
*Requirements defined: 2026-02-06*
*Last updated: 2026-02-06 after roadmap creation*
