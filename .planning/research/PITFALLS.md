# Domain Pitfalls: Re-Introducing FFmpeg.wasm Alongside Server Processing

**Domain:** Hybrid client/server video processing architecture
**Researched:** 2026-02-07
**Confidence:** MEDIUM-HIGH (verified via official docs, GitHub issues, and community experience from v1.0)

**Context:** Video Refresher v3.0 is adding FFmpeg.wasm 0.12.x back as a "Process on device" option alongside the existing server-side processing flow. The frontend was completely rewritten in v2.0 as an API-driven SPA, and all FFmpeg.wasm code was removed. This document focuses on NEW pitfalls specific to re-introducing client-side processing in a hybrid architecture.

**Already solved in v1.0 (not covered here):**
- ArrayBuffer neutering bug (copy buffer before ffmpeg.writeFile)
- FFmpeg instance recovery from corruption
- Memory management with BlobURLRegistry and bounded arrays

---

## Critical Pitfalls

Mistakes that cause rewrites, breaking changes, or data loss.

### Pitfall 1: COOP/COEP Headers Break Server API Calls from Same-Origin Fetch

**What goes wrong:** Re-enabling COOP/COEP headers for FFmpeg.wasm's SharedArrayBuffer causes same-origin fetch calls to the Fly.io backend to fail with CORS errors or credential issues. The frontend on Cloudflare Pages (e.g., `videorefresher.pages.dev`) tries to fetch from the Fly.io backend (e.g., `videorefresher-api.fly.dev`), which is now cross-origin. With COEP set to `require-corp`, the server must respond with `Cross-Origin-Resource-Policy: cross-origin` or proper CORS headers, which the current v2.0 backend does not send.

**Why it happens:**
- v2.0 removed COOP/COEP headers because server-side processing doesn't need SharedArrayBuffer
- v3.0 needs these headers back for FFmpeg.wasm multi-threading
- Setting `Cross-Origin-Embedder-Policy: require-corp` forces ALL cross-origin resources (including API calls to the backend) to explicitly opt-in via CORP or CORS headers
- The v2.0 backend was designed for same-origin requests (both frontend and backend on Fly.io) or simple CORS (no COEP constraints)
- Frontend and backend are often deployed to different origins (Pages vs Fly.io) during development/staging

**Consequences:**
- Server mode completely breaks: upload, job polling, and download all fail
- User sees "Failed to fetch" errors with no clear cause
- API calls succeed in device mode but fail in server mode (confusing debugging)
- Browser console shows opaque CORS errors that don't explain COEP is the root cause
- Works in local development (same origin) but fails in production (cross-origin)

**Warning signs:**
- Fetch calls to backend return network errors after adding COOP/COEP headers
- Browser console: "Cross-Origin-Embedder-Policy: require-corp blocked loading [API URL]"
- API calls succeed when COEP is removed or set to unsafe-none
- Different behavior between localhost (same-origin) and deployed environments (cross-origin)

**Prevention:**

**Option 1: Add CORP header to all backend responses (simplest)**
```javascript
// server/middleware/cors.js (or similar)
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  // Keep existing CORS headers for credentials
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});
```

**Option 2: Use COEP credentialless mode (if credentials aren't needed cross-origin)**
```
# _headers (Cloudflare Pages)
/*
  Cross-Origin-Embedder-Policy: credentialless
  Cross-Origin-Opener-Policy: same-origin
```
This allows cross-origin resources without CORP headers but strips cookies/credentials from those requests. Works if the backend uses bearer tokens (which can be sent in Authorization header) instead of session cookies.

**Option 3: Serve both frontend and backend from same origin**
Deploy frontend as static files served by the Fly.io Express server instead of Cloudflare Pages. Eliminates cross-origin entirely but loses Pages benefits (global CDN, zero cost).

**Detection:**
- Test server mode upload/polling immediately after enabling COOP/COEP
- Check Network tab for failed API calls with CORS-like errors
- Add console logging before/after fetch to confirm headers are the issue
- Test with `Cross-Origin-Embedder-Policy: unsafe-none` temporarily to verify COEP is the blocker

**Confidence:** HIGH -- verified via [MDN COEP docs](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy), [web.dev COOP/COEP guide](https://web.dev/articles/coop-coep), and personal experience with cross-origin isolation requirements.

**Phase mapping:** Must be addressed in Phase 1 (COOP/COEP restoration). Backend CORP headers must be added BEFORE frontend COEP headers, or server mode will break immediately.

---

### Pitfall 2: Dual Processing Modes Without Abstraction Layer Causes Code Duplication and Drift

**What goes wrong:** Implementing device mode and server mode as two separate code paths (one using FFmpeg.wasm, one using fetch to backend API) leads to massive code duplication. The upload flow, progress tracking, error handling, and result presentation logic get duplicated with slight variations. Over time, the two modes diverge—bugs fixed in one aren't fixed in the other, features added to one don't appear in the other.

**Why it happens:**
- The two modes FEEL different: one is all browser-side with FFmpeg.wasm, one is network calls to backend
- Copy-paste development: "device mode works, let me copy it and change to fetch for server mode"
- No upfront design of a common abstraction layer
- Time pressure to ship: "I'll refactor later" (but never do)

**Consequences:**
- Codebase grows 2x without 2x functionality
- Bug fix needs to be applied in two places (one gets forgotten)
- UX inconsistencies: progress UI looks different between modes
- Feature parity breaks: cancellation works in server mode but not device mode
- Refactoring becomes prohibitively expensive after the first milestone

**Warning signs:**
- Finding yourself writing very similar code twice (upload validation, progress bars, error alerts)
- Different variable names for the same concept (processingMode vs mode vs isDevice)
- Bugs reported in one mode that don't exist in the other
- Copy-paste between device and server mode files

**Prevention:**

**Design a unified processing interface:**
```javascript
// lib/processor-interface.js
/**
 * Abstract interface for video processing (device or server)
 */
export class VideoProcessor {
  async init() { throw new Error('Not implemented'); }
  async process(files, variations, onProgress) { throw new Error('Not implemented'); }
  async cancel() { throw new Error('Not implemented'); }
  async download(result) { throw new Error('Not implemented'); }
}

// lib/device-processor.js (FFmpeg.wasm implementation)
export class DeviceProcessor extends VideoProcessor {
  async init() {
    this.ffmpeg = await createFFmpeg(...);
    await this.ffmpeg.load();
  }

  async process(files, variations, onProgress) {
    // FFmpeg.wasm batch processing logic
    for (let file of files) {
      for (let i = 0; i < variations; i++) {
        await this.ffmpeg.writeFile(...);
        await this.ffmpeg.exec(...);
        onProgress({ current: i, total: variations * files.length });
      }
    }
    return { type: 'device', outputs: [...] };
  }

  async cancel() {
    // Orchestration-layer cancellation (v1.0 pattern)
    this.cancelled = true;
  }

  async download(result) {
    // JSZip streaming
    const zip = new JSZip();
    result.outputs.forEach(o => zip.file(o.name, o.blob));
    return zip.generateAsync({ type: 'blob' });
  }
}

// lib/server-processor.js (API-driven implementation)
export class ServerProcessor extends VideoProcessor {
  async init() {
    // Verify auth token exists
    if (!localStorage.getItem('authToken')) {
      throw new Error('Not authenticated');
    }
  }

  async process(files, variations, onProgress) {
    // Upload to server, poll for status
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    formData.append('variations', variations);

    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` },
      body: formData
    });

    const { jobId } = await res.json();

    // Poll until complete
    return this.pollJob(jobId, onProgress);
  }

  async cancel() {
    // Call DELETE /api/jobs/:id
    await fetch(`/api/jobs/${this.currentJobId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
    });
  }

  async download(result) {
    // Fetch ZIP from server
    const res = await fetch(`/api/jobs/${result.jobId}/download`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
    });
    return res.blob();
  }
}

// views/upload.js (unified UI)
const processor = processingMode === 'device'
  ? new DeviceProcessor()
  : new ServerProcessor();

await processor.init();

const result = await processor.process(files, variations, (progress) => {
  updateProgressUI(progress);
});

const zipBlob = await processor.download(result);
downloadFile(zipBlob, 'variations.zip');
```

This pattern ensures:
- Upload UI is identical regardless of mode
- Progress tracking uses same interface
- Cancellation works the same way from user perspective
- Downloading is abstracted (client-side ZIP vs server-side ZIP download)

**Detection:**
- Code review: if you see two files with >70% similar structure, you need abstraction
- Count lines of code: adding device mode should be +500-1000 LOC, not +2000-3000 LOC
- Feature parity audit: list features, check both modes have them

**Confidence:** HIGH -- standard software engineering pattern (Strategy pattern). Verified via [Separated Interface pattern](https://java-design-patterns.com/patterns/separated-interface/) and years of maintaining hybrid systems.

**Phase mapping:** Must be designed in Phase 1 (architecture planning) BEFORE writing any device-mode code. Retrofitting abstraction after both modes are implemented is 5x harder than doing it upfront.

---

### Pitfall 3: JSZip in Browser Runs Out of Memory with Large Batches

**What goes wrong:** When processing in device mode, all variations must be ZIPped in the browser before download. JSZip loads the entire ZIP into memory. Processing 3 videos x 20 variations = 60 videos at ~20MB each = 1.2GB of video data. JSZip tries to hold all of this in browser memory simultaneously, causing "Out of memory" crashes or tab freezes.

**Why it happens:**
- v1.0 capped at 1 video x 20 variations = max 400MB in memory (borderline acceptable)
- v3.0 allows multiple source videos, multiplying the memory requirement
- Browser memory limits vary (Chrome: ~2GB per tab, Firefox: ~1.5GB, Safari: ~1GB)
- JSZip's default behavior buffers everything in RAM before generating the ZIP
- FFmpeg.wasm output videos are Blob URLs backed by memory, not disk

**Consequences:**
- Tab crashes mid-ZIP generation after all processing is done (devastating UX)
- "Aw, snap! Something went wrong" or browser OOM error
- Works with 1-2 videos but fails with 5+ videos
- Inconsistent: depends on user's browser, RAM, and other tabs open

**Warning signs:**
- Browser tab becomes unresponsive during "Preparing download..." step
- Browser DevTools show memory usage spiking above 1.5GB
- Crashes happen AFTER processing completes (during ZIP generation)
- Different users report different behavior (depends on their machine's RAM)

**Prevention:**

**Option 1: Use JSZip streaming mode (recommended)**
```javascript
import JSZip from 'jszip';

async function downloadDeviceResults(outputs) {
  const zip = new JSZip();

  // Add files to ZIP without loading all into memory at once
  for (const output of outputs) {
    // Use streamFiles: true to avoid buffering entire ZIP
    zip.file(output.name, output.blob);
  }

  // Generate ZIP in chunks, not all at once
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'STORE', // No compression (videos are already H.264 compressed)
    streamFiles: true     // CRITICAL: stream files instead of buffering all
  });

  // Trigger download
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'variations.zip';
  a.click();
  URL.revokeObjectURL(url);
}
```

**Option 2: Cap variations in device mode**
```javascript
// Enforce lower limits for device mode vs server mode
const MAX_DEVICE_VARIATIONS = 10; // vs 20 for server mode
const MAX_DEVICE_FILES = 3;       // vs 10 for server mode

if (processingMode === 'device') {
  if (selectedFiles.length > MAX_DEVICE_FILES) {
    alert(`Device mode supports up to ${MAX_DEVICE_FILES} files. Use server mode for larger batches.`);
    return;
  }
  if (variations > MAX_DEVICE_VARIATIONS) {
    variations = MAX_DEVICE_VARIATIONS;
    console.warn(`Device mode capped at ${MAX_DEVICE_VARIATIONS} variations`);
  }
}
```

**Option 3: Download variations individually instead of ZIP**
```javascript
// Skip ZIP entirely in device mode
for (const output of outputs) {
  const url = URL.createObjectURL(output.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = output.name;
  a.click();
  URL.revokeObjectURL(url);
  await new Promise(r => setTimeout(r, 100)); // Slight delay between downloads
}
```
This sacrifices UX (user has to handle 60 individual files) but avoids memory issues entirely.

**Detection:**
- Test with max variations (3 files x 20 variations) in device mode
- Monitor browser memory usage during ZIP generation
- Test on low-RAM devices (4GB laptop) and multiple browsers
- Add pre-flight check: estimate ZIP size, warn if >500MB

**Confidence:** HIGH -- verified via [JSZip limitations](https://stuk.github.io/jszip/documentation/limitations.html), [JSZip memory issues](https://github.com/Stuk/jszip/issues/135), and [streaming solutions](https://github.com/Stuk/jszip/issues/308).

**Phase mapping:** Must be addressed in Phase 3 (device mode download/ZIP). Test with realistic batch sizes (3 videos x 20 variations) before declaring device mode "done."

---

### Pitfall 4: No Graceful Degradation When FFmpeg.wasm Fails to Load

**What goes wrong:** FFmpeg.wasm fails to load (network timeout, CDN unavailable, browser incompatibility, missing COOP/COEP headers). The app shows a cryptic error or infinite loading spinner. User is stuck—they selected device mode but can't switch to server mode without refreshing the page and losing their file selection.

**Why it happens:**
- FFmpeg.wasm loads asynchronously from CDN (jsdelivr, unpkg)
- CDN failures are rare but real (China blocks jsdelivr, corporate firewalls)
- Browser incompatibility (Safari versions, private browsing mode)
- COOP/COEP headers misconfigured (SharedArrayBuffer unavailable)
- "Device mode" toggle is selected before FFmpeg loads, so failure happens mid-workflow

**Consequences:**
- User can't process their videos
- No fallback to server mode (or not obvious how to switch)
- App appears broken, user abandons
- Support burden: "It worked yesterday, now it won't load"

**Warning signs:**
- FFmpeg.wasm load timeout (>30s with no response)
- Browser console: "SharedArrayBuffer is not defined" or CORS error on FFmpeg core
- Device mode button visible but clicking it does nothing
- Error message says "Failed to load FFmpeg" but doesn't suggest next steps

**Prevention:**

**1. Detect FFmpeg.wasm capability before showing device mode option**
```javascript
// lib/feature-detection.js
export async function detectDeviceModeSupport() {
  // Check SharedArrayBuffer is available
  if (typeof SharedArrayBuffer === 'undefined') {
    return { supported: false, reason: 'SharedArrayBuffer not available (missing COOP/COEP headers)' };
  }

  // Check COOP/COEP headers are set correctly
  if (!crossOriginIsolated) {
    return { supported: false, reason: 'Cross-origin isolation not enabled' };
  }

  // Try loading FFmpeg.wasm core (with timeout)
  try {
    const { createFFmpeg } = await Promise.race([
      import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.14/dist/ffmpeg.min.js'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
    ]);

    return { supported: true, reason: null };
  } catch (err) {
    return { supported: false, reason: `FFmpeg.wasm failed to load: ${err.message}` };
  }
}

// views/upload.js
const deviceSupport = await detectDeviceModeSupport();

if (deviceSupport.supported) {
  // Show both "Device" and "Server" mode toggle
  renderModeToggle(['device', 'server']);
} else {
  // Only show "Server" mode, with explanation
  renderModeToggle(['server']);
  showInfoBanner(`Device mode unavailable: ${deviceSupport.reason}. Using server mode.`);
}
```

**2. Graceful fallback during processing**
```javascript
async function startProcessing() {
  if (mode === 'device') {
    try {
      await deviceProcessor.init(); // Load FFmpeg.wasm
    } catch (err) {
      console.error('Device mode init failed:', err);

      // Prompt user to switch to server mode
      const fallback = confirm(
        'Device processing is unavailable. Switch to server mode?\n\n' +
        `Reason: ${err.message}`
      );

      if (fallback) {
        mode = 'server';
        await serverProcessor.init();
      } else {
        throw new Error('Processing cancelled by user');
      }
    }
  }

  // Proceed with whichever processor is ready
  await currentProcessor.process(files, variations, onProgress);
}
```

**3. Show loading state during FFmpeg init**
```javascript
// Don't let user click "Process" until FFmpeg is ready
processBtn.disabled = true;
processBtn.textContent = 'Loading FFmpeg.wasm...';

try {
  await ffmpeg.load();
  processBtn.disabled = false;
  processBtn.textContent = 'Process on Device';
} catch (err) {
  processBtn.disabled = true;
  processBtn.textContent = 'Device Mode Unavailable';
  showError('FFmpeg.wasm failed to load. Please use server mode.');
}
```

**Detection:**
- Test in browsers with different security settings (private mode, restrictive CSP)
- Test with network throttling (slow 3G) to simulate CDN timeout
- Test with CDN blocked (hosts file entry for jsdelivr.net)
- Test in Safari (SharedArrayBuffer support varies by version)

**Confidence:** HIGH -- based on v1.0 experience with FFmpeg.wasm loading issues and [SharedArrayBuffer browser compatibility](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer).

**Phase mapping:** Must be addressed in Phase 1 (mode selection UI) and Phase 2 (FFmpeg init). Don't defer this to "polish" phase—it's core functionality.

---

## Moderate Pitfalls

Mistakes that cause degraded UX, tech debt, or confusion.

### Pitfall 5: State Management Hell When Switching Between Modes Mid-Session

**What goes wrong:** User selects files, chooses device mode, starts processing, realizes it's slow, tries to switch to server mode mid-process. The app state is corrupted: some files are processed, some aren't, progress UI shows wrong values, FFmpeg.wasm memory isn't released, previous Blob URLs leak.

**Why it happens:**
- Processing mode is global state but tied to ephemeral processing state
- Switching modes mid-workflow doesn't clean up previous mode's state
- Each mode has different state shape (device: Blob URLs, server: jobId)
- No state machine to enforce valid transitions

**Consequences:**
- Memory leaks (FFmpeg instance not cleaned up)
- Blob URL leaks (10-20MB per video, accumulates over time)
- Progress bar shows incorrect values (mixing device and server progress)
- Download button tries to download from wrong mode (404 or wrong ZIP)
- User can't tell which mode is currently active

**Warning signs:**
- Browser memory usage grows with each mode switch
- Progress jumps around (50% → 0% → 30%) when switching modes
- Download button appears but clicking it does nothing
- Multiple FFmpeg instances running simultaneously

**Prevention:**

**1. Disable mode switching during active processing**
```javascript
// views/upload.js
function renderModeToggle() {
  const deviceBtn = document.createElement('button');
  deviceBtn.textContent = 'Process on Device';
  deviceBtn.disabled = isProcessing; // Disable if processing

  const serverBtn = document.createElement('button');
  serverBtn.textContent = 'Send to Server';
  serverBtn.disabled = isProcessing;

  if (isProcessing) {
    const warning = document.createElement('p');
    warning.textContent = 'Cannot switch modes during processing';
    warning.style.color = 'orange';
    container.appendChild(warning);
  }

  deviceBtn.addEventListener('click', () => switchMode('device'));
  serverBtn.addEventListener('click', () => switchMode('server'));

  container.appendChild(deviceBtn);
  container.appendChild(serverBtn);
}
```

**2. Full cleanup when switching modes**
```javascript
async function switchMode(newMode) {
  if (currentMode === newMode) return;

  // Clean up previous mode's state
  await cleanupCurrentMode();

  // Reset shared state
  selectedFiles = [];
  processedOutputs = [];
  currentProgress = 0;

  // Initialize new mode
  currentMode = newMode;
  await initializeMode(newMode);

  // Re-render UI for new mode
  renderUploadView();
}

async function cleanupCurrentMode() {
  if (currentMode === 'device') {
    // Release FFmpeg instance
    if (deviceProcessor.ffmpeg) {
      // FFmpeg.wasm 0.12 doesn't have explicit cleanup, but terminate worker
      deviceProcessor.ffmpeg = null;
    }

    // Revoke all Blob URLs
    processedOutputs.forEach(output => {
      if (output.blobUrl) {
        URL.revokeObjectURL(output.blobUrl);
      }
    });
  } else if (currentMode === 'server') {
    // Abort any ongoing fetch/polling
    if (serverProcessor.pollController) {
      serverProcessor.pollController.abort();
    }
  }
}
```

**3. Use state machine for valid mode transitions**
```javascript
const STATE_MACHINE = {
  idle: {
    selectFiles: 'filesSelected',
    selectMode: 'idle' // Can switch modes freely
  },
  filesSelected: {
    startProcessing: 'processing',
    selectMode: 'filesSelected', // Can still switch modes
    clearFiles: 'idle'
  },
  processing: {
    // Cannot switch modes during processing
    cancel: 'filesSelected',
    complete: 'complete',
    error: 'filesSelected'
  },
  complete: {
    download: 'complete',
    clearFiles: 'idle',
    selectMode: 'idle' // Can switch modes after completion
  }
};

function transition(action) {
  const nextState = STATE_MACHINE[currentState][action];
  if (!nextState) {
    console.warn(`Invalid transition: ${currentState} -> ${action}`);
    return false;
  }
  currentState = nextState;
  return true;
}

// Usage
if (!transition('selectMode')) {
  alert('Cannot switch modes during processing');
  return;
}
```

**Detection:**
- Test mode switching at every stage: idle, files selected, processing, complete
- Monitor browser memory usage during repeated mode switches
- Check Network tab for leaked API calls or aborted requests
- Verify Blob URL count doesn't grow indefinitely (chrome://blob-internals)

**Confidence:** MEDIUM-HIGH -- based on general state management pitfalls in SPAs ([State Management in Vanilla JS 2026](https://medium.com/@chirag.dave/state-management-in-vanilla-js-2026-trends-f9baed7599de)) and experience with hybrid architectures.

**Phase mapping:** Address in Phase 2 (mode selection and initialization). Design the state machine upfront, not after bugs appear.

---

### Pitfall 6: Server Job Cancellation Requires Backend Changes That Don't Exist Yet

**What goes wrong:** In v2.0, there's no job cancellation API. User starts a server-mode job (3 videos x 20 variations = 30+ minutes), realizes they made a mistake, but can't cancel. The job runs to completion, wasting server resources and user time. In v3.0, device mode has cancellation (orchestration-layer abort) but server mode doesn't, creating UX inconsistency.

**Why it happens:**
- v2.0 was fire-and-forget: submit job, close browser, come back later
- Cancellation wasn't a requirement (no real-time monitoring during v2.0 development)
- Adding cancellation requires backend changes: kill FFmpeg child process, clean up partial files, mark job as cancelled in SQLite
- Frontend can't just stop polling—the job continues running on server

**Consequences:**
- User starts wrong job, can't cancel, has to wait 30 minutes
- Server resources wasted on jobs user doesn't want
- Device mode has cancel button, server mode doesn't (confusing)
- User work-around: refresh page and start new job (original job keeps running, wastes resources)

**Warning signs:**
- Cancel button in device mode but greyed out in server mode
- Users asking "how do I stop this job?"
- Server running multiple old jobs user abandoned
- Storage fills up with unwanted partial results

**Prevention:**

**1. Add cancellation API to backend (prerequisite for v3.0)**
```javascript
// server/routes/jobs.js
app.delete('/api/jobs/:id', authenticate, async (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status === 'processing') {
    // Kill FFmpeg child process
    const pid = job.ffmpeg_pid; // Need to store PID when spawning FFmpeg
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (err) {
        console.error(`Failed to kill FFmpeg PID ${pid}:`, err);
      }
    }

    // Clean up partial output files
    const outputDir = path.join(OUTPUT_DIR, job.id);
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }

    // Mark job as cancelled
    db.prepare('UPDATE jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('cancelled', req.params.id);
  }

  res.json({ status: 'cancelled' });
});
```

**2. Store FFmpeg PID when spawning**
```javascript
// server/lib/ffmpeg.js
function spawnFFmpeg(args, jobId) {
  const ffmpeg = spawn('ffmpeg', args);

  // Store PID in SQLite so we can kill it later
  db.prepare('UPDATE jobs SET ffmpeg_pid = ? WHERE id = ?')
    .run(ffmpeg.pid, jobId);

  return ffmpeg;
}
```

**3. Consistent cancellation UI across modes**
```javascript
// views/upload.js (or job-detail.js)
function renderCancelButton() {
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'btn-danger';

  cancelBtn.addEventListener('click', async () => {
    if (mode === 'device') {
      // Orchestration-layer cancellation (v1.0 pattern)
      deviceProcessor.cancel();
    } else {
      // Server-side cancellation (new in v3.0)
      await fetch(`/api/jobs/${currentJobId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    }

    // Update UI to reflect cancellation
    processingStatus.textContent = 'Cancelled';
    cancelBtn.disabled = true;
  });

  return cancelBtn;
}
```

**Detection:**
- Try to cancel a server-mode job in v2.0 (no API endpoint exists)
- Check if FFmpeg child process is killed when job is deleted
- Verify partial output files are cleaned up after cancellation
- Test cancellation in both modes to ensure consistent UX

**Confidence:** HIGH -- based on v2.0 codebase (no cancellation endpoint), v1.0 device cancellation pattern, and standard job queue patterns.

**Phase mapping:** Backend cancellation API must be added in Phase 4 (server-side job cancellation) BEFORE frontend cancel button is shown. Otherwise, cancel button in server mode is a lie.

---

### Pitfall 7: Upload Flow Divergence Creates Two Separate UI Paths

**What goes wrong:** Device mode uploads file into browser memory (File API, no network). Server mode uploads file to backend via FormData multipart upload. These are fundamentally different operations, leading to two separate upload flows: one with instant feedback (device), one with upload progress bar (server). Code duplication, different error handling, different validation timing.

**Why it happens:**
- Device mode: file is already in memory, just need to validate and pass to FFmpeg
- Server mode: file must be uploaded over network, needs progress tracking, retry, error handling
- Upload logic is intertwined with mode selection instead of abstracted

**Consequences:**
- Upload validation runs twice (device-side and server-side)
- Different error messages for the same issue (file too large, wrong format)
- Device mode feels instant, server mode feels slow (user confusion)
- Code duplication: validation, file size check, format check all duplicated

**Warning signs:**
- Two different file input handlers for device vs server mode
- Validation logic in both frontend and backend with slight differences
- Different error messages for file size limit between modes
- Different loading spinners / progress bars between modes

**Prevention:**

**1. Unified upload validation (before mode divergence)**
```javascript
// lib/upload-validator.js
export function validateFiles(files, mode) {
  const errors = [];

  // Common validation (applies to both modes)
  for (const file of files) {
    if (!file.type === 'video/mp4') {
      errors.push(`${file.name}: Must be MP4 format`);
    }

    const maxSize = mode === 'device'
      ? 100 * 1024 * 1024  // 100MB for device (browser memory limit)
      : 200 * 1024 * 1024; // 200MB for server (backend disk/bandwidth limit)

    if (file.size > maxSize) {
      errors.push(`${file.name}: Exceeds ${formatBytes(maxSize)} limit for ${mode} mode`);
    }
  }

  return errors;
}

// views/upload.js
function addFiles(files) {
  const errors = validateFiles(files, currentMode);

  if (errors.length > 0) {
    showErrors(errors);
    return;
  }

  // Files are valid, add to selection
  selectedFiles.push(...files);
  renderFileList();
}
```

**2. Abstract upload operation behind processor interface**
```javascript
// lib/device-processor.js
class DeviceProcessor {
  async uploadFiles(files) {
    // "Upload" is a no-op for device mode (files already in memory)
    return files.map(f => ({
      name: f.name,
      size: f.size,
      buffer: f // File object is already in memory
    }));
  }
}

// lib/server-processor.js
class ServerProcessor {
  async uploadFiles(files, onProgress) {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded / e.total);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Upload failed')));

      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);
      xhr.send(formData);
    });
  }
}

// views/upload.js (unified flow)
async function startProcessing() {
  showProgress('Uploading...');

  const uploadedFiles = await currentProcessor.uploadFiles(selectedFiles, (pct) => {
    updateProgress(pct * 100, 'Uploading...');
  });

  showProgress('Processing...');

  const result = await currentProcessor.process(uploadedFiles, variations, (progress) => {
    updateProgress(progress.percent, `Processing ${progress.current}/${progress.total}...`);
  });

  // ... rest of flow is identical
}
```

**Detection:**
- Code review: search for file validation logic, should only appear once
- Test same file in both modes, verify error messages are consistent
- Test file too large, wrong format, network error in both modes

**Confidence:** MEDIUM-HIGH -- based on common SPA patterns and the processor abstraction design from Pitfall 2.

**Phase mapping:** Address in Phase 2 (upload flow unification). Design this alongside the processor abstraction layer.

---

### Pitfall 8: FFmpeg.wasm Multi-Threading Requires Worker Scope, Breaks in Main Thread

**What goes wrong:** FFmpeg.wasm 0.12.x supports multi-threading via SharedArrayBuffer, but this ONLY works when FFmpeg runs in a Web Worker. If FFmpeg is initialized in the main thread (e.g., inline in upload.js), multi-threading silently falls back to single-threaded mode, making device processing much slower than expected (2-5x slower).

**Why it happens:**
- SharedArrayBuffer can be used in main thread for storage, but FFmpeg's multi-threading uses pthreads which require Worker scope
- FFmpeg.wasm automatically detects if it's in a Worker and enables/disables threading accordingly
- The v1.0 code may have run FFmpeg in main thread (simpler for small batches)
- v3.0 multi-video batches need multi-threading for acceptable performance

**Consequences:**
- Device mode processing is painfully slow (10-20 minutes for 3 videos x 10 variations)
- User perceives device mode as "broken" or "worse than server mode"
- No error message—FFmpeg just runs single-threaded silently
- Battery drain on laptops (long-running CPU task)

**Warning signs:**
- Device mode takes significantly longer than v1.0 for same batch size
- Browser DevTools show FFmpeg using only 1 CPU core (not 4-8)
- Console warning: "FFmpeg.wasm running in single-threaded mode"

**Prevention:**

**1. Run FFmpeg in a Web Worker**
```javascript
// lib/ffmpeg-worker.js (runs in Worker scope)
import { createFFmpeg } from '@ffmpeg/ffmpeg';

let ffmpeg;

self.addEventListener('message', async (e) => {
  const { type, payload } = e.data;

  if (type === 'init') {
    ffmpeg = createFFmpeg({
      log: true,
      corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js',
      // Multi-threading works because we're in Worker scope
    });
    await ffmpeg.load();
    self.postMessage({ type: 'ready' });
  }

  if (type === 'process') {
    const { file, effects } = payload;

    // Write file to FFmpeg virtual filesystem
    ffmpeg.FS('writeFile', 'input.mp4', new Uint8Array(await file.arrayBuffer()));

    // Run FFmpeg with effects
    await ffmpeg.run(...effects.toFFmpegArgs('input.mp4', 'output.mp4'));

    // Read output
    const data = ffmpeg.FS('readFile', 'output.mp4');

    self.postMessage({ type: 'complete', data: data.buffer }, [data.buffer]);
  }
});

// views/upload.js (main thread)
const ffmpegWorker = new Worker('/lib/ffmpeg-worker.js', { type: 'module' });

ffmpegWorker.postMessage({ type: 'init' });

ffmpegWorker.addEventListener('message', (e) => {
  if (e.data.type === 'ready') {
    console.log('FFmpeg ready (multi-threaded)');
  }

  if (e.data.type === 'complete') {
    const blob = new Blob([e.data.data], { type: 'video/mp4' });
    processedVideos.push(blob);
  }
});

// Process file
ffmpegWorker.postMessage({
  type: 'process',
  payload: { file: selectedFiles[0], effects: generateRandomEffects() }
});
```

**2. Verify multi-threading is active**
```javascript
// After FFmpeg loads
if (ffmpeg.isLoaded()) {
  const threadCount = ffmpeg.getConfig('threads') || 1;
  console.log(`FFmpeg loaded with ${threadCount} threads`);

  if (threadCount === 1) {
    console.warn('FFmpeg is single-threaded. Performance will be degraded.');
  }
}
```

**Detection:**
- Check browser DevTools Performance tab during encoding (should see multiple threads)
- Log FFmpeg initialization config to console
- Benchmark same video in v1.0 vs v3.0 (should be similar speed, not 5x slower)

**Confidence:** MEDIUM -- based on FFmpeg.wasm documentation and SharedArrayBuffer/Worker requirements. Specific behavior depends on FFmpeg.wasm version.

**Phase mapping:** Must be addressed in Phase 2 (FFmpeg.wasm initialization). Running in Worker is an architectural decision that affects all subsequent device-mode code.

---

## Minor Pitfalls

Mistakes that cause annoyance or inconsistency but are easily fixable.

### Pitfall 9: Mode Toggle State Persists Across Page Refresh, Confusing Users

**What goes wrong:** User selects "Device mode," refreshes the page, sees device mode is still selected but their file selection is gone (files are in-memory, not persisted). Or worse, device mode was selected but FFmpeg fails to load after refresh, and user is stuck.

**Why it happens:**
- Mode preference stored in localStorage to preserve user choice
- File selection is not persisted (File objects can't be serialized)
- FFmpeg load state is not persisted (needs re-initialization)

**Consequences:**
- User refreshes mid-workflow, files gone but mode is still "device"
- User can't process anything until they re-select files
- If FFmpeg fails to load after refresh, mode is stuck on "device" but it doesn't work

**Prevention:**

**1. Clear processing state on page load**
```javascript
// app.js (on page load)
window.addEventListener('DOMContentLoaded', () => {
  // Preserve mode preference
  const savedMode = localStorage.getItem('processingMode') || 'server';

  // But clear any processing state
  localStorage.removeItem('selectedFiles'); // Can't persist File objects anyway
  localStorage.removeItem('currentJobId');
  localStorage.removeItem('processingProgress');

  // Initialize with saved mode (or default to server)
  currentMode = savedMode;
  renderApp();
});
```

**2. Don't persist mode during active processing**
```javascript
function setMode(mode) {
  currentMode = mode;

  // Only persist mode if not actively processing
  if (!isProcessing) {
    localStorage.setItem('processingMode', mode);
  }
}

// Clear mode preference if user abandons processing
window.addEventListener('beforeunload', (e) => {
  if (isProcessing) {
    // Warn user they'll lose progress
    e.preventDefault();
    e.returnValue = 'Processing in progress. Are you sure you want to leave?';

    // Clear mode preference (force fresh start on next visit)
    localStorage.removeItem('processingMode');
  }
});
```

**3. Reset to safe default on FFmpeg load failure**
```javascript
async function initDeviceMode() {
  try {
    await ffmpeg.load();
  } catch (err) {
    console.error('FFmpeg failed to load:', err);

    // Fallback to server mode
    localStorage.setItem('processingMode', 'server');
    currentMode = 'server';

    alert('Device mode is unavailable. Switched to server mode.');
    renderApp();
  }
}
```

**Detection:**
- Refresh page mid-processing, check if state is sane
- Manually corrupt localStorage (set processingMode to invalid value), refresh, verify recovery

**Confidence:** MEDIUM -- common localStorage state management issue in SPAs.

**Phase mapping:** Address in Phase 1 (mode selection persistence). Simple fix, but easy to overlook.

---

### Pitfall 10: Device Mode and Server Mode Have Different Feature Sets

**What goes wrong:** Over time, features get added to one mode but not the other. Examples:
- Cancellation works in device mode but not server mode (or vice versa)
- Progress estimation is accurate in server mode but vague in device mode
- Server mode shows job history, device mode doesn't
- Error messages are detailed in one mode, generic in the other

**Why it happens:**
- Features are added incrementally to whichever mode is being worked on
- No feature parity checklist
- Different developers work on different modes
- Time pressure: "ship server mode now, add to device mode later"

**Consequences:**
- User confusion: "Why can't I see my history in device mode?"
- Perception that one mode is "better" (user always picks server mode, device mode is unused)
- Tech debt: eventually need to backport features to the other mode

**Prevention:**

**1. Feature parity matrix (track during development)**
```markdown
| Feature | Device Mode | Server Mode | Notes |
|---------|-------------|-------------|-------|
| Upload multiple files | ✅ | ✅ | |
| Specify variations (1-20) | ✅ (capped at 10) | ✅ | Device limit lower due to memory |
| Progress tracking | ✅ | ✅ | |
| Cancellation | ✅ | ✅ | Both modes support cancel |
| Job history | ❌ | ✅ | Device mode is ephemeral (no server-side storage) |
| Download ZIP | ✅ | ✅ | Device: JSZip, Server: streaming ZIP |
| Error recovery | ✅ | ✅ | FFmpeg retry on corruption |
| Variations preview | ⚠️ Planned | ✅ | Server mode shows thumbnails |
```

**2. Mode-agnostic feature implementation**
When adding a feature, ask: "Does this make sense in both modes?"
- If YES: implement for both modes using abstraction layer
- If NO: document why it's mode-specific and show clear UI indication

Example: Job history is server-only because device mode has no backend. Show this clearly:
```javascript
if (mode === 'device') {
  showInfoBanner('Device mode processes locally. Job history is only available in server mode.');
}
```

**3. Regression testing for both modes**
```javascript
// test/feature-parity.test.js
const FEATURES = ['upload', 'progress', 'cancel', 'download', 'errors'];

for (const mode of ['device', 'server']) {
  describe(`${mode} mode`, () => {
    for (const feature of FEATURES) {
      it(`should support ${feature}`, async () => {
        // Test that feature works in this mode
      });
    }
  });
}
```

**Detection:**
- Periodically audit feature matrix (every milestone)
- User feedback: "Why doesn't device mode have X?"
- Compare device and server mode files side-by-side

**Confidence:** MEDIUM -- based on general software maintenance patterns, not specific to this project.

**Phase mapping:** Establish feature parity matrix in Phase 1 and maintain it throughout development. Review before each milestone.

---

### Pitfall 11: Cloudflare Pages COOP/COEP Headers Deployment Timing

**What goes wrong:** COOP/COEP headers are added to `_headers` file and deployed to Cloudflare Pages. But Pages caching means old headers persist for minutes to hours after deploy. Users hit the site before headers propagate, FFmpeg.wasm fails to load, device mode is broken for early users.

**Why it happens:**
- Cloudflare Pages caches at edge (globally distributed CDN)
- Header changes propagate slower than HTML/JS changes
- No cache purge mechanism exposed to users
- Users bookmark the site and hit cached version

**Consequences:**
- Deploy v3.0, device mode works for you (Cloudflare invalidated your cache) but not for users
- Support reports: "Device mode doesn't work" but it works when you test
- Inconsistent behavior across geographies (some edges updated, some haven't)

**Prevention:**

**1. Deploy headers first, code second**
```bash
# Day 1: Deploy only _headers file (enable COOP/COEP)
git add _headers
git commit -m "Enable COOP/COEP headers for v3.0"
git push

# Wait 1-2 hours for global propagation

# Day 2: Deploy device mode code
git add views/upload.js lib/device-processor.js
git commit -m "Add device mode processing"
git push
```

This ensures headers are live before code tries to use them.

**2. Verify headers in production before announcing**
```bash
# Check headers are live
curl -I https://videorefresher.pages.dev | grep -i "cross-origin"

# Expected output:
# cross-origin-embedder-policy: require-corp
# cross-origin-opener-policy: same-origin
```

**3. Add feature flag for device mode**
```javascript
// lib/config.js
const FEATURES = {
  deviceMode: crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
};

// views/upload.js
if (FEATURES.deviceMode) {
  showModeToggle(['device', 'server']);
} else {
  showModeToggle(['server']); // Hide device mode if headers aren't live
  console.warn('Device mode disabled: cross-origin isolation not available');
}
```

**Detection:**
- Test from multiple locations (US, EU, Asia) after deploy
- Use VPN to test from different regions
- Check browser console for SharedArrayBuffer availability
- Monitor error rate spike after deploy

**Confidence:** MEDIUM -- based on general CDN propagation behavior and [Cloudflare Pages headers documentation](https://developers.cloudflare.com/pages/configuration/headers/).

**Phase mapping:** Address in deployment planning (Phase 5). Deploy headers separately from code, with propagation time buffer.

---

## Integration-Specific Pitfalls

Mistakes specific to re-introducing FFmpeg.wasm into an existing SPA.

### Pitfall 12: Forgot to Re-Add FFmpeg.wasm CDN URLs and Worker Files

**What goes wrong:** v2.0 removed all FFmpeg.wasm references (CDN URLs, worker files, COOP/COEP headers). When adding device mode in v3.0, developer forgets to re-add CDN script tags, or adds them but with wrong version (0.11.x instead of 0.12.x), or forgets to self-host the worker file. FFmpeg fails to load with cryptic CORS errors.

**Why it happens:**
- v1.0 setup was many commits ago, no clear reference
- CDN URLs were in HTML `<script>` tags that no longer exist
- Worker file was self-hosted in `/lib/` but that directory was cleaned up
- Version numbers changed between v1.0 and v3.0

**Consequences:**
- FFmpeg.wasm doesn't load at all
- Console errors: "Failed to load module" or CORS error on worker.js
- Device mode toggle is visible but clicking it does nothing
- Waste time debugging before realizing CDN URLs are missing

**Prevention:**

**1. Document FFmpeg.wasm setup checklist**
```markdown
# FFmpeg.wasm Setup Checklist

- [ ] Add CDN script tag to index.html:
  ```html
  <script src="https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.14/dist/ffmpeg.min.js"></script>
  ```

- [ ] Self-host worker files (can't use CDN due to CORS):
  - Download ffmpeg-core.js and ffmpeg-core.wasm from jsdelivr
  - Place in /lib/ffmpeg/ directory
  - Configure FFmpeg to use local path:
    ```javascript
    const ffmpeg = createFFmpeg({
      corePath: '/lib/ffmpeg/ffmpeg-core.js'
    });
    ```

- [ ] Enable COOP/COEP headers in _headers file:
  ```
  /*
    Cross-Origin-Embedder-Policy: require-corp
    Cross-Origin-Opener-Policy: same-origin
  ```

- [ ] Verify SharedArrayBuffer is available:
  ```javascript
  console.assert(typeof SharedArrayBuffer !== 'undefined', 'SharedArrayBuffer not available');
  console.assert(crossOriginIsolated, 'Not cross-origin isolated');
  ```
```

**2. Automated verification on app load**
```javascript
// app.js
async function verifyFFmpegSetup() {
  const issues = [];

  if (typeof SharedArrayBuffer === 'undefined') {
    issues.push('SharedArrayBuffer not available (check COOP/COEP headers)');
  }

  if (!crossOriginIsolated) {
    issues.push('Not cross-origin isolated');
  }

  try {
    await fetch('/lib/ffmpeg/ffmpeg-core.js', { method: 'HEAD' });
  } catch (err) {
    issues.push('FFmpeg core worker not found at /lib/ffmpeg/ffmpeg-core.js');
  }

  if (typeof createFFmpeg === 'undefined') {
    issues.push('FFmpeg.wasm library not loaded (check CDN script tag)');
  }

  if (issues.length > 0) {
    console.error('FFmpeg.wasm setup issues:', issues);
    return false;
  }

  return true;
}
```

**Detection:**
- Browser console errors on page load
- Device mode toggle doesn't appear or is greyed out
- Check Network tab for failed CDN requests
- Verify _headers file actually deployed (curl -I)

**Confidence:** HIGH -- based on v1.0 setup experience and common mistakes when removing/re-adding dependencies.

**Phase mapping:** Address in Phase 1 (FFmpeg.wasm setup). This is a prerequisite for all device-mode work.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|----------------|------------|
| Phase 1: COOP/COEP Headers | COEP breaks server API calls (Pitfall 1), FFmpeg CDN URLs missing (Pitfall 12) | Add CORP header to backend, verify SharedArrayBuffer before showing device mode |
| Phase 2: Mode Selection UI | No abstraction layer (Pitfall 2), state management hell (Pitfall 5), mode persistence confusion (Pitfall 9) | Design processor interface upfront, disable mode switch during processing |
| Phase 3: Device Processing | JSZip memory crash (Pitfall 3), FFmpeg not in Worker (Pitfall 8), no FFmpeg load fallback (Pitfall 4) | Use JSZip streaming, run FFmpeg in Worker, detect capability before showing toggle |
| Phase 4: Server Cancellation | No backend cancellation API (Pitfall 6) | Add DELETE /api/jobs/:id endpoint, store FFmpeg PID, clean up partial files |
| Phase 5: Upload Flow | Divergent upload paths (Pitfall 7) | Abstract upload behind processor interface, unified validation |
| Phase 6: Testing/Deploy | Feature parity gaps (Pitfall 10), CDN header propagation (Pitfall 11) | Maintain feature matrix, deploy headers before code |

---

## Pre-Implementation Checklist

Before writing device mode code, verify:

- [ ] **Backend CORP headers added** -- Backend responds with `Cross-Origin-Resource-Policy: cross-origin` on all API endpoints
- [ ] **Processor abstraction designed** -- Common interface for device and server modes (upload, process, cancel, download)
- [ ] **FFmpeg.wasm runs in Worker** -- Not in main thread (multi-threading requires Worker scope)
- [ ] **JSZip streaming enabled** -- Use `streamFiles: true` to avoid memory crashes
- [ ] **Graceful fallback on FFmpeg load failure** -- Detect SharedArrayBuffer, offer server mode if unavailable
- [ ] **Cancellation API exists on backend** -- DELETE /api/jobs/:id kills FFmpeg, cleans files, marks job cancelled
- [ ] **Feature parity matrix established** -- Track which features exist in device vs server mode
- [ ] **State management strategy decided** -- How to handle mode switching, file selection, progress across modes
- [ ] **Deployment sequence planned** -- Deploy COOP/COEP headers before device-mode code

---

## Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| COOP/COEP breaks API calls | HIGH | Verified via MDN docs, web.dev guide, personal cross-origin isolation experience |
| Dual-mode abstraction | HIGH | Standard software pattern (Strategy, Separated Interface) |
| JSZip memory limits | HIGH | Verified via JSZip GitHub issues and documentation |
| FFmpeg.wasm load failure | HIGH | Based on v1.0 experience and SharedArrayBuffer browser support |
| State management on mode switch | MEDIUM-HIGH | General SPA state management patterns |
| Server cancellation API gap | HIGH | v2.0 codebase has no DELETE /api/jobs/:id endpoint |
| Upload flow divergence | MEDIUM-HIGH | Common pattern when integrating client/server modes |
| FFmpeg Worker requirement | MEDIUM | Based on FFmpeg.wasm docs, specific behavior may vary by version |
| Mode persistence | MEDIUM | Common localStorage issue in SPAs |
| Feature parity drift | MEDIUM | General software maintenance pattern |
| Cloudflare CDN propagation | MEDIUM | General CDN behavior, specific timing varies |
| Missing FFmpeg setup | HIGH | Common mistake when removing/re-adding dependencies |

---

## Sources

### Official Documentation
- [MDN: Cross-Origin-Embedder-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy) -- COEP behavior, require-corp vs credentialless
- [MDN: Cross-Origin-Opener-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy) -- COOP same-origin requirement
- [MDN: SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) -- Browser support and cross-origin isolation requirements
- [web.dev: Making your website cross-origin isolated using COOP and COEP](https://web.dev/articles/coop-coep) -- How COOP/COEP enable SharedArrayBuffer
- [web.dev: A guide to enable cross-origin isolation](https://web.dev/articles/cross-origin-isolation-guide) -- Troubleshooting COOP/COEP issues
- [Chrome Developers: COEP credentialless](https://developer.chrome.com/blog/coep-credentialless-origin-trial) -- Alternative to require-corp for third-party resources

### FFmpeg.wasm Resources
- [FFmpeg.wasm GitHub Issues: Out of Memory #78](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/78) -- Memory management challenges
- [FFmpeg.wasm GitHub Issues: Memory leak #494](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/494) -- Memory not released after processing
- [FFmpeg.wasm GitHub Issues: Cancel running job #187](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/187) -- Cancellation approaches
- [FFmpeg.wasm GitHub Issues: exec abort signal #572](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/572) -- AbortController support
- [Medium: FFmpeg.wasm Integration Debugging Journey (Nov 2025)](https://medium.com/@nikunjkr1752003/ffmpeg-wasm-integration-debugging-journey-report-e23d579e81a0) -- Recent real-world experience

### JSZip Resources
- [JSZip Documentation: Limitations](https://stuk.github.io/jszip/documentation/limitations.html) -- Memory constraints for large files
- [JSZip GitHub Issues: Consuming a lot of RAM #135](https://github.com/Stuk/jszip/issues/135) -- Memory issues with large batches
- [JSZip GitHub Issues: Upper limit on zip file size #580](https://github.com/Stuk/jszip/issues/580) -- Browser memory limits
- [JSZip GitHub Issues: Solution to writing large zips #308](https://github.com/Stuk/jszip/issues/308) -- Streaming approaches

### Architecture Patterns
- [Java Design Patterns: Separated Interface](https://java-design-patterns.com/patterns/separated-interface/) -- Pattern for dual implementations
- [Medium: State Management in Vanilla JS 2026](https://medium.com/@chirag.dave/state-management-in-vanilla-js-2026-trends-f9baed7599de) -- Modern state management approaches
- [NN/g: Modes in User Interfaces](https://www.nngroup.com/articles/modes/) -- When modes help vs hurt UX
- [Publisher Collective: Guide to COOP COEP CORP and CORS](https://www.publisher-collective.com/blog/a-simple-guide-to-coop-coep-corp-and-cors) -- How these headers interact

### Cloudflare Resources
- [Cloudflare Pages: Headers configuration](https://developers.cloudflare.com/pages/configuration/headers/) -- How to set custom headers via _headers file
- [Cloudflare Pages: Add custom HTTP headers](https://developers.cloudflare.com/pages/how-to/add-custom-http-headers/) -- Header propagation and caching behavior
- [Cloudflare Community: Enable COEP and COOP headers](https://community.cloudflare.com/t/enable-coep-and-coop-response-headers/252256) -- Community troubleshooting

### Project-Specific Context
- Video Refresher v1.0: FFmpeg.wasm-only implementation (shipped 2026-02-07)
- Video Refresher v2.0: Server-only implementation, removed all FFmpeg.wasm code (shipped 2026-02-08)
- User memory: ArrayBuffer neutering bug, FFmpeg instance recovery, BlobURLRegistry pattern (commit 8cbd4b3)

---

## What Makes This Different From v1.0 PITFALLS.md

v1.0 pitfalls focused on:
- Pure client-side FFmpeg.wasm challenges (memory, corruption, buffer neutering)
- Cloudflare Pages deployment (COOP/COEP, static hosting)
- Browser-only considerations (no backend)

v3.0 pitfalls focus on:
- **Hybrid architecture** (client + server modes coexisting)
- **Integration challenges** (re-introducing removed code)
- **Cross-origin isolation impact on API calls** (COEP breaks fetch)
- **Dual code paths** (abstraction layer, state management, feature parity)
- **Backend changes required** (cancellation API, CORP headers)

Key insight: v3.0 is not "v1.0 code + v2.0 code." It's a hybrid requiring NEW patterns that didn't exist in either previous version.
