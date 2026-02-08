# Architecture: Hybrid Client/Server Processing Integration

**Project:** Video Refresher v3.0 -- Hybrid Processing Milestone
**Researched:** 2026-02-07
**Confidence:** HIGH (verified via existing v1/v2 implementations, FFmpeg.wasm docs, vanilla JS patterns)

## Executive Summary

v3.0 adds hybrid processing mode to the existing vanilla JS SPA: users choose "Process on device" (FFmpeg.wasm in Web Worker) or "Send to server" (existing Fly.io API flow) via toggle on the upload page. This is an **additive integration**, not a rewrite — the v2.0 API-driven architecture remains untouched, and device processing sits **alongside** it as an alternative path.

The key architectural challenge: **upload.js currently submits to the server API**. Device mode needs a completely different post-upload flow that processes locally in a Web Worker, generates a ZIP client-side, and never touches the server (auth-only). Device processing doesn't appear in job history (local-only).

**Key integration decisions:**
1. **Web Worker reintroduction** — FFmpeg.wasm runs in dedicated worker, same pattern as v1.0 (deleted in v2.0)
2. **Mode-aware upload view** — toggle switches upload.js submission handler: server API vs local processing
3. **No job history for device mode** — local processing bypasses job queue entirely
4. **COOP/COEP header restoration** — required for SharedArrayBuffer (multi-threaded FFmpeg.wasm)
5. **Shared effect generation** — extract effect logic to lib/ for reuse between client and server
6. **Cancel button for server jobs** — DELETE /api/jobs/:id endpoint addition

## Current Architecture (v2.0)

```
Frontend (Cloudflare Pages)                    Backend (Fly.io)
┌────────────────────────────┐                 ┌──────────────────────────┐
│ views/upload.js            │ ──FormData────> │ POST /api/jobs           │
│   - Drag/drop UI           │                 │   (upload + queue)       │
│   - selectedFiles state    │                 │                          │
│   - uploadFiles() from API │ <──202 jobId──  │ Express + SQLite         │
│   - Navigate to job-detail │                 │                          │
│                            │                 │                          │
│ views/job-detail.js        │ <──GET poll───> │ GET /api/jobs/:id        │
│   - Adaptive polling       │                 │   (status + progress)    │
│   - Progress bar           │                 │                          │
│   - Download button        │ <──ZIP stream── │ GET /api/jobs/:id/download│
│                            │                 │                          │
│ views/job-list.js          │ <──GET────────> │ GET /api/jobs            │
│   - History view           │                 │   (list all jobs)        │
└────────────────────────────┘                 └──────────────────────────┘
```

**Flow:** User selects files → upload.js submits to API → redirects to job-detail → polls for progress → downloads ZIP when complete.

**Problem:** Device processing needs to **skip the server flow** entirely — no job creation, no polling, no history entry.

## New Architecture (v3.0 Hybrid)

```
Frontend (Cloudflare Pages)
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│ views/upload.js (MODIFIED)                                            │
│   ┌────────────────────────────────────────────┐                      │
│   │ Toggle: [Process on device] / [Send to server]                   │
│   └────────────────────────────────────────────┘                      │
│                                                                        │
│   if (mode === 'device'):                    if (mode === 'server'): │
│     ┌──────────────────────────┐                 (existing v2 flow)  │
│     │ Local Processing Flow    │                                     │
│     │ - Create worker          │                                     │
│     │ - Worker.postMessage()   │                                     │
│     │ - Show progress UI       │                                     │
│     │ - Generate ZIP (JSZip)   │                                     │
│     │ - Blob download          │                                     │
│     │ - Terminate worker       │                                     │
│     └──────────────────────────┘                                     │
│              ↓                                                        │
│   lib/device-processor.js (NEW)                                      │
│   - orchestrateLocalProcessing(files, variations, onProgress)        │
│   - createWorker()                                                   │
│   - generateLocalZIP(results)                                        │
│   - downloadBlob(blob, filename)                                     │
│              ↓                                                        │
│   workers/ffmpeg-worker.js (NEW - restored from v1.0)                │
│   - FFmpeg.wasm 0.12.x initialization                                │
│   - onmessage: LOAD / PROCESS / TERMINATE                            │
│   - Progress reporting via postMessage                               │
│   - Transferable ArrayBuffer handling                                │
│              ↓                                                        │
│   lib/effects.js (NEW - extracted from server)                       │
│   - generateUniqueEffects(count)                                     │
│   - Shared between client and server                                 │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

Backend (Fly.io) - UNCHANGED except:
┌──────────────────────────────┐
│ DELETE /api/jobs/:id (NEW)   │ <── Cancel button in job-detail.js
│   - Kill FFmpeg (SIGTERM)    │
│   - Clean up files           │
│   - Update job status        │
└──────────────────────────────┘
```

## Component Integration Points

### 1. Upload View Toggle (views/upload.js)

**Current state:** Submits FormData to `/api/jobs` via `uploadFiles()` XHR wrapper.

**Required changes:**

| Element | Change | Why |
|---------|--------|-----|
| Toggle UI | Add radio buttons: "Process on device" / "Send to server" | User choice between modes |
| Submit handler | Branch on `processingMode` variable | Different flows for device vs server |
| Progress UI | Shared progress bar component | Both modes show progress |
| Navigation | Device mode: stay on page → download. Server mode: navigate to job-detail | Device has no job to poll |

**Mode branching logic:**

```javascript
submitBtn.addEventListener('click', async () => {
  const mode = document.querySelector('input[name="mode"]:checked').value;

  if (mode === 'device') {
    // NEW: Local processing flow
    await processLocally(selectedFiles, variations);
    // Stay on upload page, show download button
  } else {
    // EXISTING: Server API flow (unchanged)
    const formData = new FormData();
    selectedFiles.forEach(f => formData.append('videos', f));
    formData.append('variations', variations);
    const data = await uploadFiles('/api/jobs', formData, onProgress);
    window.location.hash = `#job/${data.jobId}`;
  }
});
```

**Integration constraint:** Device processing doesn't create a job record, so it can't appear in job history. This is **by design** — local processing is ephemeral.

### 2. Device Processor Module (lib/device-processor.js - NEW)

**Responsibility:** Orchestrate local FFmpeg.wasm processing with progress tracking and ZIP generation.

**API surface:**

```javascript
// Main entry point
export async function processLocally(files, variationsPerVideo, onProgress, onComplete) {
  // 1. Create Web Worker
  const worker = new Worker('/workers/ffmpeg-worker.js', { type: 'module' });

  // 2. Load FFmpeg.wasm
  await sendWorkerMessage(worker, { type: 'LOAD' });

  // 3. Process each file
  const allResults = [];
  for (let i = 0; i < files.length; i++) {
    const fileResults = await processFileInWorker(worker, files[i], variationsPerVideo, (percent) => {
      const overall = ((i + percent/100) / files.length) * 100;
      onProgress(overall);
    });
    allResults.push(...fileResults);
  }

  // 4. Generate ZIP
  const zipBlob = await generateLocalZIP(allResults, files);

  // 5. Trigger download
  downloadBlob(zipBlob, `video-refresher-${Date.now()}.zip`);

  // 6. Clean up
  worker.terminate();

  onComplete();
}

async function processFileInWorker(worker, file, variations, onProgress) {
  // Read file as ArrayBuffer
  const buffer = await file.arrayBuffer();

  // Generate unique effects
  const effects = generateUniqueEffects(variations);

  // Process each variation
  const results = [];
  for (let i = 0; i < variations; i++) {
    const result = await sendWorkerMessage(worker, {
      type: 'PROCESS',
      payload: {
        inputBuffer: buffer,
        effects: effects[i],
        variationIndex: i
      }
    }, [buffer]); // Transferable

    results.push(result);
    onProgress(((i + 1) / variations) * 100);
  }

  return results;
}
```

**Key patterns:**
- **Transferable ArrayBuffers** — but careful of neutering (memory note from v1.0: always send `new Uint8Array(buffer)`)
- **Promise wrapper around postMessage** — async/await ergonomics
- **Progress aggregation** — per-file progress → overall batch progress
- **Worker lifecycle** — create → use → terminate (don't leave workers dangling)

**Memory management:** v1.0 discovered that FFmpeg.wasm 0.12.x neuters ArrayBuffers on `writeFile()`. Solution: **copy buffer before each write** (`new Uint8Array(buffer)`).

### 3. FFmpeg Worker (workers/ffmpeg-worker.js - RESTORED from v1.0)

**Responsibility:** Run FFmpeg.wasm in isolated Web Worker thread. Handle LOAD, PROCESS, TERMINATE messages.

**Structure:**

```javascript
import { FFmpeg } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.14/dist/esm/index.js';

let ffmpeg = null;

self.onmessage = async ({ data }) => {
  const { id, type, payload } = data;

  try {
    switch (type) {
      case 'LOAD':
        if (!ffmpeg) {
          ffmpeg = new FFmpeg();
          ffmpeg.on('log', ({ message }) => {
            console.log('[FFmpeg]', message);
          });
          ffmpeg.on('progress', ({ progress }) => {
            self.postMessage({ id, type: 'PROGRESS', data: progress * 100 });
          });
          await ffmpeg.load({
            coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.9/dist/umd/ffmpeg-core.js',
            wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.9/dist/umd/ffmpeg-core.wasm',
            workerURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.9/dist/umd/ffmpeg-core.worker.js'
          });
        }
        self.postMessage({ id, type: 'LOAD', data: true });
        break;

      case 'PROCESS':
        const { inputBuffer, effects, variationIndex } = payload;

        // Write input (copy to avoid neutering)
        await ffmpeg.writeFile('input.mp4', new Uint8Array(inputBuffer));

        // Build filter string from effects
        const filterString = buildFilterString(effects);

        // Execute FFmpeg
        await ffmpeg.exec([
          '-i', 'input.mp4',
          '-vf', filterString,
          '-preset', 'ultrafast',
          '-c:v', 'libx264',
          '-c:a', 'copy',
          `output_${variationIndex}.mp4`
        ]);

        // Read output
        const data = await ffmpeg.readFile(`output_${variationIndex}.mp4`);

        // Clean up
        await ffmpeg.deleteFile(`output_${variationIndex}.mp4`);

        // Return (transfer ownership)
        self.postMessage({ id, type: 'PROCESS', data: data.buffer }, [data.buffer]);
        break;

      case 'TERMINATE':
        if (ffmpeg) {
          // No explicit cleanup needed, worker will be terminated
        }
        self.postMessage({ id, type: 'TERMINATE', data: true });
        break;
    }
  } catch (error) {
    self.postMessage({ id, type: 'ERROR', data: error.message });
  }
};
```

**Key patterns from v1.0:**
- **FFmpeg.wasm 0.12.x API** — `FFmpeg()` class, `load()`, `writeFile()`, `exec()`, `readFile()`
- **Progress events** — `ffmpeg.on('progress')` provides 0-1 value, multiply by 100 for percentage
- **Buffer copying** — `new Uint8Array(inputBuffer)` prevents neutering (critical v1.0 bug fix)
- **Transferable returns** — Return `data.buffer` with transfer list for zero-copy performance
- **Module worker** — `type: 'module'` allows ES6 imports in worker

**COOP/COEP requirement:** Multi-threaded FFmpeg.wasm (@ffmpeg/core-mt) requires SharedArrayBuffer, which requires these headers in _headers file:

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

**Single-threaded fallback:** If headers aren't configured, use `@ffmpeg/core` (single-threaded) instead. v1.0 used automatic fallback detection.

### 4. Effects Library (lib/effects.js - EXTRACTED from server)

**Current state:** Effect generation logic lives in `server/lib/effects.js` (server-only).

**Required change:** Extract to shared library importable by both client and server.

**Location:** `lib/effects.js` (frontend), imported by:
- `workers/ffmpeg-worker.js` (client-side processing)
- `server/lib/effects.js` (re-export for server compatibility)

**API:**

```javascript
// lib/effects.js
export function generateUniqueEffects(count) {
  // Existing server logic - unchanged
  const effects = [];
  const used = new Set();

  while (effects.length < count) {
    const effect = generateRandomEffect();
    const key = JSON.stringify(effect);
    if (!used.has(key)) {
      used.add(key);
      effects.push(effect);
    }
  }

  return effects;
}

export function buildFilterString(effect) {
  // Convert effect object to FFmpeg filter string
  // Existing server logic - unchanged
}
```

**Server compatibility:**

```javascript
// server/lib/effects.js (becomes a re-export)
export { generateUniqueEffects, buildFilterString } from '../../lib/effects.js';
```

**Why shared:** Device mode and server mode must generate **identical variations** for the same input. Effect randomness must use the same algorithm.

### 5. ZIP Generation (lib/device-processor.js)

**Requirement:** Generate ZIP file client-side with variations organized by source video (same structure as server ZIP).

**Library:** JSZip 3.10.1 (already used in v1.0, removed in v2.0)

**Pattern:**

```javascript
import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';

async function generateLocalZIP(results, sourceFiles) {
  const zip = new JSZip();

  // Organize by source file (match server structure)
  const fileMap = new Map();
  sourceFiles.forEach(f => {
    const folderName = f.name.replace(/\.mp4$/i, '');
    fileMap.set(f.name, folderName);
  });

  results.forEach(({ fileName, sourceFile, buffer }) => {
    const folderName = fileMap.get(sourceFile);
    zip.file(`${folderName}/${fileName}`, buffer);
  });

  // Generate blob with STORE compression (videos already compressed)
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'STORE' // No re-compression (same as server)
  });

  return blob;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url); // Clean up
}
```

**Compression:** STORE (no compression) matches server behavior. Videos are already H.264 compressed; re-compressing wastes CPU.

### 6. Server Job Cancellation (NEW)

**Requirement:** Cancel button in job-detail.js for in-progress server jobs.

**API endpoint:**

```javascript
// server/routes/jobs.js
router.delete('/:id', requireAuth, async (req, res) => {
  const job = queries.getJob.get(req.params.id);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // If job is processing, kill FFmpeg process
  if (job.status === 'processing') {
    const files = queries.getJobFiles.all(job.id);
    for (const file of files) {
      if (file.pid) {
        try {
          process.kill(file.pid, 'SIGTERM');
        } catch (err) {
          console.error(`Failed to kill process ${file.pid}:`, err);
        }
      }
    }
  }

  // Update job status
  queries.updateJobStatus.run('cancelled', job.id);

  // Clean up files (best-effort)
  const outputFiles = queries.getOutputFiles.all(job.id);
  for (const out of outputFiles) {
    try {
      fs.unlinkSync(out.output_path);
    } catch (err) {
      console.error(`Failed to delete ${out.output_path}:`, err);
    }
  }

  res.json({ message: 'Job cancelled' });
});
```

**Frontend integration:**

```javascript
// views/job-detail.js
const cancelBtn = document.createElement('button');
cancelBtn.textContent = 'Cancel Job';
cancelBtn.addEventListener('click', async () => {
  if (!confirm('Cancel this job?')) return;

  await apiCall(`/api/jobs/${jobId}`, { method: 'DELETE' });
  window.location.hash = '#jobs';
});
```

**Process tracking:** Server already stores FFmpeg PIDs in `job_files.pid` (see `server/lib/processor.js` line 61). Use this for SIGTERM.

## Data Flow Comparison

### Server Mode (Existing v2.0)

```
1. Upload view: User selects files + variations
2. Submit button: uploadFiles('/api/jobs', formData)
3. Server: Create job, return jobId
4. Frontend: Navigate to #job/:id
5. Job detail view: Poll GET /api/jobs/:id every 2-10s
6. Server: Process videos, update progress in SQLite
7. Job detail view: Show progress bar, file status
8. Server: Mark job complete, store outputs
9. Job detail view: Show download button
10. Download button: GET /api/jobs/:id/download (streaming ZIP)
```

### Device Mode (New v3.0)

```
1. Upload view: User selects files + variations + toggle "device"
2. Submit button: processLocally(files, variations)
3. device-processor.js: Create Web Worker
4. device-processor.js: worker.postMessage({ type: 'LOAD' })
5. ffmpeg-worker.js: Load FFmpeg.wasm, postMessage({ type: 'LOAD', data: true })
6. device-processor.js: For each file, for each variation:
   a. worker.postMessage({ type: 'PROCESS', inputBuffer, effects })
   b. ffmpeg-worker.js: writeFile, exec, readFile, postMessage(result)
   c. device-processor.js: Aggregate results
   d. Upload view: Update progress bar (onProgress callback)
7. device-processor.js: generateLocalZIP(results)
8. device-processor.js: downloadBlob(zipBlob)
9. Upload view: Show "Download complete" message
10. device-processor.js: worker.terminate()
```

**Key difference:** Device mode **never creates a job record**. No server interaction beyond auth. No polling. No history entry.

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `views/upload.js` | UI for file selection, mode toggle, submission | `lib/api.js` (server mode), `lib/device-processor.js` (device mode) |
| `lib/device-processor.js` | Orchestrate local processing, ZIP generation | `workers/ffmpeg-worker.js`, `lib/effects.js`, JSZip |
| `workers/ffmpeg-worker.js` | FFmpeg.wasm execution in Web Worker | Main thread (postMessage), FFmpeg.wasm library |
| `lib/effects.js` | Effect generation algorithm (shared) | `workers/ffmpeg-worker.js`, `server/lib/effects.js` |
| `views/job-detail.js` | Job status polling, download, cancel | `lib/api.js` (server API) |
| `server/routes/jobs.js` | Job CRUD + cancel endpoint | `server/lib/processor.js`, SQLite |

**Isolation:** Device processing and server processing are **completely independent paths**. They share effect generation logic but have no other overlap.

## Suggested Build Order

Based on existing dependencies and integration complexity:

### Phase 1: Foundation (Independent work)

**1.1 Extract effect generation to shared library**
- Move `server/lib/effects.js` → `lib/effects.js`
- Update server imports
- Verify server processing still works (smoke test)

**Why first:** Both device and server need this. No UI work yet.

**1.2 Restore COOP/COEP headers**
- Update `_headers` file for Cloudflare Pages
- Deploy and verify SharedArrayBuffer availability (test in console)

**Why early:** Long feedback loop if deployment has issues.

### Phase 2: Device Processing Core (Web Worker)

**2.1 Create FFmpeg worker**
- Restore `workers/ffmpeg-worker.js` from v1.0 pattern
- Implement LOAD, PROCESS, TERMINATE handlers
- Import effects.js for filter string building
- Test in isolation with hardcoded input

**Why next:** Core processing logic. Validate FFmpeg.wasm still works.

**2.2 Build device-processor module**
- Create `lib/device-processor.js`
- Implement `processLocally()` orchestration
- Promise wrapper for worker messages
- Progress aggregation logic
- Test with single file, single variation

**Why next:** Orchestration layer. Depends on worker.

**2.3 Add ZIP generation**
- Import JSZip
- Implement `generateLocalZIP()` with folder structure
- Implement `downloadBlob()` helper
- Test with mock results

**Why next:** Output generation. Independent of UI.

### Phase 3: Upload View Integration (UI changes)

**3.1 Add mode toggle UI**
- Radio buttons: "Process on device" / "Send to server"
- Update submit button text based on mode
- Style toggle section

**Why next:** User-facing change. Depends on device-processor existing.

**3.2 Branch submit handler**
- Add `if (mode === 'device')` branch
- Call `processLocally()` with progress callback
- Update progress UI (reuse existing progress bar)
- Show download complete message

**Why next:** Integration point. Wires device-processor to UI.

**3.3 Error handling and cancellation**
- Catch worker errors, show in UI
- Add cancel button for device mode
- Implement worker.terminate() on cancel

**Why last in phase:** Polish. Core flow works first.

### Phase 4: Server Enhancements (Server-side)

**4.1 Add DELETE /api/jobs/:id endpoint**
- Implement cancellation logic (kill FFmpeg, clean files)
- Update job status to 'cancelled'
- Return success response

**Why independent:** Server change, no frontend dependency yet.

**4.2 Add cancel button to job-detail view**
- Show button only for processing/queued jobs
- Wire DELETE API call
- Redirect to job list on success

**Why last:** Depends on DELETE endpoint existing.

### Phase 5: Testing and Polish

**5.1 Cross-browser testing**
- Test device mode in Chrome, Firefox, Safari
- Verify SharedArrayBuffer availability
- Fallback messaging if COOP/COEP fails

**5.2 Mode comparison testing**
- Process same files in both modes
- Verify identical variation outputs (effect determinism)
- Verify ZIP structure matches

**5.3 Memory leak testing**
- Process large files in device mode
- Monitor memory usage
- Verify worker cleanup

## Architecture Patterns

### Pattern 1: Mode-Aware View Branching

**What:** Single view (upload.js) with conditional logic based on processing mode.

**When:** User toggles processing mode, submit handler branches.

**Implementation:**

```javascript
let processingMode = 'server'; // default

modeToggle.addEventListener('change', (e) => {
  processingMode = e.target.value;
  updateSubmitButtonText();
});

submitBtn.addEventListener('click', async () => {
  if (processingMode === 'device') {
    await handleDeviceMode();
  } else {
    await handleServerMode();
  }
});
```

**Why:** Avoids duplicating file selection UI. Single source of truth for mode state.

### Pattern 2: Promise-Based Worker Communication

**What:** Wrap postMessage/onmessage in Promises for async/await ergonomics.

**When:** Calling worker from main thread.

**Implementation:**

```javascript
let messageId = 0;
const pending = new Map();

function sendWorkerMessage(worker, message, transferables = []) {
  return new Promise((resolve, reject) => {
    const id = messageId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, ...message }, transferables);

    worker.onmessage = ({ data }) => {
      const handler = pending.get(data.id);
      if (!handler) return;

      pending.delete(data.id);

      if (data.type === 'ERROR') {
        handler.reject(new Error(data.data));
      } else {
        handler.resolve(data.data);
      }
    };
  });
}
```

**Why:** Matches existing async/await code style. Easier to follow than callback hell.

### Pattern 3: Transferable ArrayBuffer Copying

**What:** Copy ArrayBuffer before transferring to worker to prevent neutering.

**When:** Reusing buffer across multiple worker calls.

**Implementation:**

```javascript
// WRONG: Buffer is neutered after first call
await worker.postMessage({ buffer }, [buffer]);
await worker.postMessage({ buffer }, [buffer]); // buffer is empty!

// RIGHT: Copy before each call
await worker.postMessage({ buffer: new Uint8Array(buffer) }, [buffer]);
await worker.postMessage({ buffer: new Uint8Array(buffer) }, [buffer]); // works
```

**Why:** FFmpeg.wasm 0.12.x transfers ownership of ArrayBuffers. v1.0 bug fix (commit 8cbd4b3).

### Pattern 4: Progress Aggregation

**What:** Combine per-file, per-variation progress into overall batch progress.

**When:** Processing multiple files with multiple variations each.

**Implementation:**

```javascript
const totalFiles = files.length;
const totalVariations = files.length * variationsPerFile;

let completedVariations = 0;

// Per-variation progress
onVariationComplete(() => {
  completedVariations++;
  const overallProgress = (completedVariations / totalVariations) * 100;
  updateProgressBar(overallProgress);
});
```

**Why:** Matches server-side progress reporting. Users expect overall percentage.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Mixing Device Results with Job History

**What goes wrong:** Device processing creates job records, appears in history view.

**Why bad:** Device mode is local-only. Creating job records without server files causes errors on download.

**Instead:** Device processing bypasses job queue entirely. No job record, no history entry.

**Detection:** If job-list.js shows device-processed jobs, you've mixed flows.

### Anti-Pattern 2: Forgetting Worker Cleanup

**What goes wrong:** Workers accumulate, consume memory, eventually crash browser.

**Why bad:** Each worker holds FFmpeg.wasm in memory (~50MB). Multiple workers = OOM.

**Instead:** Always `worker.terminate()` after processing completes or on error.

**Detection:** Check DevTools → Memory → Detached workers. Should be 0 after processing.

### Anti-Pattern 3: Assuming COOP/COEP Always Available

**What goes wrong:** Multi-threaded FFmpeg.wasm fails silently if headers missing.

**Why bad:** User sees "processing" but nothing happens. No error message.

**Instead:** Check `crossOriginIsolated` flag at startup. Fall back to single-threaded core or show warning.

**Detection:**

```javascript
if (!crossOriginIsolated) {
  console.warn('SharedArrayBuffer not available. Using single-threaded FFmpeg.');
  // Use @ffmpeg/core instead of @ffmpeg/core-mt
}
```

### Anti-Pattern 4: Reusing Neutered Buffers

**What goes wrong:** First variation processes correctly, subsequent variations produce 0-byte files.

**Why bad:** ArrayBuffer transfer neuters original buffer (v1.0 bug).

**Instead:** Copy buffer before each transfer: `new Uint8Array(buffer)`.

**Detection:** Check output file sizes. If first is 5MB but rest are 0 bytes, buffer is neutered.

## Scalability Considerations

| Concern | At 1 file | At 10 files | At 100 files |
|---------|-----------|-------------|--------------|
| Memory (device) | ~100MB (FFmpeg.wasm + input/output buffers) | ~150MB (sequential processing, one file in memory at a time) | Not recommended (use server mode) |
| Memory (server) | ~200MB (Node process + FFmpeg subprocess) | ~500MB (sequential processing) | ~2GB (may need worker queue) |
| Time (device) | 30s @ 5 variations | 5min @ 5 variations | 50min (impractical) |
| Time (server) | 5s @ 5 variations (native FFmpeg) | 50s @ 5 variations | 8min |
| Storage (device) | 0 (ephemeral) | 0 (ephemeral) | 0 (ephemeral) |
| Storage (server) | ~50MB (temp files + outputs) | ~500MB (temp files + outputs) | ~5GB (exceeds volume cap, eviction triggers) |

**Recommendation:** Device mode for 1-3 files, server mode for 4+ files. Show UI hint based on file count.

## Sources

### FFmpeg.wasm Integration
- [FFmpeg.wasm Class API](https://ffmpegwasm.netlify.app/docs/api/ffmpeg/classes/ffmpeg/) - Official API documentation
- [FFmpeg.wasm Usage Guide](https://ffmpegwasm.netlify.app/docs/getting-started/usage/) - Getting started and usage patterns
- [Running FFMPEG with WASM in a Web Worker](https://paul.kinlan.me/running-ffmpeg-with-wasm-in-a-web-worker/) - Web Worker integration patterns
- [Running FFMPEG with WASM in a Web Worker - DEV Community](https://dev.to/chromiumdev/running-ffmpeg-with-wasm-in-a-web-worker-5gb5) - Practical implementation guide

### Web Worker Patterns
- [Using Web Workers - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers) - Official Web Workers guide
- [Worker: postMessage() method - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage) - Message passing API
- [Modern JavaScript Concurrency - 2025 Edition](https://dev.to/gkoos/modern-javascript-concurrency-2025-edition-h84) - Concurrency patterns including workers
- [Communicating between Web Workers via MessageChannel](https://2ality.com/2017/01/messagechannel.html) - Advanced worker communication

### Client-Side ZIP Generation
- [JSZip](https://stuk.github.io/jszip/) - Official documentation
- [Create Zip archives in the browser with Jszip](https://transloadit.com/devtips/create-zip-archives-in-the-browser-with-jszip/) - Practical guide
- [client-zip - npm](https://www.npmjs.com/package/client-zip) - Alternative streaming ZIP generator
- [generateAsync(options[, onUpdate])](https://stuk.github.io/jszip/documentation/api_jszip/generate_async.html) - ZIP generation API

### Hybrid Architecture Patterns
- [Client/Server and Peer-to-Peer hybrid architecture for adaptive video streaming](https://ieeexplore.ieee.org/document/7081293) - Academic hybrid architecture patterns
- [The trends shaping broadcast and media production in 2026](https://www.newscaststudio.com/2025/12/20/broadcast-media-industry-trends-2026/) - Industry trends in hybrid workflows

### Project-Specific Sources
- v1.0 implementation (commit 8cbd4b3) - Buffer neutering fix
- v2.0 server architecture (existing codebase) - API patterns
- Memory notes (MEMORY.md) - FFmpeg.wasm 0.12.x gotchas
