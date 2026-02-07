# Phase 4: Core Batch Generation - Research

**Researched:** 2026-02-06
**Domain:** Batch processing patterns, progress tracking, cancellation, and variation generation for browser-based video processing
**Confidence:** HIGH

## Summary

Phase 4 focuses on implementing batch generation where users can create multiple unique video variations from a single upload. This requires coordinating several technical domains: batch processing patterns for sequential async operations, progress tracking across multiple tasks, cancellation mechanisms, unique effect combination generation, and naming conventions for variation files.

Batch processing in JavaScript follows well-established patterns using async/await with sequential execution or promise pools for concurrency control. For this phase, sequential processing is preferred since FFmpeg.wasm is CPU-intensive and running concurrent encoding operations would compete for resources without meaningful speedup. Progress tracking requires calculating completion percentage across the batch (e.g., "Processing variation 3/10") and updating UI state as each operation completes. The existing infrastructure from Phase 3 (loadVideoBuffer, preloadedBuffer, cleanupInput parameters) provides buffer reuse foundation that eliminates redundant file reads across variations.

Cancellation presents a key architectural challenge: FFmpeg.wasm 0.12.x does not support AbortController for granular operation cancellation. The only available mechanism is ffmpeg.terminate(), which destroys the entire instance and requires recovery/reinitialization. For batch processing, this means cancellation must be implemented at the orchestration layer using a shared cancellation flag checked between variations, not during encoding. When cancel is triggered, the current variation completes but subsequent variations are skipped, and partial results are preserved.

Effect variation generation requires producing unique random combinations without duplicates within a batch. Using JavaScript Set to track serialized effect combinations (JSON.stringify) provides efficient O(1) duplicate detection. Effect parameters have well-defined ranges: rotate angle in radians (use small values like 0.001-0.01 for subtle changes), eq filter brightness (-1.0 to 1.0), contrast (-1000 to 1000, typically 0.8-1.2), and saturation (0.0 to 3.0, typically 0.8-1.2). For ad platform uniqueness, even minor parameter variations (0.01 brightness difference, 0.003 rotation angle) create distinct file hashes and metadata signatures.

**Primary recommendation:** Implement sequential batch processing with per-variation progress tracking, orchestration-layer cancellation using shared flag, Set-based duplicate detection for effect combinations, and naming pattern originalname_var1_abc123.mp4 where var1 is 1-based variation index and abc123 is 6-character random hex ID.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FFmpeg.wasm | 0.12.14 | Video encoding | Already in use, no cancellation support requires orchestration-layer patterns |
| JavaScript Set | Native | Duplicate detection | O(1) lookup, automatic duplicate prevention for effect combinations |
| AbortController | Native | Cancellation signal | Standard Web API for cancellation patterns, though not supported by FFmpeg.wasm directly |
| crypto.getRandomValues | Native | Random hex generation | Existing generateUniqueID() function provides cryptographically secure randomness |
| JSON.stringify | Native | Object serialization | Canonical serialization for effect combination comparison |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| performance.now() | Native | Batch timing measurement | Track total batch processing time for analytics |
| Array.from() | Native | Range generation | Create variation indices (1 to N) for iteration |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Sequential processing | Promise pool with concurrency=2 | No benefit: FFmpeg encoding is CPU-bound, concurrent encoding competes for resources without speedup |
| Set for duplicates | Manual array iteration with indexOf | O(n) instead of O(1), slower and more error-prone |
| Orchestration cancellation | ffmpeg.terminate() per operation | Destroys instance, requires recovery overhead, loses MEMFS state including input file |
| JSON.stringify for hash | Custom hash function | Unnecessary complexity, JSON.stringify is deterministic and sufficient for object comparison |

**Installation:**
No additional packages required. All batch processing uses existing infrastructure and native browser APIs.

## Architecture Patterns

### Recommended Project Structure
```
app.js (existing)
├── processVideo()                    # Modified: Returns variation metadata
├── loadVideoBuffer()                 # Phase 3: Ready for reuse
├── generateBatch()                   # NEW: Orchestrates multiple variations
├── generateUniqueEffects()           # NEW: Create N unique effect combinations
├── formatVariationFilename()         # NEW: originalname_var1_abc123.mp4
└── Cancellation flag (module-level)  # NEW: Shared cancellation state
```

Note: For this application, inline implementation in `app.js` is appropriate. Batch orchestration is a single feature, not a reusable library.

### Pattern 1: Sequential Batch Processing with Buffer Reuse
**What:** Process N variations sequentially, reusing input buffer and MEMFS file across all operations
**When to use:** When processing same video multiple times with different parameters (Phase 4 requirement)
**Example:**
```javascript
// Source: Phase 3 infrastructure + field research on batch patterns

let batchCancelled = false; // Module-level cancellation flag

async function generateBatch(file, variationCount) {
    // Reset cancellation state
    batchCancelled = false;

    // Load buffer once
    const buffer = await loadVideoBuffer(file);

    // Write to MEMFS once
    await ffmpeg.writeFile('input.mp4', buffer);

    // Generate unique effect combinations
    const effects = generateUniqueEffects(variationCount);

    const results = [];

    for (let i = 0; i < variationCount; i++) {
        // Check cancellation before starting next variation
        if (batchCancelled) {
            console.log('Batch cancelled, stopping at variation', i);
            break;
        }

        // Update progress UI
        updateBatchProgress(i + 1, variationCount);

        // Process with cleanupInput=false to preserve MEMFS file
        const isLastVariation = i === variationCount - 1;
        const result = await processVideo(
            file,
            buffer,
            isLastVariation, // cleanupInput: only clean on last variation
            effects[i]       // Unique effect parameters
        );

        results.push(result);
    }

    return results;
}

// Expose cancellation to UI
window.cancelBatch = function() {
    batchCancelled = true;
}
```

**Benefits:**
- Single buffer read for entire batch (eliminates N file reads)
- Single MEMFS write (eliminates N-1 redundant writes)
- Graceful cancellation between variations (preserves partial results)
- Progress tracking naturally integrated into loop

### Pattern 2: Unique Effect Combination Generation with Set
**What:** Generate N unique random effect combinations, no duplicates within batch
**When to use:** When batch requires variations to be distinct for ad platform algorithms
**Example:**
```javascript
// Source: Set duplicate prevention + effect parameter research

function generateUniqueEffects(count) {
    const effects = [];
    const seen = new Set();

    // Effect parameter ranges (from FFmpeg filter documentation)
    const ranges = {
        rotation: { min: 0.001, max: 0.01 },       // radians, subtle change
        brightness: { min: -0.05, max: 0.05 },     // -1 to 1 range
        contrast: { min: 0.95, max: 1.05 },        // -1000 to 1000, use 0.8-1.2 for subtle
        saturation: { min: 0.95, max: 1.05 }       // 0 to 3, use 0.8-1.2 for subtle
    };

    let attempts = 0;
    const maxAttempts = count * 100; // Prevent infinite loop

    while (effects.length < count && attempts < maxAttempts) {
        attempts++;

        // Generate random effect values
        const effect = {
            rotation: random(ranges.rotation.min, ranges.rotation.max),
            brightness: random(ranges.brightness.min, ranges.brightness.max),
            contrast: random(ranges.contrast.min, ranges.contrast.max),
            saturation: random(ranges.saturation.min, ranges.saturation.max)
        };

        // Serialize to detect duplicates
        const key = JSON.stringify(effect);

        // Check if combination already generated
        if (!seen.has(key)) {
            seen.add(key);
            effects.push(effect);
        }
    }

    if (effects.length < count) {
        throw new Error(`Could only generate ${effects.length} unique combinations (requested ${count})`);
    }

    return effects;
}

function random(min, max) {
    return Math.random() * (max - min) + min;
}
```

**Benefits:**
- O(1) duplicate detection with Set
- JSON.stringify provides deterministic serialization
- Bounded retry with maxAttempts prevents infinite loops
- Throws error if unable to generate enough unique combinations

### Pattern 3: Per-Variation Progress Tracking
**What:** Update UI with current variation number and overall batch progress
**When to use:** When processing batch of N variations to show user progress
**Example:**
```javascript
// Source: Batch processing progress tracking patterns

function updateBatchProgress(current, total) {
    const progressPercent = Math.round((current / total) * 100);
    const progressText = `Processing variation ${current}/${total}...`;

    // Update progress bar (0-100%)
    const progressBar = document.getElementById('progressBar');
    const progressTextEl = document.getElementById('progressText');

    if (progressBar) {
        progressBar.style.width = `${progressPercent}%`;
    }
    if (progressTextEl) {
        progressTextEl.textContent = progressText;
    }

    console.log(progressText, `${progressPercent}%`);
}

// Integrate with processVideo
async function processVideo(file, preloadedBuffer, cleanupInput, effects) {
    // ... existing processing logic ...

    // FFmpeg progress still tracked via ffmpeg.on('progress') event
    // Batch progress tracked at orchestration layer via updateBatchProgress

    return {
        filename: outputFileName,
        blob: blob,
        url: processedURL,
        effects: effects,
        size: blob.size
    };
}
```

**Two-layer progress tracking:**
- Individual operation progress: FFmpeg progress event (0-100% for current variation)
- Batch progress: Variation count (3/10 variations complete)

### Pattern 4: Variation File Naming
**What:** Consistent naming pattern originalname_var1_abc123.mp4
**When to use:** When generating multiple variations to maintain clear relationship to original
**Example:**
```javascript
// Source: JavaScript file naming conventions + unique identifier pattern

function formatVariationFilename(originalName, variationIndex) {
    // Remove .mp4 extension
    const baseName = originalName.replace(/\.mp4$/i, '');

    // Generate 6-character hex ID (existing function uses 3 bytes = 6 hex chars)
    const uniqueID = generateUniqueID(); // abc123

    // Format: originalname_var1_abc123.mp4 (1-based index)
    return `${baseName}_var${variationIndex}_${uniqueID}.mp4`;
}

// Example outputs:
// myvideo_var1_a3f891.mp4
// myvideo_var2_7bc24e.mp4
// myvideo_var3_d05f32.mp4
```

**Benefits:**
- Human-readable variation index (var1, var2, var3)
- Unique identifier prevents filename collisions if same video processed multiple times
- Original name preserved for easy identification
- 1-based indexing matches user expectation ("first variation" = var1)

### Pattern 5: First Variation Preview
**What:** Display first completed variation in preview area for quality check
**When to use:** When user needs immediate feedback during batch processing
**Example:**
```javascript
async function generateBatch(file, variationCount) {
    // ... buffer loading, effects generation ...

    const results = [];
    let firstVariationDisplayed = false;

    for (let i = 0; i < variationCount; i++) {
        if (batchCancelled) break;

        updateBatchProgress(i + 1, variationCount);

        const result = await processVideo(/* ... */);
        results.push(result);

        // Display first variation immediately
        if (i === 0 && !firstVariationDisplayed) {
            const processedVideo = document.getElementById('processedVideo');
            processedVideo.src = result.url;
            processedVideo.style.display = 'block';
            firstVariationDisplayed = true;
        }
    }

    return results;
}
```

**Benefits:**
- Immediate feedback to user (quality check while batch continues)
- Allows early cancellation if quality issues detected
- Natural integration into batch loop

### Anti-Patterns to Avoid
- **Using ffmpeg.terminate() for cancellation:** Destroys instance, requires recovery, loses MEMFS state. Use orchestration-layer cancellation flag instead.
- **Concurrent FFmpeg operations:** CPU-bound encoding doesn't benefit from concurrency, wastes resources competing for same CPU cores.
- **Re-reading file for each variation:** Phase 3 infrastructure provides buffer reuse, use it. Re-reading wastes I/O and memory allocation.
- **0-based variation indices in filenames:** Users expect "first variation" to be labeled "1" not "0". Use 1-based indexing.
- **No duplicate detection:** Ad platforms require unique variations. Without duplicate detection, random generation might produce identical effect combinations.
- **Blocking UI during batch:** Progress updates must be frequent enough to show responsiveness. Update after each variation, not just at start/end.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Duplicate detection | Manual array search with nested loops | JavaScript Set with JSON.stringify | O(1) vs O(n²), automatic uniqueness enforcement |
| Random number generation | Math.random() with Date.now() seed | crypto.getRandomValues() | Cryptographically secure, non-predictable, already in use via generateUniqueID() |
| Object comparison | Manual property-by-property comparison | JSON.stringify equality | Deterministic, handles nested objects, standard serialization |
| Batch cancellation | Custom promise cancellation wrapper | Shared boolean flag with loop check | Simple, transparent, no promise chain complexity |
| Progress calculation | Complex state tracking | Simple arithmetic: (current/total)*100 | Batch processing is naturally sequential, index provides progress |

**Key insight:** Batch processing patterns are well-understood and don't require libraries. Native JavaScript provides all necessary primitives (Set, JSON.stringify, async/await, flags). Introducing external libraries adds complexity without benefit for this use case.

## Common Pitfalls

### Pitfall 1: FFmpeg.wasm Terminate vs. Abort Confusion
**What goes wrong:** Attempting to use ffmpeg.terminate() for mid-operation cancellation causes instance destruction and requires expensive recovery
**Why it happens:** FFmpeg.wasm 0.12.x does not support AbortController. Terminate is the only native cancellation mechanism but it destroys the entire instance, not individual operations.
**How to avoid:**
- Implement cancellation at orchestration layer (between variations, not during)
- Use shared boolean flag checked before starting each variation
- Accept that current variation must complete before cancellation takes effect
- Preserve FFmpeg instance so subsequent batches don't require reinitialization
**Warning signs:**
- User clicks cancel and nothing happens until current variation completes (expected behavior)
- FFmpeg instance destroyed after cancel, next batch slow to start (incorrect: shouldn't destroy instance)
- Progress shows "Cancelling..." but encoding continues (misleading: be clear cancellation happens between variations)

### Pitfall 2: Insufficient Effect Parameter Variation for Ad Platforms
**What goes wrong:** Generated variations are too similar, ad platforms reject as duplicates or don't rotate properly
**Why it happens:** Conservative parameter ranges (e.g., rotation 0.0001-0.001 radians) produce visually identical videos with nearly identical file hashes
**How to avoid:**
- Use wider parameter ranges: rotation 0.001-0.01 radians, brightness -0.05 to +0.05, contrast/saturation 0.95-1.05
- Test file hash diversity: Generate 10 variations, check that file sizes and hashes differ
- Validate metadata differences: Ad platforms inspect video metadata, ensure rotation/eq filters produce different metadata signatures
- Document minimum variation threshold discovered through testing
**Warning signs:**
- All variations have identical or near-identical file sizes (within 1%)
- User reports ad platform showing same video repeatedly
- Generated variations look indistinguishable when previewed side-by-side

### Pitfall 3: Duplicate Combinations with Small Batch + Narrow Ranges
**What goes wrong:** generateUniqueEffects() fails to generate requested number of combinations, throws error or produces fewer variations than requested
**Why it happens:** Narrow parameter ranges with rounded values create limited combination space. For example, if rotation rounds to 0.001 precision, only 10 unique values exist in 0.001-0.01 range. With 4 parameters, space is limited.
**How to avoid:**
- Calculate combination space: (max-min)/precision for each parameter, multiply across parameters
- Use floating point without rounding: Don't round to fixed precision, use full Math.random() output
- Set maxAttempts based on count: maxAttempts = count * 100 provides safety margin
- Return error if unable to generate enough combinations, don't silently produce fewer
**Warning signs:**
- Batch generation fails with "Could only generate X unique combinations" error
- Generation takes long time (hitting maxAttempts repeatedly)
- Variations look very similar (combination space exhausted, forced to use near-duplicates)

### Pitfall 4: Memory Leaks from Blob URL Accumulation
**What goes wrong:** Generating 20 variations creates 20 blob URLs, consuming memory without cleanup
**Why it happens:** Each processVideo call creates blob URL via blobRegistry.register(), but batch processing creates many variations quickly
**How to avoid:**
- Rely on existing processedVideos cap (MAX_PROCESSED_VIDEOS = 20) and automatic eviction
- BlobURLRegistry already revokes URLs when eviction occurs
- For batch download, create temporary blob URLs, revoke immediately after ZIP creation
- Don't store batch results in long-lived arrays without eviction logic
**Warning signs:**
- Memory usage grows linearly during batch processing
- Browser slows down after processing multiple batches
- Chrome DevTools shows thousands of blob URLs in memory

### Pitfall 5: Progress Bar Stalls at 100% During Last Variation
**What goes wrong:** Progress bar reaches 100% when starting last variation, then appears stuck while variation processes
**Why it happens:** Batch progress (variation N/N) shows 100% before last variation completes, but FFmpeg encoding still in progress
**How to avoid:**
- Update batch progress after variation completes, not before starting
- Or use 95% for last variation start, 100% for completion
- Show two progress indicators: batch progress (variations) and operation progress (FFmpeg)
- Update status text to clarify: "Variation 10/10 - Processing..." then "Complete!"
**Warning signs:**
- Progress bar at 100% but status says "Processing..."
- User confusion: "Why is it still processing if progress is 100%?"
- No visual feedback that final variation is encoding

### Pitfall 6: JSON.stringify Inconsistency for Objects with Identical Properties
**What goes wrong:** Duplicate detection fails because JSON.stringify produces different strings for same logical object
**Why it happens:** JSON.stringify serializes properties in enumeration order, which is insertion order for objects. If properties added in different order, strings differ.
**How to avoid:**
- Always construct effect objects with same property order: {rotation, brightness, contrast, saturation}
- Or sort properties before stringify: JSON.stringify(obj, Object.keys(obj).sort())
- Test duplicate detection: Generate same effect twice, verify detected as duplicate
- Use consistent object creation (generateUniqueEffects creates all objects same way)
**Warning signs:**
- Duplicate variations generated despite Set-based detection
- Visually identical effects not detected as duplicates
- Set size grows unexpectedly (should be limited by unique combinations)

## Code Examples

Verified patterns from official sources and field research:

### Batch Generation Orchestration
```javascript
// Source: Sequential batch processing pattern + Phase 3 infrastructure

let batchCancelled = false;

async function generateBatch(file, variationCount) {
    console.log(`Starting batch generation: ${variationCount} variations`);

    // Validate range
    if (variationCount < 1 || variationCount > 20) {
        throw new Error('Variation count must be between 1 and 20');
    }

    // Reset cancellation
    batchCancelled = false;

    // Load buffer once (Phase 3 infrastructure)
    const buffer = await loadVideoBuffer(file);

    // Write to MEMFS once
    await ffmpeg.writeFile('input.mp4', buffer);

    // Generate unique effect combinations
    const effects = generateUniqueEffects(variationCount);

    const results = [];
    const batchStartTime = performance.now();

    for (let i = 0; i < variationCount; i++) {
        // Check cancellation before each variation
        if (batchCancelled) {
            console.log(`Batch cancelled after ${i} variations`);
            break;
        }

        // Update UI: "Processing variation 3/10..."
        updateBatchProgress(i + 1, variationCount);

        // Process variation
        const variationIndex = i + 1; // 1-based
        const isLastVariation = i === variationCount - 1;

        try {
            const result = await processVideo(
                file,
                buffer,
                isLastVariation,     // cleanupInput: only on last
                effects[i],          // unique effect parameters
                variationIndex       // for filename
            );

            results.push(result);

            // Display first variation immediately
            if (i === 0) {
                displayFirstVariation(result);
            }

        } catch (error) {
            console.error(`Variation ${variationIndex} failed:`, error);
            // Continue with next variation, preserve partial results
        }
    }

    const batchEndTime = performance.now();
    const batchTimeSeconds = ((batchEndTime - batchStartTime) / 1000).toFixed(2);

    console.log(`Batch complete: ${results.length}/${variationCount} variations in ${batchTimeSeconds}s`);

    return results;
}

// UI handler
document.getElementById('generateBtn').addEventListener('click', async () => {
    const file = getCurrentFile();
    const count = parseInt(document.getElementById('variationCount').value);

    const results = await generateBatch(file, count);

    // Display results grid with download buttons
    displayBatchResults(results);
});

// Cancel handler
document.getElementById('cancelBtn').addEventListener('click', () => {
    batchCancelled = true;
    updateProgress(0, 'Cancelling... Current variation will complete.');
});
```

### Unique Effect Generation with Duplicate Detection
```javascript
// Source: Set-based duplicate detection + FFmpeg filter parameter ranges

function generateUniqueEffects(count) {
    const effects = [];
    const seen = new Set(); // Track serialized combinations

    // Parameter ranges from FFmpeg documentation
    // Values chosen to ensure visible variation while maintaining quality
    const ranges = {
        // Rotation in radians (0.001 to 0.01 rad ≈ 0.06° to 0.6°)
        rotation: { min: 0.001, max: 0.01 },

        // Brightness: -1.0 to 1.0 range, use subtle -0.05 to 0.05
        brightness: { min: -0.05, max: 0.05 },

        // Contrast: -1000 to 1000 range, use 0.95 to 1.05 (5% variation)
        contrast: { min: 0.95, max: 1.05 },

        // Saturation: 0.0 to 3.0 range, use 0.95 to 1.05 (5% variation)
        saturation: { min: 0.95, max: 1.05 }
    };

    let attempts = 0;
    const maxAttempts = count * 100;

    while (effects.length < count && attempts < maxAttempts) {
        attempts++;

        // Generate random values
        const effect = {
            rotation: randomInRange(ranges.rotation.min, ranges.rotation.max),
            brightness: randomInRange(ranges.brightness.min, ranges.brightness.max),
            contrast: randomInRange(ranges.contrast.min, ranges.contrast.max),
            saturation: randomInRange(ranges.saturation.min, ranges.saturation.max)
        };

        // Round to prevent floating point comparison issues (4 decimal places)
        effect.rotation = parseFloat(effect.rotation.toFixed(4));
        effect.brightness = parseFloat(effect.brightness.toFixed(4));
        effect.contrast = parseFloat(effect.contrast.toFixed(4));
        effect.saturation = parseFloat(effect.saturation.toFixed(4));

        // Serialize for duplicate detection
        const key = JSON.stringify(effect);

        if (!seen.has(key)) {
            seen.add(key);
            effects.push(effect);
        }
    }

    // Validate we generated enough combinations
    if (effects.length < count) {
        throw new Error(
            `Could only generate ${effects.length} unique combinations (requested ${count}). ` +
            `Try reducing variation count or widening parameter ranges.`
        );
    }

    console.log(`Generated ${effects.length} unique effect combinations in ${attempts} attempts`);

    return effects;
}

function randomInRange(min, max) {
    return Math.random() * (max - min) + min;
}
```

### Modified processVideo with Effect Parameters
```javascript
// Source: Phase 3 infrastructure extended with effect parameters and variation naming

async function processVideo(file, preloadedBuffer = null, cleanupInput = true, effects = null, variationIndex = null) {
    // ... existing FFmpeg loading and buffer handling ...

    // Generate filename with variation index if provided
    let outputFileName;
    if (variationIndex !== null) {
        outputFileName = formatVariationFilename(file.name, variationIndex);
    } else {
        // Single processing: original behavior
        const fileName = file.name.replace(/\.mp4$/i, '');
        const uniqueID = generateUniqueID();
        outputFileName = `${fileName}_${uniqueID}.mp4`;
    }

    // Apply effects if provided, otherwise use default
    let videoFilters;
    if (effects) {
        // Batch processing: use provided random effects
        videoFilters = `rotate=${effects.rotation}:fillcolor=black@0,` +
                      `eq=brightness=${effects.brightness}:contrast=${effects.contrast}:saturation=${effects.saturation}`;
    } else {
        // Single processing: use fixed minimal effects (original behavior)
        videoFilters = 'rotate=0.00349,eq=brightness=0.01:contrast=1.01:saturation=1.01';
    }

    // FFmpeg encoding (ultrafast preset from Phase 3)
    await ffmpeg.exec([
        '-i', 'input.mp4',
        '-vf', videoFilters,
        '-r', '29.97',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-b:v', '2000k',
        '-bufsize', '4000k',
        '-maxrate', '2500k',
        '-map_metadata', '-1',
        '-threads', '4',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outputFileName
    ]);

    // Read output, create blob
    const data = await ffmpeg.readFile(outputFileName);
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    const processedURL = blobRegistry.register(blob, { type: 'processed' });

    // Cleanup
    await ffmpeg.deleteFile(outputFileName);
    if (cleanupInput) {
        await ffmpeg.deleteFile('input.mp4');
    }

    // Return metadata for batch processing
    return {
        filename: outputFileName,
        blob: blob,
        url: processedURL,
        effects: effects,
        size: blob.size
    };
}
```

### Variation Filename Formatting
```javascript
// Source: JavaScript naming conventions + existing generateUniqueID

function formatVariationFilename(originalName, variationIndex) {
    // Remove .mp4 extension (case insensitive)
    const baseName = originalName.replace(/\.mp4$/i, '');

    // Generate 6-character hex ID (crypto.getRandomValues)
    const uniqueID = generateUniqueID(); // Already exists in app.js

    // Format: originalname_var1_abc123.mp4
    // variationIndex is 1-based (1, 2, 3, ...)
    return `${baseName}_var${variationIndex}_${uniqueID}.mp4`;
}

// Examples:
// formatVariationFilename('myvideo.mp4', 1)  → 'myvideo_var1_a3f891.mp4'
// formatVariationFilename('myvideo.mp4', 2)  → 'myvideo_var2_7bc24e.mp4'
// formatVariationFilename('TEST.MP4', 10)    → 'TEST_var10_d05f32.mp4'
```

### Progress Tracking UI Updates
```javascript
// Source: Batch processing progress patterns

function updateBatchProgress(current, total) {
    // Calculate percentage (0-100)
    const progressPercent = Math.round((current / total) * 100);

    // Format text: "Processing variation 3/10..."
    const progressText = `Processing variation ${current}/${total}...`;

    // Update progress bar
    const progressBar = document.getElementById('progressBar');
    if (progressBar) {
        progressBar.style.width = `${progressPercent}%`;
    }

    // Update progress text
    const progressTextEl = document.getElementById('progressText');
    if (progressTextEl) {
        progressTextEl.textContent = progressText;
    }

    console.log(`Batch progress: ${current}/${total} (${progressPercent}%)`);
}

function displayFirstVariation(result) {
    const processedVideo = document.getElementById('processedVideo');

    // Update video source
    processedVideo.src = result.url;
    processedVideo.style.display = 'block';

    // Update status text
    const statusText = document.getElementById('processingStatus');
    if (statusText) {
        statusText.textContent = 'First variation complete! Continuing batch...';
        statusText.style.display = 'flex';
    }

    console.log('First variation displayed:', result.filename);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Process videos one at a time | Batch processing with buffer reuse | Phase 4 | Enables multi-variation generation from single upload |
| Manual file re-reading | loadVideoBuffer + preloadedBuffer parameter | Phase 3 | Eliminates redundant I/O for batch operations |
| Fixed effect parameters | Random effect generation with uniqueness | Phase 4 | Creates distinct variations for ad platform rotation |
| No cancellation | Orchestration-layer cancellation flag | Phase 4 | Graceful cancellation with partial result preservation |
| AbortController for async operations | Shared boolean flag | FFmpeg.wasm limitation | Simple, transparent, works without API support |

**Deprecated/outdated:**
- FFmpeg.wasm 0.11.x callback-based API: Version 0.12.x uses event-based progress tracking
- Promise.all for batch operations: Sequential processing preferred for CPU-bound FFmpeg encoding
- Array iteration with indexOf for duplicate detection: Set with O(1) lookup is standard since ES6
- Manual object comparison: JSON.stringify provides deterministic serialization

## Open Questions

Things that couldn't be fully resolved:

1. **Effect Uniqueness Threshold for Ad Platforms**
   - What we know: Ad platforms use file hashes and metadata to detect duplicates. Even minor parameter changes (0.01 brightness, 0.003 radians rotation) create different hashes and metadata signatures.
   - What's unclear: What minimum parameter variation is required for ad platforms to treat videos as distinct? Is visual similarity checked, or only technical metadata?
   - Recommendation: Start with ranges tested (rotation 0.001-0.01, brightness -0.05 to 0.05, etc.). Test with actual ad platform (Facebook Ads, Google Ads) by uploading 3 variations and verifying rotation behavior. Document findings for future reference.

2. **Combination Space Exhaustion with 20 Variations**
   - What we know: With 4 parameters and proposed ranges rounded to 4 decimal places, combination space is large but finite. generateUniqueEffects uses maxAttempts = count * 100 to prevent infinite loops.
   - What's unclear: Whether 20 variations with 4 parameters and proposed ranges will reliably generate unique combinations without exhausting space.
   - Recommendation: Calculate combination space: For each parameter, (max-min)/0.0001 = count of possible values. Example: rotation (0.01-0.001)/0.0001 = 90 values. With 4 parameters: 90^4 = 65 million combinations. 20 variations is safe. Document calculation in code comments.

3. **FFmpeg.wasm Future AbortController Support**
   - What we know: Version 0.12.x does not support AbortController per GitHub issue #572. Only terminate() available.
   - What's unclear: Whether future versions will add exec() cancellation support via AbortController signal parameter.
   - Recommendation: Implement orchestration-layer cancellation for now. Monitor FFmpeg.wasm releases for AbortController support. If added in future version, can refactor to use native cancellation without changing UX.

4. **Optimal Progress Update Frequency**
   - What we know: Current implementation updates progress once per variation (after completion). FFmpeg internal progress tracked via progress event during encoding.
   - What's unclear: Whether users expect more frequent batch progress updates (e.g., every 10% of individual variation encoding).
   - Recommendation: Start with per-variation updates (simple, clear: "3/10 variations"). Monitor user feedback. If users report "hanging" perception, add sub-variation progress: "Variation 3/10 - 45%".

5. **Memory Pressure with 20 Simultaneous Variations**
   - What we know: Each variation creates blob in memory. BlobURLRegistry + processedVideos cap limits to 20 entries with automatic eviction. Phase 2 testing verified stability across 10 operations.
   - What's unclear: Whether generating 20 variations in single batch creates memory pressure exceeding Phase 2 testing, especially on mobile devices.
   - Recommendation: Test on mobile devices (iPhone 12+, Android mid-range) with 20-variation batch. Monitor memory usage in Chrome DevTools. If OOM errors occur, reduce MAX_PROCESSED_VIDEOS or implement batch-aware eviction (evict old batches first).

## Sources

### Primary (HIGH confidence)
- [FFmpeg Filters Documentation](https://ffmpeg.org/ffmpeg-filters.html) - Official filter parameter ranges
- [FFmpeg eq filter documentation](https://ayosec.github.io/ffmpeg-filters-docs/7.1/Filters/Video/eq.html) - Brightness (-1 to 1), contrast (-1000 to 1000), saturation (0 to 3)
- [MDN Set](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set) - Native duplicate prevention
- [MDN AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort) - Standard cancellation API
- [FFmpeg.wasm GitHub Issue #572](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/572) - Confirms no AbortController support in 0.12.x
- [Phase 3 Research](/.planning/phases/03-performance-optimization/03-RESEARCH.md) - Buffer reuse infrastructure

### Secondary (MEDIUM confidence)
- [Smashing Magazine: Generating Unique Random Numbers Using Sets](https://www.smashingmagazine.com/2024/08/generating-unique-random-numbers-javascript-using-sets/) - Set-based duplicate prevention patterns
- [Medium: JavaScript Batch Processing with Progress Tracking](https://medium.com/@leonardoacrg.dev/javascript-how-to-process-tasks-in-batches-with-progress-tracking-6e3b1a82241a) - Progress calculation patterns
- [AppSignal: Managing Async Operations with AbortController](https://blog.appsignal.com/2025/02/12/managing-asynchronous-operations-in-nodejs-with-abortcontroller.html) - AbortController patterns and limitations
- [Cloudinary: FFmpeg Rotate Video](https://cloudinary.com/guides/video-effects/ffmpeg-rotate-video) - Rotate filter usage (radians, degrees conversion)
- [Medium: Remove Duplicate Objects Using Hashmaps](https://medium.com/@Degraphe/remove-duplicate-objects-from-javascript-array-using-hashmaps-a-short-guide-8c5de6f0463b) - JSON.stringify for object comparison

### Tertiary (LOW confidence - community patterns)
- [GitHub: async-batch processing patterns](https://gist.github.com/onmax/3550417272e8c7d0cabb984ca2d90474) - Batch processing with concurrency control
- [DEV Community: Set data structure duplicate prevention](https://dev.to/bytebodger/de-dupe-js-arrays-with-set-full-stop-29j0) - Set vs array performance
- [GeeksforGeeks: Duplicate objects detection](https://www.geeksforgeeks.org/javascript/get-list-of-duplicate-objects-in-an-array-of-objects/) - Object comparison strategies

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Native APIs and existing Phase 3 infrastructure
- Batch processing patterns: HIGH - Well-established async/await sequential patterns
- Effect generation: HIGH - FFmpeg filter documentation provides authoritative parameter ranges
- Duplicate detection: HIGH - Set with JSON.stringify is standard ES6 pattern
- Cancellation: MEDIUM - Orchestration-layer workaround due to FFmpeg.wasm limitation, not ideal but necessary
- Effect uniqueness for ad platforms: LOW - Technical variation confirmed, ad platform behavior needs testing

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (30 days - stable domain, but ad platform behavior should be validated through testing)
