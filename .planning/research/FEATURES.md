# Feature Landscape: Video Creative Variation / Batch Generation

**Domain:** Browser-based video creative variation tools for ad platforms
**Researched:** 2026-02-06
**Confidence:** MEDIUM (synthesized from domain knowledge of ad creative tools, video processing patterns, and batch generation UX; WebSearch unavailable for verification)

## Research Context

This feature analysis focuses specifically on **batch variation generation** for an existing video refresher tool. The tool already handles single-video processing with random visual effects. The milestone adds the ability to generate multiple unique variations (5-20) from a single upload, each with different random effect combinations, downloadable as a ZIP.

**Constraints informing this analysis:**
- Browser-based processing (FFmpeg.wasm) with memory limits
- Client-side only, no backend
- MP4 input/output only
- Existing effects: zoom, color shift, noise, speed, mirror
- Current sequential queue processing architecture

## Table Stakes

Features users expect when generating multiple variations. Missing these = feature feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Specify variation count** | Users need control over how many variations they get | Low | Number input (5-20 range). Simple validation and state management. |
| **Unique effect combinations per variation** | Core value prop — variations must differ or ad platforms detect duplicates | Low | Already have randomization logic; need to ensure no repeat combinations within batch. |
| **Progress indication per variation** | Processing 5-20 videos takes minutes; users need to know it's working | Medium | Need "Processing variation 3/10..." messaging. Existing progress bar needs batch context. |
| **Bulk download (ZIP)** | Downloading 20 individual files is tedious and error-prone | Medium | Browser ZIP library (JSZip), blob creation, memory-conscious streaming. |
| **Cancel batch operation** | If something looks wrong, users want to stop without waiting for all variations | Low | Add cancel flag checked between variations in queue loop. |
| **Consistent naming scheme** | Users need to identify which variations came from which source | Low | `originalname_var1_abc123.mp4`, `originalname_var2_def456.mp4`. Existing unique ID generation. |
| **Memory cleanup between variations** | Browser will crash if blob URLs accumulate across 20 variations | Medium | Revoke blob URLs after ZIP creation, cleanup FFmpeg FS between variations. Already flagged as concern. |
| **Preview at least one variation** | Users want to verify quality before downloading entire batch | Low | Show first variation preview (existing preview UI). Optional: show last variation too. |

## Differentiators

Features that set this tool apart. Not expected, but create competitive advantage or delight.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Effect intensity control** | Let users specify how different variations should be (subtle vs dramatic) | Medium | Slider: "Subtle" (±5% effects) to "Dramatic" (±30% effects). Changes random range bounds. Differentiates from "just random" tools. |
| **Preview all variations before download** | Confidence before committing to 10min download | High | Thumbnail grid or carousel. Memory-intensive (need to hold all blobs). Could defer to post-MVP. |
| **Guaranteed minimum difference** | Ensure no two variations are too similar (perceptual hash distance threshold) | High | Would require perceptual hashing library (pHash, Hamming distance). Significant complexity for marginal UX gain. Probably overkill. |
| **Export metadata file** | JSON manifest of which effects applied to each variation (for QA tracking) | Low | Write JSON to ZIP: `{var1: {zoom: 1.05, color: {...}}, var2: {...}}`. Useful for power users troubleshooting platform issues. |
| **Resume failed batch** | If browser crashes at variation 8/20, resume from where left off | High | Requires IndexedDB or localStorage to persist processed variations. Complex state management. Likely not worth it for 5-20 variations. |
| **Parallel processing (if possible)** | Generate multiple variations simultaneously | Very High | FFmpeg.wasm memory constraints make this impractical. Each instance needs ~100-200MB. Browser likely can't handle 3+ concurrent FFmpeg instances. |
| **Smart effect distribution** | Ensure batch collectively covers all effect types (no batch with only zoom) | Medium | Track effect usage across batch, bias randomization toward underused effects. Nice for comprehensive testing. |
| **Duplicate detection prevention** | Check if newly generated variation too similar to previous, regenerate if so | High | Perceptual hashing + comparison. Expensive. Better solved by "smart effect distribution." |

## Anti-Features

Features to explicitly NOT build. Common mistakes in this domain.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Manual effect selection per variation** | User selects specific effects for each of 20 variations | Creates decision fatigue. Defeats "quick refresh" value prop. Users would spend 10min configuring instead of 30sec uploading. Keep it random. |
| **Server-side processing** | Move to backend for "better performance" | Adds infrastructure cost, deployment complexity, privacy concerns. Existing constraint: must stay client-side. Performance is good enough. |
| **Effect preview before batch generation** | Show effect preview, ask "proceed with batch?" | Slows workflow. Effects are random per variation anyway, preview is misleading. Just generate and let user preview first result. |
| **Individual variation download alongside ZIP** | Provide both "download all" and "download variation 5" buttons | Clutters UI. If user wants individual control, they should generate variations one at a time. Batch = bulk operation. |
| **Variation comparison UI** | Side-by-side player to compare variations 1-20 | Memory nightmare (20 video blobs in DOM). Complex UI. Users can compare after downloading. Not core to "refresh for ad platforms" use case. |
| **Persistent history across sessions** | Save all past batches in browser storage | Already out of scope per PROJECT.md. Session-based is sufficient. Batch generation multiplies storage requirements (20x files). |
| **Custom effect presets** | Save/load named effect configurations | Feature creep. Random variations are the point. If users want reproducibility, they should use desktop video tools. |
| **Video format conversion** | Support MOV, AVI, WebM input | Adds complexity. MP4 is ad platform standard (PROJECT.md constraint). Users can convert before upload. |

## Feature Dependencies

```
Specify variation count
    ↓
Generate unique effect combinations per variation
    ↓ (for each variation)
    ├→ Progress indication per variation
    ├→ Memory cleanup between variations
    ↓
Preview first variation (quality check)
    ↓
Bulk download (ZIP)
    └→ Consistent naming scheme
    └→ Export metadata file (optional)

[Independent branch]
Cancel batch operation (can trigger anytime during processing)

[Differentiators depend on table stakes]
Effect intensity control → modifies "unique effect combinations"
Smart effect distribution → modifies "unique effect combinations"
```

**Critical path:** Variation count input → Effect generation → ZIP download
**Blockers:** Memory cleanup must work before scaling to 20 variations
**Optional:** Preview, metadata export, effect control (can be added later)

## MVP Recommendation

For this milestone's MVP, prioritize:

### Must-Have (Table Stakes)
1. **Specify variation count** — Input field with validation (5-20 range)
2. **Unique effect combinations per variation** — Refactor randomization to track used combinations
3. **Progress indication per variation** — "Processing variation 3/10..."
4. **Memory cleanup between variations** — Revoke blob URLs, cleanup FFmpeg FS
5. **Consistent naming scheme** — `originalname_var1_abc123.mp4`
6. **Bulk download (ZIP)** — JSZip integration
7. **Cancel batch operation** — Stop button that interrupts queue
8. **Preview first variation** — Show first completed video in existing preview area

### Nice-to-Have (Low Complexity Differentiators)
9. **Export metadata file** — JSON in ZIP describing effects per variation (if time permits)

### Defer to Post-MVP
- **Effect intensity control** — Needs UX design, adds complexity to randomization logic
- **Smart effect distribution** — Optimization that requires measuring effect usage
- **Preview all variations** — Memory-intensive, complex UI
- **Guaranteed minimum difference** — Requires perceptual hashing library

### Explicitly Reject
- Manual effect selection per variation
- Server-side processing
- Individual variation downloads
- Variation comparison UI
- Persistent history
- Custom effect presets
- Video format conversion

## Complexity Estimates

| Feature Category | Total Complexity | Time Estimate |
|------------------|------------------|---------------|
| **Core batch generation** (count input, unique effects, naming, cancel) | Low-Medium | 2-4 hours |
| **ZIP download** (JSZip, blob handling) | Medium | 3-5 hours |
| **Progress & memory management** (per-variation progress, cleanup) | Medium | 3-4 hours |
| **Preview handling** (first variation) | Low | 1-2 hours |
| **Metadata export** (optional) | Low | 1-2 hours |
| **Testing & edge cases** | Medium | 3-5 hours |
| **TOTAL MVP** | | 13-22 hours |

## Domain-Specific Insights

Based on ad creative refresh tool patterns:

**What users actually need:**
- Speed over perfection (5-20 variations in <10 minutes is acceptable)
- "Good enough" uniqueness (ad platforms have low similarity threshold)
- Bulk operations (downloading 20 individual files breaks flow)
- Reliability over features (crashes on variation 18/20 is worse than no batch mode)

**What users don't use:**
- Fine-grained control (defeats quick refresh purpose)
- Comparison tools (they upload to ad platform and test there)
- History/persistence (they generate fresh for each campaign)

**Memory is the critical constraint:**
- Each variation generates ~50-200MB blob
- Browser memory limit ~2GB total
- Must revoke blobs progressively, not accumulate
- ZIP creation should stream, not load all into memory

**Effect randomization insights:**
- Ad platforms detect duplicates via perceptual hash (loose threshold)
- ±10-20% variation in any dimension usually sufficient
- Multiple small changes > one large change (combine zoom + color > just zoom)
- Metadata removal alone doesn't create uniqueness (platforms are smarter)

## Open Questions

1. **Should we allow >20 variations?** Memory and time both scale linearly. 50 variations = 25+ minutes processing. Probably better to cap at 20, run multiple batches.

2. **Should ZIP download be automatic or triggered?** Auto-download on completion vs "Download ZIP" button. Auto is faster workflow, button gives user control to preview first.

3. **Should we show all-at-once progress vs per-variation?** "Processing variation 3/10 (65%)" vs "Overall progress: 30%". Per-variation is more informative but wordier.

4. **Should cancelled batches be partially downloadable?** If user cancels at 5/10, offer ZIP of completed 5? Adds complexity but recovers partial work.

## Sources

**Confidence level: MEDIUM**

This analysis synthesized from:
- Domain knowledge of ad creative tools (AdCreative.ai, Creatopy, Canva batch features)
- Video processing batch patterns (Handbrake, FFmpeg CLI workflows)
- Browser-based file generation UX patterns (ZIP downloads, blob URL management)
- WebAssembly memory constraints from FFmpeg.wasm documentation patterns
- Ad platform duplicate detection behavior (Meta, Google Ads policies)

**NOT verified via:**
- WebSearch (unavailable during research)
- Competitor product analysis (no access to specific tools)
- User research (no user interviews conducted)

**Recommendations are opinionated based on:**
- Project constraints (browser-only, memory limits, MP4-only)
- Existing architecture (sequential queue, existing effect randomization)
- Time-to-value for milestone (prioritizing MVP completeness over feature breadth)

---

*This research is specific to the batch variation generation milestone. For broader video creative tool feature landscape, additional research would cover: template systems, text overlay, audio handling, aspect ratio conversion, brand kit integration, collaboration features, analytics integration, etc.*
