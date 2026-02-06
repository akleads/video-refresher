# Architecture Patterns: Batch Browser Video Processing

**Domain:** Browser-based batch video processing with FFmpeg.wasm
**Researched:** 2026-02-06
**Confidence:** MEDIUM (based on existing codebase analysis and FFmpeg.wasm architectural constraints from training data)

## Executive Summary

Adding batch variation generation (5-20 variations from one upload) to the existing sequential video processing app requires architectural changes to handle N-to-N data flow, memory management, and performance optimization. The core challenge is balancing browser memory constraints (~100-200MB) with the need to process multiple variations efficiently.

**Key architectural decision:** Keep single FFmpeg instance with enhanced queue system rather than parallel Web Workers due to FFmpeg.wasm memory limitations and SharedArrayBuffer constraints.

**Critical constraint:** Browser memory limits mean input file must be read once and reused across all variations, not re-read N times.

## Recommended Architecture

### Overall Structure

```
┌─────────────────────────────────────────────────────────────┐
│                      Main Thread (UI)                        │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐│
│  │ Upload Handler │  │  Batch Config  │  │   Download     ││
│  │  (1 file → N)  │  │  (N spinner)   │  │   Manager      ││
│  └───────┬────────┘  └────────────────┘  └────────────────┘│
│          │                                                   │
│          ▼                                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          Variation Generation Controller             │  │
│  │  - Input file buffer (read once, reuse N times)      │  │
│  │  - Random effect generator (unique per variation)    │  │
│  │  - Batch progress aggregator                         │  │
│  └─────────────────────┬────────────────────────────────┘  │
│                        │                                    │
│                        ▼                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          FFmpeg Processing Queue                     │  │
│  │  - Enhanced sequential queue (existing)              │  │
│  │  - Per-variation FFmpeg commands                     │  │
│  │  - Memory cleanup after each variation               │  │
│  └─────────────────────┬────────────────────────────────┘  │
│                        │                                    │
│                        ▼                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │      FFmpeg.wasm Instance (Singleton, existing)      │  │
│  │  - Virtual FS operations                             │  │
│  │  - Video encoding                                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                        │                                    │
│                        ▼                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Variation Collection & ZIP Manager           │  │
│  │  - Blob accumulator (memory-aware)                   │  │
│  │  - JSZip integration                                 │  │
│  │  - Bulk download trigger                             │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Why Not Web Workers?

**Decision:** Do NOT use Web Workers for parallel FFmpeg instances.

**Rationale:**
1. **Memory multiplier:** Each FFmpeg instance requires 20-50MB base memory. N workers × (20MB + input file + intermediate buffers) quickly exceeds browser limits
2. **SharedArrayBuffer constraint:** FFmpeg.wasm requires SharedArrayBuffer with COOP/COEP headers. Multiple workers share same memory space, causing contention
3. **FFmpeg.wasm limitation:** Not designed for parallel instances in browser context. Single instance with sequential processing is the supported pattern
4. **Existing proven pattern:** Current app uses single instance successfully. Leverage that investment

**Alternative considered:** Web Worker for UI responsiveness (move FFmpeg off main thread). Rejected because:
- FFmpeg.wasm 0.11.6 has known Worker mode issues (see existing codebase comment: "Using older version 0.11.6 which doesn't have worker CORS issues")
- Adding Worker complexity for unproven benefit given sequential processing requirement

## Component Boundaries

### Component 1: Batch Configuration Interface
**Responsibility:** Capture user intent for batch generation
**Communicates with:** Upload Handler, Variation Generation Controller
**State:**
- Number of variations (default: 5, range: 1-20)
- Effect randomization seed (optional for reproducibility)

**Interface:**
```javascript
// Input
{
  variationCount: number,      // 1-20
  effectRandomness: 'high' | 'medium' | 'low'  // How different variations are
}

// Output to controller
BatchConfig {
  count: number,
  effects: EffectConfig[]  // Pre-generated array of N unique effect combinations
}
```

**Build dependency:** None (UI-only component, can be built first)

---

### Component 2: Variation Generation Controller
**Responsibility:** Orchestrate creation of N variations from single input
**Communicates with:** Batch Config Interface, FFmpeg Processing Queue, Upload Handler, ZIP Manager
**State:**
- Input file ArrayBuffer (read once, retained in memory)
- Current variation index (1 to N)
- Batch progress (aggregate across all variations)
- Generated variation metadata (name, effects applied, blob reference)

**Interface:**
```javascript
// Input
{
  file: File,              // Original uploaded file
  config: BatchConfig      // From Batch Configuration Interface
}

// Methods
async generateVariations(file, config): Promise<Variation[]>
async generateSingleVariation(buffer, effectConfig, index): Promise<Variation>
getBatchProgress(): { current: number, total: number, percent: number }

// Output
Variation {
  id: string,              // unique identifier
  name: string,            // e.g., "video_var001.mp4"
  blob: Blob,              // processed video
  blobURL: string,         // for preview
  effectsApplied: string[],// list of effects
  fileSize: number,
  processingTime: number   // milliseconds
}
```

**Memory management critical:**
- Read `file.arrayBuffer()` ONCE at batch start
- Store buffer in controller scope
- Pass buffer reference to each variation (no re-read)
- Release buffer after all N variations complete
- Release individual blob URLs after ZIP creation OR on user-triggered clear

**Build dependency:** Requires existing FFmpeg queue infrastructure (Component 3)

---

### Component 3: Enhanced FFmpeg Processing Queue
**Responsibility:** Process variations sequentially through single FFmpeg instance
**Communicates with:** Variation Generation Controller, FFmpeg.wasm Instance, Progress UI
**State:**
- Queue of pending variations (VariationTask[])
- Current processing task
- Processing flag (boolean, existing)

**Interface:**
```javascript
// Input
VariationTask {
  inputBuffer: ArrayBuffer,     // Reused across all tasks
  outputFileName: string,
  ffmpegCommand: string[],      // FFmpeg args for this variation
  effectConfig: EffectConfig,
  onProgress: (percent) => void,
  onComplete: (blob) => void,
  onError: (error) => void
}

// Methods (extends existing queue)
async enqueueVariation(task: VariationTask): void
async processVariation(task: VariationTask): Promise<Blob>
cleanupVariation(): void  // Enhanced cleanup
```

**Enhancement over existing:**
- **Existing:** Reads each file from File API per processing
- **New:** Accepts pre-read ArrayBuffer, writes to FFmpeg FS, processes, cleans up
- **Existing:** `processedVideos` array grows indefinitely
- **New:** Variations stored in batch-specific collection, cleared after ZIP download

**Build dependency:** Extends existing queue (lines 172-196 in app.js)

---

### Component 4: Random Effect Generator
**Responsibility:** Generate unique FFmpeg command variations
**Communicates with:** Variation Generation Controller
**State:** None (pure function, stateless)

**Interface:**
```javascript
// Input
{
  variationIndex: number,     // 0 to N-1
  randomnessSeed: number,     // For reproducibility
  effectIntensity: 'high' | 'medium' | 'low'
}

// Output
EffectConfig {
  rotation: number,           // Degrees: -5 to +5
  brightness: number,         // -0.05 to +0.05
  contrast: number,           // 0.95 to 1.05
  saturation: number,         // 0.95 to 1.05
  frameRate: number,          // 29.5 to 30.5
  zoom: number,               // 1.0 to 1.02 (subtle)
  mirror: boolean,            // true/false (50% chance)
  noise: number               // 0 to 3 (atadenoise strength)
}

// Method
generateEffectConfig(index, seed, intensity): EffectConfig
effectConfigToFFmpegArgs(config): string[]  // Converts to -vf filter chain
```

**Example FFmpeg command output:**
```bash
-vf "rotate=0.00349,eq=brightness=0.01:contrast=1.01:saturation=1.01,zoompan=z='min(zoom+0.0002,1.02)':d=1,atadenoise=0a=1,hflip"
```

**Build dependency:** None (pure utility, can be built first)

---

### Component 5: ZIP Download Manager
**Responsibility:** Aggregate N variations into single ZIP download
**Communicates with:** Variation Generation Controller, Download UI
**State:**
- Variations to bundle (Variation[])
- ZIP generation progress

**Interface:**
```javascript
// Input
{
  variations: Variation[],
  zipFileName: string  // e.g., "refreshed_variations_20260206.zip"
}

// Methods
async createZIP(variations): Promise<Blob>
downloadZIP(zipBlob, fileName): void
```

**Implementation approach:**
- Use **JSZip** library (35KB gzipped, well-maintained)
- Stream variations into ZIP in memory (avoid re-reading blobs)
- Trigger download via `<a>` element with blob URL

**Memory consideration:**
- ZIP creation duplicates memory temporarily (variations + ZIP blob)
- For 10 variations × 5MB each = 50MB input → ~50MB ZIP
- Peak memory: ~100MB during ZIP creation
- Mitigation: Release variation blob URLs immediately after ZIP creation

**Build dependency:** Requires Component 2 (Variation Generation Controller) to provide variations array

---

### Component 6: Memory Manager (Cross-cutting)
**Responsibility:** Prevent memory leaks and manage browser memory constraints
**Communicates with:** All components
**State:**
- Active blob URL registry (Map<string, string>)
- Memory usage estimates

**Interface:**
```javascript
// Methods
registerBlobURL(url: string, context: string): void
revokeBlobURL(url: string): void
revokeAllBlobURLs(context: string): void
estimateMemoryUsage(): { used: number, available: number, safe: boolean }
```

**Hooks into:**
- **After single variation complete:** Revoke preview blob URL if not needed
- **After ZIP creation:** Revoke all variation blob URLs
- **Before new batch start:** Check estimated memory, warn user if unsafe
- **On page unload:** Revoke all registered URLs

**Build dependency:** Core infrastructure, build early (after queue enhancement)

---

### Component 7: Batch Progress Aggregator
**Responsibility:** Combine per-variation progress into overall batch progress
**Communicates with:** Variation Generation Controller, Progress UI
**State:**
- Per-variation progress (Map<variationId, percent>)
- Overall batch progress

**Interface:**
```javascript
// Input
{
  variationId: string,
  progress: number  // 0-100
}

// Methods
updateVariationProgress(id, percent): void
getOverallProgress(): { current: number, total: number, percent: number, message: string }

// Output
{
  current: 3,                    // Variations completed
  total: 10,                     // Total variations
  percent: 25,                   // Overall progress (variation 3 at 50% = 25% overall)
  message: "Processing variation 3 of 10... 50%"
}
```

**Build dependency:** After Component 2 (Variation Generation Controller)

## Data Flow: One Input → N Outputs

### Batch Generation Flow

```
1. User uploads file + specifies N variations (e.g., 10)
   ↓
2. Batch Config Interface: Generate N unique EffectConfig objects
   ↓
3. Variation Generation Controller:
   - Read file.arrayBuffer() ONCE
   - Store buffer in memory
   ↓
4. For i = 1 to N:
   ↓
   4a. Generate FFmpeg command from EffectConfig[i]
   ↓
   4b. Enqueue VariationTask:
       - inputBuffer: [shared ArrayBuffer reference]
       - outputFileName: "video_var{i:03d}.mp4"
       - ffmpegCommand: [effect-specific args]
   ↓
   4c. FFmpeg Processing Queue:
       - Write inputBuffer to FFmpeg FS as "input.mp4"
       - Execute FFmpeg with variation-specific command
       - Read output from FFmpeg FS
       - Create Blob
       - Cleanup FFmpeg FS (unlink input.mp4, output.mp4)
   ↓
   4d. Store Variation object:
       - blob, blobURL, metadata
   ↓
   4e. Update batch progress (i/N)
   ↓
   4f. Small delay (100ms) before next variation
   ↓
5. After N variations complete:
   ↓
6. Release shared input buffer from memory
   ↓
7. ZIP Download Manager:
   - Create ZIP from Variation[]
   - Trigger download
   ↓
8. Memory Manager:
   - Revoke all variation blob URLs
   - Clear variations array
   ↓
9. Ready for next batch
```

### Memory Lifecycle

```
Time →

T0: User uploads file (5MB)
    Memory: 5MB (File object)

T1: Read file.arrayBuffer()
    Memory: 10MB (File + ArrayBuffer)

T2: Start variation 1
    Write to FFmpeg FS → Process → Read output
    Memory: 10MB (buffer) + 20MB (FFmpeg) + 5MB (output blob) = 35MB

T3: Complete variation 1
    Cleanup FFmpeg FS
    Memory: 10MB (buffer) + 5MB (var1 blob) = 15MB

T4: Complete variation 10
    Memory: 10MB (buffer) + 50MB (10 blobs × 5MB) = 60MB

T5: Create ZIP
    Memory: 10MB (buffer) + 50MB (blobs) + 50MB (ZIP) = 110MB (peak)

T6: Download triggered
    Memory: 10MB (buffer) + 50MB (ZIP blob) = 60MB
    (Variation blobs released)

T7: Cleanup after download
    Memory: ~1MB (UI state only)
```

**Critical timing:** Peak memory occurs during ZIP creation (T5). For 20 variations × 5MB each = 100MB + 100MB ZIP = 200MB peak. This is at browser memory limit. Mitigation: Warn user if N × avg_file_size exceeds safe threshold (e.g., 150MB total).

## Patterns to Follow

### Pattern 1: Shared Input Buffer (Memory Optimization)
**What:** Read uploaded file once, reuse ArrayBuffer across all N variations
**When:** Batch generation with N > 1
**Why:** Eliminates N×file_size memory waste; critical for large inputs

**Example:**
```javascript
async function generateVariations(file, config) {
  // Read ONCE
  const inputBuffer = await file.arrayBuffer();
  const variations = [];

  for (let i = 0; i < config.count; i++) {
    // REUSE buffer reference
    const variation = await processVariation(inputBuffer, config.effects[i], i);
    variations.push(variation);

    // Small delay to prevent UI freeze
    await sleep(100);
  }

  // Release after all variations complete
  inputBuffer = null;  // Allow GC

  return variations;
}
```

### Pattern 2: Aggressive Blob URL Cleanup (Memory Safety)
**What:** Revoke blob URLs immediately when no longer needed
**When:** After each variation preview dismissed, after ZIP created, on batch clear
**Why:** Prevents memory leaks that plagued existing codebase (see CONCERNS.md)

**Example:**
```javascript
const blobURLRegistry = new Map();

function registerBlob(id, blobURL) {
  blobURLRegistry.set(id, blobURL);
}

function cleanupBatch(batchId) {
  // Revoke all URLs for this batch
  for (const [id, url] of blobURLRegistry.entries()) {
    if (id.startsWith(batchId)) {
      URL.revokeObjectURL(url);
      blobURLRegistry.delete(id);
    }
  }
}

// Hook into batch lifecycle
window.addEventListener('beforeunload', () => {
  blobURLRegistry.forEach(url => URL.revokeObjectURL(url));
});
```

### Pattern 3: Progressive Batch Progress (UX)
**What:** Show aggregate progress across all variations, not just current
**When:** User has initiated batch generation
**Why:** User needs to know overall completion, not just "variation 7 of 10 at 34%"

**Example:**
```javascript
function calculateBatchProgress(currentIndex, variationProgress, totalCount) {
  // Completed variations contribute 100% each
  const completedProgress = currentIndex * 100;

  // Current variation contributes partial progress
  const currentProgress = variationProgress;

  // Total possible progress
  const totalProgress = totalCount * 100;

  // Overall percentage
  const overallPercent = (completedProgress + currentProgress) / totalProgress * 100;

  return {
    percent: Math.round(overallPercent),
    message: `Processing variation ${currentIndex + 1} of ${totalCount}... ${variationProgress}%`
  };
}
```

### Pattern 4: Random Effect Seeding (Reproducibility)
**What:** Use deterministic randomness for effect generation
**When:** Generating N unique effect configurations
**Why:** User can regenerate same batch if desired; easier debugging

**Example:**
```javascript
function generateEffectConfig(index, baseSeed = Date.now()) {
  // Seed RNG with base + index for reproducibility
  const seed = baseSeed + index;
  const rng = seededRandom(seed);

  return {
    rotation: rng(-5, 5) * 0.017453,  // Degrees to radians
    brightness: rng(-0.05, 0.05),
    contrast: rng(0.95, 1.05),
    saturation: rng(0.95, 1.05),
    frameRate: rng(29.5, 30.5),
    zoom: rng(1.0, 1.02),
    mirror: rng(0, 1) > 0.5,
    noise: Math.floor(rng(0, 3))
  };
}

// Simple seeded RNG (not cryptographic)
function seededRandom(seed) {
  return function(min, max) {
    seed = (seed * 9301 + 49297) % 233280;
    const rnd = seed / 233280;
    return min + rnd * (max - min);
  };
}
```

### Pattern 5: Memory-Aware Batch Sizing (Safety)
**What:** Warn or block batch generation if estimated memory exceeds safe threshold
**When:** User specifies N variations before processing starts
**Why:** Prevent OOM crashes mid-batch; better to warn upfront

**Example:**
```javascript
function validateBatchSize(file, variationCount) {
  const fileSizeMB = file.size / (1024 * 1024);

  // Estimate peak memory:
  // - Input buffer: 1×
  // - Variation blobs: N×
  // - ZIP blob: N× (during creation)
  // - FFmpeg overhead: 20MB
  const estimatedPeakMB = fileSizeMB + (variationCount * fileSizeMB) +
                          (variationCount * fileSizeMB) + 20;

  const SAFE_LIMIT_MB = 150;  // Conservative browser limit

  if (estimatedPeakMB > SAFE_LIMIT_MB) {
    return {
      safe: false,
      message: `This batch would use ~${Math.round(estimatedPeakMB)}MB peak memory. ` +
               `Recommended: Reduce variations to ${Math.floor(SAFE_LIMIT_MB / (fileSizeMB * 2))} ` +
               `or use a smaller input file.`
    };
  }

  return { safe: true };
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Parallel FFmpeg Workers
**What:** Creating multiple FFmpeg instances in Web Workers for parallel processing
**Why bad:** Each instance uses 20-50MB base memory + input + output buffers. 4 workers × 50MB = 200MB before processing any video. Browser OOM guaranteed.
**Instead:** Use single FFmpeg instance with sequential queue (existing pattern works)

### Anti-Pattern 2: Re-reading Input File Per Variation
**What:** Calling `file.arrayBuffer()` inside loop for each variation
**Why bad:** N variations × file size = wasted memory. 10 variations × 10MB = 100MB wasted just storing duplicate input.
**Instead:** Read once, pass buffer reference (Pattern 1)

### Anti-Pattern 3: Accumulating Variations in Global State
**What:** Storing all variations in persistent `processedVideos` array (existing anti-pattern)
**Why bad:** Memory grows indefinitely. After processing 5 batches × 10 variations × 5MB = 250MB that cannot be released without page refresh.
**Instead:** Batch-scoped state. Clear variations after ZIP download. Provide explicit "Clear batch" button.

### Anti-Pattern 4: Blocking UI During Batch
**What:** Synchronous loop processing all N variations without yielding to event loop
**Why bad:** UI freezes for N×processing_time. User cannot cancel, interact, or monitor. Browser "Page Unresponsive" warning.
**Instead:** Use async/await with small delays between variations (100ms). Allows UI updates and cancel handling.

### Anti-Pattern 5: Creating ZIP in FFmpeg
**What:** Using FFmpeg to create ZIP or archive of multiple videos
**Why bad:** FFmpeg is video processing tool, not archiving tool. Adds complexity, larger wasm binary, unpredictable behavior.
**Instead:** Use dedicated library (JSZip) in JavaScript after videos processed.

### Anti-Pattern 6: Hardcoded Effect Values
**What:** All variations use same effect parameters (e.g., brightness=0.01 for all)
**Why bad:** Defeats purpose of batch variation. Ad platforms detect duplicates if effects don't vary.
**Instead:** Random effect generator with seed (Pattern 4)

## Scalability Considerations

### At 5 Variations (Typical Use Case)

**Strategy:** Standard sequential processing
- Input file: 10MB
- Peak memory: ~60MB (10MB input + 50MB variations)
- Processing time: 5× single video time (~2-5 minutes for 10MB input)
- User experience: Acceptable; progress visible

**Approach:**
- Use existing queue infrastructure
- Minimal UI changes (add variation count input)
- Standard batch progress display

### At 10 Variations (Common Use Case)

**Strategy:** Memory-aware processing with warnings
- Input file: 10MB
- Peak memory: ~120MB (10MB input + 100MB variations + ZIP overhead)
- Processing time: 10× single video time (~5-10 minutes)
- User experience: Long but manageable; progress critical

**Approach:**
- Add memory validation before batch start
- Show time estimate: "This will take approximately X minutes"
- Provide cancel button (new feature needed)
- Consider streaming ZIP creation (add variations incrementally)

### At 20 Variations (Maximum Supported)

**Strategy:** Aggressive memory management and user warnings
- Input file: 5MB (must warn on larger files)
- Peak memory: ~200MB (5MB input + 100MB variations + ZIP)
- Processing time: 20× single video time (~10-20 minutes)
- User experience: Edge of acceptable; high risk of OOM

**Approach:**
- Hard limit if input file > 5MB
- Progressive ZIP creation: Add variations to ZIP as completed, release blob immediately
- Strongly recommend breaking into 2 batches of 10
- Show memory usage indicator in UI

**Warning message example:**
```
⚠️ Processing 20 variations from a 10MB file will use ~200MB memory
and take approximately 15-20 minutes.

Recommended:
• Reduce to 10 variations for faster processing
• Or use a smaller input file (< 5MB)
• Or split into 2 batches

Continue anyway? [Yes] [No]
```

### At 50+ Variations (Out of Scope)

**Strategy:** Not supported in browser
- Peak memory: 500MB+
- Processing time: 1+ hours
- User experience: Unacceptable

**Recommendation:**
- Hard limit at 20 variations in UI
- If user needs 50+ variations, recommend:
  - Process in 5 batches of 10
  - Or migrate to server-side processing (future consideration)

## Build Order and Dependencies

### Phase 1: Foundation (No new dependencies)
**Goal:** Enhance existing queue to support batch processing

1. **Component 4: Random Effect Generator** (build first, no dependencies)
   - Pure utility functions
   - Testable in isolation
   - Generates FFmpeg command variations

2. **Component 3: Enhanced FFmpeg Processing Queue** (depends on existing queue)
   - Accept pre-read ArrayBuffer instead of File
   - Enhanced cleanup after each variation
   - Add delay between variations

3. **Component 6: Memory Manager** (depends on queue)
   - Blob URL registry
   - Revocation hooks

**Validation:** Process 3 variations manually, verify memory cleanup

### Phase 2: Batch Orchestration (Depends on Phase 1)

4. **Component 2: Variation Generation Controller** (depends on enhanced queue)
   - Read file once
   - Loop through variations
   - Coordinate queue and memory manager

5. **Component 7: Batch Progress Aggregator** (depends on controller)
   - Track per-variation progress
   - Calculate overall batch progress

6. **Component 1: Batch Configuration Interface** (UI only, can be parallel)
   - Variation count input (1-20)
   - Effect randomness selector

**Validation:** Generate 5 variations, verify progress accuracy

### Phase 3: Download and Completion (Depends on Phase 2)

7. **Component 5: ZIP Download Manager** (depends on controller)
   - Add JSZip dependency (npm install jszip)
   - Create ZIP from variations array
   - Trigger download
   - Cleanup after download

**Validation:** Generate 5 variations, download ZIP, verify contents

### Dependency Graph

```
Component 4 (Random Effects) ──→ Component 3 (Enhanced Queue)
                                      ↓
                                 Component 6 (Memory Manager)
                                      ↓
                                 Component 2 (Controller)
                                      ↓
Component 1 (UI Config) ─────────────┤
                                      ↓
                                 Component 7 (Progress)
                                      ↓
                                 Component 5 (ZIP Manager)
```

**Critical path:** Components 4 → 3 → 6 → 2 → 5

**Parallel work:** Component 1 (UI) can be built anytime after Component 2 interface is defined

## Performance Optimization Strategies

### Optimization 1: FFmpeg Command Efficiency
**Goal:** Reduce per-variation processing time by 20-30%

**Approach:**
- **Current:** `-preset fast` or `-preset veryfast` (existing)
- **Optimize:** Use `-preset ultrafast` for batch processing
  - Tradeoff: Lower quality, but variations are meant to be "similar enough" not "perfect"
  - Speedup: 30-40% faster encoding
- **Optimize:** Reduce CRF from 22-24 to 25-27 for batch
  - Tradeoff: Slightly lower quality
  - Speedup: 15-20% faster
- **Optimize:** Disable unnecessary filters
  - Remove `-map_metadata -1` (metadata stripping)
  - Simplify filter chain if effects are minimal

**Example optimized command:**
```bash
ffmpeg -i input.mp4 \
  -vf "rotate=0.00349,eq=brightness=0.01:contrast=1.01:saturation=1.01" \
  -r 29.97 \
  -b:v 1500k \
  -preset ultrafast \  # Changed from fast
  -crf 26 \             # Changed from 22-24
  -threads 4 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  output.mp4
```

**Impact:** 10-minute batch → 7-minute batch

### Optimization 2: Lazy Blob Creation
**Goal:** Reduce memory pressure by deferring blob URL creation

**Approach:**
- Don't create blob URLs for all variations immediately
- Create blob URL only when:
  - User clicks preview for that variation
  - ZIP creation starts (need blob anyway)
- Store raw `Uint8Array` from FFmpeg FS instead of Blob until needed

**Example:**
```javascript
// Store minimal data
const variation = {
  id: generateID(),
  name: `var_${index}.mp4`,
  data: ffmpeg.FS('readFile', outputFileName),  // Uint8Array
  blobURL: null,  // Created on-demand
  metadata: {...}
};

// Create blob URL lazily
function getVariationBlobURL(variation) {
  if (!variation.blobURL) {
    const blob = new Blob([variation.data.buffer], { type: 'video/mp4' });
    variation.blobURL = URL.createObjectURL(blob);
  }
  return variation.blobURL;
}
```

**Impact:** Reduces peak memory by ~20% (no blob URLs until needed)

### Optimization 3: Streaming ZIP Creation
**Goal:** Reduce peak memory during ZIP creation

**Approach:**
- **Current (Anti-pattern):** Accumulate all variation blobs → create ZIP → peak 2× memory
- **Optimized:** Add variations to ZIP progressively as they complete
- **Library:** JSZip supports `generateAsync({ streamFiles: true })`

**Example:**
```javascript
const zip = new JSZip();

for (let i = 0; i < variations.length; i++) {
  const variation = await processVariation(...);

  // Add to ZIP immediately
  zip.file(variation.name, variation.blob);

  // Release variation blob URL (not needed for preview)
  URL.revokeObjectURL(variation.blobURL);
  variation.blobURL = null;
  variation.blob = null;  // Allow GC
}

// Generate ZIP (smaller peak memory, no duplicate variation blobs)
const zipBlob = await zip.generateAsync({
  type: 'blob',
  streamFiles: true  // Stream to reduce memory
});
```

**Impact:** Reduces peak memory from 200MB to ~120MB for 20 variations

### Optimization 4: Inter-Variation Delay Tuning
**Goal:** Balance throughput vs. UI responsiveness

**Approach:**
- **Current:** 500ms delay between files (app.js line 193)
- **Batch context:** Reduce to 100ms (faster batch completion)
- **Rationale:** UI doesn't need to update as frequently during batch; user cares about overall progress

**Example:**
```javascript
// After each variation completes
if (processingQueue.length > 0) {
  // Shorter delay for batch processing
  const delay = isBatchMode ? 100 : 500;
  setTimeout(() => processQueue(), delay);
}
```

**Impact:** 10 variations × 400ms saved = 4 seconds total savings (minor but free)

### Optimization 5: FFmpeg Instance Warmup
**Goal:** Eliminate FFmpeg load time for 2nd+ variations

**Approach:**
- **Current:** FFmpeg loaded lazily on first video
- **Optimized:** Load FFmpeg immediately on batch start (before reading file)
- **Benefit:** First variation doesn't pay FFmpeg load cost (2-5 seconds)

**Example:**
```javascript
async function startBatchProcessing(file, config) {
  // Load FFmpeg in parallel with file reading
  const [ffmpegInstance, inputBuffer] = await Promise.all([
    loadFFmpeg(),
    file.arrayBuffer()
  ]);

  // FFmpeg already loaded when first variation starts
  await processVariations(inputBuffer, config);
}
```

**Impact:** Saves 2-5 seconds on batch start

## Integration Points with Existing System

### Integration 1: Enhanced Queue (app.js lines 172-196)
**Change:** Accept ArrayBuffer instead of File
**Backward compatibility:** Keep existing `handleFile(file)` for single-video mode
**New function:** `handleVariation(buffer, effectConfig, index)`

### Integration 2: Memory Cleanup (app.js lines 275, 439)
**Change:** Add URL.revokeObjectURL() calls
**Locations:**
- After original video replaced
- After processed video removed from history
- After ZIP download
- On page unload

### Integration 3: Progress UI (app.js lines 59-70)
**Change:** Add batch progress aggregation
**New elements:**
- Overall batch progress bar
- Per-variation progress (optional, collapsible)
- Time estimate based on first variation

### Integration 4: Download Button (app.js lines 512-522)
**Change:** Conditional download behavior
**Logic:**
- If single video: Download individual video (existing)
- If batch: Offer "Download ZIP" + individual downloads

### Integration 5: FFmpeg Command Generation (app.js lines 368-414)
**Change:** Parameterized filter chain
**Current:** Hardcoded `-vf "rotate=0.00349,eq=..."`
**New:** `generateFilterChain(effectConfig): string`

## Open Questions for Phase-Specific Research

1. **JSZip performance:** How does JSZip handle 20× 5MB files in browser? Need to test with real data
2. **FFmpeg.wasm version upgrade:** Should we upgrade from 0.11.6 to 0.12.x for better memory management? Breaking changes?
3. **Cancel button implementation:** Can FFmpeg.wasm abort mid-encoding? Or only between variations?
4. **Streaming ZIP support:** Does JSZip `streamFiles: true` actually reduce peak memory, or just disk writes (N/A in browser)?
5. **Effect uniqueness validation:** How different do effects need to be for ad platforms? Need domain expert input
6. **Browser memory API:** Can we use `performance.memory` to detect approaching OOM? (Chrome-only, non-standard)

## Sources and Confidence Assessment

**HIGH confidence:**
- Existing codebase analysis (direct observation)
- Single FFmpeg instance pattern (proven in current app)
- Memory constraints (observed in CONCERNS.md, line 91-98)

**MEDIUM confidence:**
- FFmpeg.wasm architectural limitations (based on training data, no official docs verified)
- JSZip streaming behavior (library documentation not verified)
- Browser memory limits (varies by device, ~100-200MB is anecdotal)
- Web Worker anti-pattern (based on training knowledge of FFmpeg.wasm 0.11.6 limitations)

**LOW confidence:**
- Specific performance optimization percentages (estimates, need benchmarking)
- Memory usage calculations (estimates based on typical file sizes)
- FFmpeg.wasm 0.12.x improvements (version not verified, may not exist)

**Note:** WebSearch and WebFetch were unavailable during research. All findings based on existing codebase analysis and training data. Recommend verifying:
1. JSZip streaming API capabilities
2. FFmpeg.wasm latest version and memory improvements
3. Browser memory limits across devices (test with BrowserStack)

---

*Architecture research completed: 2026-02-06*
*Confidence: MEDIUM (codebase analysis HIGH, ecosystem patterns MEDIUM due to unverified external sources)*
