# Phase 7: FFmpeg Processing Engine - Research

**Researched:** 2026-02-07
**Domain:** Server-side video processing with native FFmpeg via Node.js child_process.spawn
**Confidence:** HIGH

## Summary

Phase 7 requires porting the v1 client-side FFmpeg.wasm processing to server-side native FFmpeg execution. The v1 frontend uses FFmpeg.wasm 0.12.x with specific filter combinations (rotate, eq for brightness/contrast/saturation) to generate random video variations. These same effects must be replicated using native FFmpeg 5.1.8 (Debian bookworm) via child_process.spawn, with per-video progress tracking, fire-and-forget job processing, and graceful error handling.

The standard approach is to spawn FFmpeg as a child process, parse stderr output for progress information, and manage the process lifecycle (cleanup on completion, kill on cancellation, recover on server restart). better-sqlite3 with WAL mode provides sufficient concurrency for job queue updates from a single processing worker. The key challenges are: (1) stderr parsing for progress percentage, (2) preventing zombie/orphaned processes on crashes, (3) matching v1 filter parity across FFmpeg versions.

**Primary recommendation:** Use child_process.spawn with stdio pipes for FFmpeg, parse stderr line-by-line for progress updates, store FFmpeg pid in SQLite for recovery tracking, and implement graceful shutdown with SIGTERM propagation to child processes.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| child_process.spawn | Node.js stdlib | Spawn FFmpeg process with stdio pipes | Native Node.js API, no dependencies, full control over process lifecycle |
| better-sqlite3 | ^12.6.0 | Job queue state and progress tracking | Already in Phase 6, synchronous API prevents race conditions |
| node:fs | stdlib | File I/O for uploads/outputs on Fly Volume | Native API, required for /data volume operations |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ffprobe (CLI) | 5.1.8 | Extract video duration for progress calculation | Required before each encode to compute total duration |
| node:readline | stdlib | Line-by-line stderr parsing | FFmpeg outputs progress line-by-line to stderr |
| node:crypto | stdlib | Generate unique output filenames (randomBytes) | Already used in Phase 6 for tokens, same pattern applies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| child_process.spawn | fluent-ffmpeg | fluent-ffmpeg archived May 2025, decision v2.0-init-03 already made |
| Manual stderr parsing | kiss-ffmpeg or ffmpeg-progress-wrapper | Adds dependency, but kiss-ffmpeg provides structured progress events if manual parsing proves brittle |
| Synchronous queue | Bull/BullMQ (Redis) | Overkill for single-worker, adds Redis dependency vs. sqlite-only requirement PROC-03 |

**Installation:**
No additional npm packages required beyond Phase 6 dependencies. FFmpeg 5.1.8 already installed in Dockerfile.

## Architecture Patterns

### Recommended Project Structure
```
server/
├── lib/
│   ├── ffmpeg.js          # FFmpeg spawn wrapper, progress parsing
│   ├── processor.js       # Video processing orchestration per file
│   └── queue.js           # Job queue worker, polls SQLite for queued jobs
├── routes/
│   └── jobs.js            # Existing jobs API (Phase 6), no changes needed
└── index.js               # Existing server entry (Phase 6), add queue.start() call
```

### Pattern 1: FFmpeg Spawn with Progress Parsing

**What:** Spawn FFmpeg with stdio: 'pipe', parse stderr line-by-line for progress updates, extract time/duration to calculate percentage.

**When to use:** Every video encoding operation that requires progress feedback.

**Example:**
```javascript
// Source: https://github.com/hokiedsp/node-kiss-ffmpeg (pattern adapted)
// Source: https://ottverse.com/adjust-brightness-and-contrast-using-ffmpeg/
// Source: https://ffmpeg-graph.site/filters/rotate/

import { spawn } from 'node:child_process';
import readline from 'node:readline';

function spawnFFmpeg(inputPath, outputPath, filters, onProgress) {
  const args = [
    '-i', inputPath,
    '-vf', filters,
    '-r', '29.97',
    '-b:v', '2000k',
    '-bufsize', '4000k',
    '-maxrate', '2500k',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-threads', '4',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-map_metadata', '-1',
    '-y', // overwrite output
    outputPath
  ];

  const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  // Parse stderr line-by-line for progress
  const rl = readline.createInterface({ input: ffmpeg.stderr });
  rl.on('line', (line) => {
    // Example line: "frame= 4852 fps= 30 q=6.8 size= 30506kB time=00:02:41.74 bitrate=1545.1kbits/s speed= 1x"
    const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
    if (timeMatch) {
      const [, h, m, s] = timeMatch;
      const currentSeconds = parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
      onProgress(currentSeconds);
    }
  });

  return new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
    ffmpeg.on('error', reject);
  });
}
```

### Pattern 2: Duration Extraction with ffprobe

**What:** Use ffprobe -v quiet -print_format json -show_format to extract video duration before encoding.

**When to use:** Before processing each video to compute progress percentage.

**Example:**
```javascript
// Source: https://github.com/eugeneware/ffprobe (pattern adapted)
import { spawn } from 'node:child_process';

async function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath
    ]);

    let output = '';
    ffprobe.stdout.on('data', (chunk) => { output += chunk; });
    ffprobe.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited with code ${code}`));
      try {
        const data = JSON.parse(output);
        resolve(parseFloat(data.format.duration));
      } catch (err) {
        reject(err);
      }
    });
  });
}
```

### Pattern 3: Job Queue Worker with SQLite Polling

**What:** Single-threaded worker that polls SQLite for queued jobs, processes one job at a time, updates status/progress.

**When to use:** Fire-and-forget job processing (PROC-05), survives server restarts.

**Example:**
```javascript
// Source: https://github.com/damoclark/node-persistent-queue (pattern inspired)
// Source: Phase 6 queries.js (existing structure)

class JobQueueWorker {
  constructor(db, queries) {
    this.db = db;
    this.queries = queries;
    this.isRunning = false;
    this.currentFFmpegProcess = null;
  }

  async start() {
    this.isRunning = true;
    this.poll();
  }

  async stop() {
    this.isRunning = false;
    if (this.currentFFmpegProcess) {
      this.currentFFmpegProcess.kill('SIGTERM'); // graceful
      await new Promise(r => setTimeout(r, 2000)); // wait 2s
      if (this.currentFFmpegProcess && !this.currentFFmpegProcess.killed) {
        this.currentFFmpegProcess.kill('SIGKILL'); // force
      }
    }
  }

  async poll() {
    if (!this.isRunning) return;

    try {
      const nextJob = this.db.prepare(
        `SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`
      ).get();

      if (nextJob) {
        await this.processJob(nextJob);
      }
    } catch (err) {
      console.error('Job poll error:', err);
    }

    // Poll every 2 seconds
    setTimeout(() => this.poll(), 2000);
  }

  async processJob(job) {
    // Update status to 'processing'
    this.db.prepare(`UPDATE jobs SET status = 'processing', updated_at = datetime('now') WHERE id = ?`).run(job.id);

    const files = this.queries.getJobFiles(job.id).all();

    for (const file of files) {
      try {
        await this.processFile(job, file);
      } catch (err) {
        console.error(`File ${file.id} failed:`, err);
        this.db.prepare(`UPDATE job_files SET status = 'failed' WHERE id = ?`).run(file.id);
      }
    }

    // Mark job complete
    this.db.prepare(`UPDATE jobs SET status = 'completed', updated_at = datetime('now') WHERE id = ?`).run(job.id);
  }

  async processFile(job, file) {
    // Processing logic with FFmpeg spawn (Pattern 1)
  }
}
```

### Pattern 4: Graceful Shutdown with SIGTERM

**What:** Listen for SIGTERM/SIGINT, stop accepting new work, wait for current FFmpeg to finish, then exit.

**When to use:** Required for PROC-06 (job recovery on restart), prevents zombie processes.

**Example:**
```javascript
// Source: https://dev.to/yusadolat/nodejs-graceful-shutdown-a-beginners-guide-40b6
// Source: https://blog.risingstack.com/graceful-shutdown-node-js-kubernetes/

const worker = new JobQueueWorker(db, queries);

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await worker.stop();
  db.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await worker.stop();
  db.close();
  process.exit(0);
});

worker.start();
```

### Anti-Patterns to Avoid

- **Fire-and-forget spawn without tracking pid:** FFmpeg processes become orphaned on crash. Always store pid in SQLite for recovery.
- **Synchronous file operations in async loop:** Use fs.promises or async/await with fs operations to avoid blocking event loop during multi-file processing.
- **Missing stderr listener:** FFmpeg writes progress to stderr, not stdout. Ignoring stderr loses all progress information.
- **Hardcoded filter values:** v1 generates random effects per variation. Server must replicate randomness, not use fixed filters.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Progress parsing regex | Custom line parser with brittle regex | kiss-ffmpeg or ffmpeg-progress-stream if manual parsing fails | FFmpeg output format varies by version, edge cases abound |
| Process group cleanup | Manual child.kill() calls | Detached spawn with negative pgid kill (Linux) | Ensures all child processes die, not just direct child |
| Job retry logic | Custom backoff/retry state machine | Mark as 'failed' in SQLite, expose retry endpoint for manual trigger | Automatic retries can cascade failures, manual is safer for v2.0 |
| Duration caching | In-memory Map or Redis | Store duration in job_files table on first probe | SQLite persists across restarts, no memory leak risk |

**Key insight:** FFmpeg process management has many edge cases (signals, orphans, stderr buffering). Use proven patterns from established libraries even if not using the library itself.

## Common Pitfalls

### Pitfall 1: FFmpeg Stderr Buffering Delays Progress

**What goes wrong:** Progress updates arrive in large chunks after 10-20 seconds instead of real-time line-by-line updates.

**Why it happens:** Node.js buffers child process stderr by default. If FFmpeg writes slowly or in small chunks, readline won't trigger until buffer threshold reached.

**How to avoid:** Set `stdio: ['ignore', 'pipe', 'pipe']` on spawn (not 'inherit'), and use readline.createInterface on stderr stream. Test with small video to verify line-by-line updates.

**Warning signs:** Progress jumps from 0% to 50% instantly instead of incrementing smoothly.

### Pitfall 2: Zombie FFmpeg Processes After Node Crash

**What goes wrong:** Server crashes (OOM, unhandled rejection) leave FFmpeg processes running indefinitely, consuming CPU and disk I/O.

**Why it happens:** child_process.spawn doesn't auto-kill children when parent exits unless explicitly configured.

**How to avoid:**
1. Store FFmpeg pid in SQLite when spawn starts
2. On server startup, check for orphaned pids (kill -0 to test if alive, SIGKILL if found)
3. Use detached: true with process.kill(-pid) to kill process group
4. Implement SIGTERM handler that kills current FFmpeg before exit (Pattern 4)

**Warning signs:** `ps aux | grep ffmpeg` shows processes after server restart, high CPU usage with no active jobs.

### Pitfall 3: FFmpeg Version Filter Incompatibility

**What goes wrong:** Filters that work in FFmpeg.wasm 0.12.x (based on FFmpeg 5-6.x) fail on native FFmpeg 5.1.8 with "Unrecognized option" or silent failures.

**Why it happens:** FFmpeg.wasm may compile with different filter sets or use different default options than Debian package.

**How to avoid:**
1. Test exact v1 filter string on deployed FFmpeg: `ssh fly.io "ffmpeg -version"` and `ffmpeg -filters | grep rotate`
2. Use ffmpeg -h filter=rotate to check exact syntax for deployed version
3. Keep filters simple: rotate, eq (brightness/contrast/saturation) are stable since FFmpeg 4.x
4. Avoid advanced filters (e.g., chromakey, perspective) unless verified on target FFmpeg

**Warning signs:** FFmpeg exits with code 1, stderr contains "Option not found" or "Invalid filter".

### Pitfall 4: Progress Calculation Off by One or Negative

**What goes wrong:** Progress percentage shows 101%, -5%, or NaN during encoding.

**Why it happens:**
- ffprobe duration vs. actual encode duration differ (metadata rounding)
- Stderr time parsing fails on edge formats (00:00:00.00 vs 00:00:00)
- Division by zero if duration is null/0

**How to avoid:**
1. Clamp progress to 0-100 range: `Math.max(0, Math.min(100, (current / total) * 100))`
2. Default duration to 1 if ffprobe fails (prevents divide-by-zero)
3. Parse time with robust regex: `/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/` and validate each group
4. Store raw progress_seconds in SQLite, compute percentage in API response (easier debugging)

**Warning signs:** Job status shows progress: 105 or progress: null.

### Pitfall 5: File Descriptor Leaks from Unclosed Streams

**What goes wrong:** After processing 20-30 videos, server runs out of file descriptors (EMFILE error).

**Why it happens:** readline.createInterface doesn't auto-close, stderr pipe remains open even after FFmpeg exits.

**How to avoid:**
1. Call `rl.close()` in ffmpeg 'close' event handler
2. Use try/finally to ensure cleanup: `try { await spawnFFmpeg() } finally { rl.close() }`
3. Monitor open FDs: `ls -l /proc/<pid>/fd | wc -l` during load test
4. Set higher ulimit if needed: `ulimit -n 4096` in Dockerfile CMD

**Warning signs:** EMFILE error after processing multiple videos, `lsof` shows many open stderr pipes.

## Code Examples

Verified patterns from official sources:

### Example 1: Complete Video Processing Function

```javascript
// Combines Patterns 1 and 2
// Sources:
// - https://ffmpeg-graph.site/filters/rotate/ (rotate syntax)
// - https://ayosec.github.io/ffmpeg-filters-docs/7.1/Filters/Video/eq.html (eq syntax)
// - https://github.com/eugeneware/ffprobe (duration extraction)

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import crypto from 'node:crypto';
import path from 'node:path';

async function processVideoVariation(inputPath, outputDir, variationIndex, effects) {
  // Extract duration for progress calculation
  const duration = await getVideoDuration(inputPath);

  // Generate unique output filename
  const uniqueId = crypto.randomBytes(3).toString('hex');
  const baseName = path.basename(inputPath, '.mp4');
  const outputPath = path.join(outputDir, `${baseName}_var${variationIndex}_${uniqueId}.mp4`);

  // Build filter string (matching v1 logic)
  const filterParts = [];

  // Rotate filter (radians, not degrees)
  filterParts.push(`rotate=${effects.rotation}:fillcolor=black@0`);

  // EQ filter (brightness, contrast, saturation)
  filterParts.push(`eq=brightness=${effects.brightness}:contrast=${effects.contrast}:saturation=${effects.saturation}`);

  const filters = filterParts.join(',');

  // Spawn FFmpeg with exact v1 encoding settings
  const args = [
    '-i', inputPath,
    '-vf', filters,
    '-r', '29.97',
    '-b:v', '2000k',
    '-bufsize', '4000k',
    '-maxrate', '2500k',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-threads', '4',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-map_metadata', '-1',
    '-y',
    outputPath
  ];

  const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const rl = readline.createInterface({ input: ffmpeg.stderr });

  let lastProgressPercent = 0;

  rl.on('line', (line) => {
    const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
    if (timeMatch && duration > 0) {
      const [, h, m, s] = timeMatch;
      const currentSeconds = parseInt(h) * 3600 + parseInt(m) * 60 + parseFloat(s);
      const progressPercent = Math.max(0, Math.min(100, Math.round((currentSeconds / duration) * 100)));

      if (progressPercent !== lastProgressPercent) {
        lastProgressPercent = progressPercent;
        // Update progress in SQLite here
        console.log(`Progress: ${progressPercent}%`);
      }
    }
  });

  return new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      rl.close(); // CRITICAL: prevent FD leak
      if (code === 0) resolve({ outputPath, size: fs.statSync(outputPath).size });
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
    ffmpeg.on('error', (err) => {
      rl.close();
      reject(err);
    });
  });
}
```

### Example 2: Random Effects Generation (Port from v1)

```javascript
// Source: v1 app.js lines 499-533
// Generates unique effect combinations matching v1 behavior

function randomInRange(min, max) {
  return min + Math.random() * (max - min);
}

function generateUniqueEffects(count) {
  const effects = [];
  const seen = new Set();
  const maxAttempts = count * 100;
  let attempts = 0;

  while (effects.length < count && attempts < maxAttempts) {
    attempts++;

    // Match v1 ranges exactly
    const effect = {
      rotation: parseFloat(randomInRange(0.001, 0.01).toFixed(4)), // radians
      brightness: parseFloat(randomInRange(-0.05, 0.05).toFixed(4)),
      contrast: parseFloat(randomInRange(0.95, 1.05).toFixed(4)),
      saturation: parseFloat(randomInRange(0.95, 1.05).toFixed(4))
    };

    const key = JSON.stringify(effect);
    if (!seen.has(key)) {
      seen.add(key);
      effects.push(effect);
    }
  }

  if (effects.length < count) {
    throw new Error(`Unable to generate ${count} unique effect combinations`);
  }

  return effects;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| fluent-ffmpeg library | Direct child_process.spawn | May 2025 (archived) | Must implement own progress parsing, error handling |
| FFmpeg.wasm in browser | Native FFmpeg on server | v2.0 design | 10-20x faster encoding, no 100MB file size limit |
| Synchronous better-sqlite3 | Still synchronous + WAL | Stable since 2018 | WAL mode critical for concurrent reads during writes (decision 06-01-wal) |
| /tmp for uploads | Fly Volume (/data/) | v2.0 design | Fly.io /tmp is RAM disk, exhausts memory (decision v2.0-init-05) |

**Deprecated/outdated:**
- fluent-ffmpeg: Archived May 2025, no longer maintained
- ffmpeg@0.x npm package: Last updated 2017, doesn't work with modern FFmpeg
- Using 'inherit' for stdio: Prevents progress parsing, use 'pipe' instead

## Open Questions

1. **FFmpeg 5.1.8 vs 5-6.x filter parity**
   - What we know: Debian bookworm ships FFmpeg 5.1.8, v1 uses FFmpeg.wasm based on 5-6.x
   - What's unclear: Whether rotate and eq filters have identical syntax/behavior across these versions
   - Recommendation: Test exact filter string on deployed server during Phase 7 Task 1. If differences found, adjust filter syntax to match 5.1.8 capabilities.

2. **Optimal polling interval for job queue**
   - What we know: Pattern 3 uses 2-second polling, common in SQLite-backed queues
   - What's unclear: Whether 2s is too slow for "responsive" UX or too fast for server load
   - Recommendation: Start with 2s, adjust based on Phase 7 verification. If UX feels sluggish, reduce to 1s. If server shows high CPU from empty polls, increase to 5s.

3. **Process group cleanup on Linux vs. Docker**
   - What we know: Detached spawn with negative pgid works on Linux for killing process trees
   - What's unclear: Whether Fly.io Docker environment supports pgid-based kills or requires different approach
   - Recommendation: Implement both strategies: try process.kill(-pid) first, fallback to direct pid kill. Test during Phase 7 deployment verification.

## Sources

### Primary (HIGH confidence)
- Node.js child_process documentation - https://nodejs.org/api/child_process.html (spawn, stdio options)
- FFmpeg official filters documentation - https://ffmpeg.org/ffmpeg-filters.html (rotate, eq syntax)
- better-sqlite3 GitHub - https://github.com/WiseLibs/better-sqlite3 (WAL mode, prepared statements)
- FFmpeg rotate filter reference - https://ffmpeg-graph.site/filters/rotate/ (angle, fillcolor params)
- FFmpeg eq filter reference - https://ayosec.github.io/ffmpeg-filters-docs/7.1/Filters/Video/eq.html (brightness, contrast, saturation ranges)

### Secondary (MEDIUM confidence)
- kiss-ffmpeg npm - https://www.npmjs.com/package/kiss-ffmpeg (progress event pattern)
- ffprobe npm - https://github.com/eugeneware/ffprobe (JSON output parsing)
- Graceful shutdown guide - https://dev.to/yusadolat/nodejs-graceful-shutdown-a-beginners-guide-40b6 (SIGTERM handling)
- SQLite concurrency patterns - https://blog.skypilot.co/abusing-sqlite-to-handle-concurrency/ (WAL benefits)
- Stream video processing with Node.js and FFmpeg - https://transloadit.com/devtips/stream-video-processing-with-node-js-and-ffmpeg/ (memory optimization)

### Tertiary (LOW confidence)
- Various Stack Overflow and GitHub issues on FFmpeg progress parsing (informative but not authoritative)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - child_process and better-sqlite3 are stable stdlib/dependencies already in use
- Architecture: HIGH - Patterns verified against official docs and established libraries
- Pitfalls: MEDIUM - Based on community reports and common issues, requires validation in Phase 7

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (30 days - stable domain, FFmpeg and Node.js APIs unlikely to change)
