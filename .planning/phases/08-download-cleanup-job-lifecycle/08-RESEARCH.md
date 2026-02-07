# Phase 8: Download, Cleanup, and Job Lifecycle - Research

**Researched:** 2026-02-07
**Domain:** Streaming ZIP downloads, storage management, periodic cleanup daemons
**Confidence:** HIGH

## Summary

This phase completes the backend lifecycle: download processed videos as a streaming ZIP, delete upload files after processing, auto-expire jobs after 24 hours, and evict oldest results when the 3GB volume fills up.

The codebase is well-positioned for this phase. The database schema already has `expires_at` on jobs (set to `datetime('now', '+24 hours')` at insert time), `ON DELETE CASCADE` on all child tables, and `PRAGMA foreign_keys = ON` in the database initialization. The output directory structure (`/data/output/{jobId}/`) maps cleanly to ZIP folder organization by source video.

The standard approach uses the `archiver` library (v7.0.1, ~18M weekly downloads) with `store: true` for STORE compression, Node.js native `fs.statfsSync()` for disk usage checks (available since Node 18.15, stable in Node 22), and a simple `setInterval`-based cleanup daemon (no cron library needed for this use case).

**Primary recommendation:** Use `archiver` with `{ store: true }` for streaming ZIP to HTTP response, `fs.statfsSync('/data')` for disk monitoring, and a `setInterval` cleanup loop running every 5 minutes.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| archiver | ^7.0.1 | Streaming ZIP archive creation | 18M+ weekly downloads, streaming API, supports STORE method, pipe to HTTP response |
| fs.statfsSync | Node 22 built-in | Disk usage monitoring | Native -- no dependency needed; returns bavail, bfree, blocks, bsize |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:fs | Node 22 built-in | File deletion (rm, rmdir) | Upload cleanup, output directory deletion |
| node:path | Node 22 built-in | Path manipulation | Building ZIP entry paths from output_files |
| node:timers | Node 22 built-in | setInterval for cleanup daemon | Periodic cleanup every N minutes |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| archiver | yazl | yazl is lower-level, more manual; archiver wraps it with nicer API |
| archiver | JSZip | JSZip loads into memory (not streaming) -- unacceptable for video files |
| fs.statfsSync | check-disk-space | External dependency for something Node 22 does natively |
| setInterval | node-cron | Overkill for a single periodic task; adds dependency |

**Installation:**
```bash
npm install archiver
```

## Architecture Patterns

### Recommended File Structure
```
server/
├── lib/
│   ├── cleanup.js         # Cleanup daemon (expire + evict)
│   └── storage.js          # Disk usage helpers (getUsage, checkCapacity)
├── routes/
│   └── jobs.js             # Add GET /:id/download endpoint
```

### Pattern 1: Streaming ZIP to HTTP Response
**What:** Pipe archiver directly to Express response -- no temp file on disk.
**When to use:** Always for the download endpoint.
**Example:**
```javascript
// Source: https://www.archiverjs.com/docs/archiver/ + verified pattern
import archiver from 'archiver';

router.get('/:id/download', requireAuth, (req, res) => {
  const job = queries.getJob.get(req.params.id);
  if (!job || job.status !== 'completed') {
    return res.status(404).json({ error: 'Job not found or not ready' });
  }

  // Check expiry
  if (new Date(job.expires_at + 'Z') < new Date()) {
    return res.status(410).json({ error: 'Job expired' });
  }

  const outputFiles = queries.getOutputFiles.all(job.id);
  const jobFiles = queries.getJobFiles.all(job.id);

  // Build lookup: job_file_id -> original_name (without extension)
  const nameMap = new Map();
  for (const jf of jobFiles) {
    const baseName = jf.original_name.replace(/\.mp4$/i, '');
    nameMap.set(jf.id, baseName);
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="job-${job.id}.zip"`);

  const archive = archiver('zip', { store: true });

  archive.on('error', (err) => {
    console.error('Archive error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Archive failed' });
    }
  });

  archive.pipe(res);

  // Add files organized by source video name
  for (const out of outputFiles) {
    const folderName = nameMap.get(out.job_file_id) || 'unknown';
    const fileName = path.basename(out.output_path);
    archive.file(out.output_path, { name: `${folderName}/${fileName}` });
  }

  archive.finalize();
});
```

### Pattern 2: Cleanup Daemon with setInterval
**What:** Periodic loop that enforces time-based expiry and storage-cap eviction.
**When to use:** Start on server boot alongside the queue worker.
**Example:**
```javascript
// Source: Node.js timers docs + fs.statfsSync docs
import fs from 'node:fs';
import path from 'node:path';

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const EXPIRY_HOURS = 24;
const VOLUME_CAP_BYTES = 3 * 1024 * 1024 * 1024; // 3GB
const EVICTION_THRESHOLD = 0.85; // Start evicting at 85% usage

export class CleanupDaemon {
  constructor(db, queries, dataDir) {
    this.db = db;
    this.queries = queries;
    this.dataDir = dataDir;
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.run(), CLEANUP_INTERVAL_MS);
    this.timer.unref(); // Don't block process exit
    console.log('Cleanup daemon started');
    // Run once immediately on startup
    this.run();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  run() {
    try {
      this.expireOldJobs();
      this.evictIfNeeded();
    } catch (err) {
      console.error('Cleanup daemon error:', err.message);
    }
  }

  expireOldJobs() {
    // Find expired jobs
    const expired = this.queries.getExpiredJobs.all();
    for (const job of expired) {
      this.deleteJobFiles(job.id);
      this.queries.deleteJob.run(job.id);
      console.log(`Expired job ${job.id}`);
    }
  }

  evictIfNeeded() {
    const stats = fs.statfsSync(this.dataDir);
    const usedBytes = (stats.blocks - stats.bfree) * stats.bsize;
    const totalBytes = stats.blocks * stats.bsize;
    const usageRatio = usedBytes / totalBytes;

    if (usageRatio > EVICTION_THRESHOLD) {
      // Evict oldest completed jobs until below threshold
      const candidates = this.queries.getEvictionCandidates.all();
      for (const job of candidates) {
        this.deleteJobFiles(job.id);
        this.queries.deleteJob.run(job.id);
        console.log(`Evicted job ${job.id} (storage pressure)`);

        // Recheck
        const newStats = fs.statfsSync(this.dataDir);
        const newUsed = (newStats.blocks - newStats.bfree) * newStats.bsize;
        if (newUsed / totalBytes < EVICTION_THRESHOLD) break;
      }
    }
  }

  deleteJobFiles(jobId) {
    const outputDir = path.join(this.dataDir, 'output', jobId);
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}
```

### Pattern 3: Upload Cleanup After Processing
**What:** Delete upload source files immediately after processing completes, not after 24h.
**When to use:** At the end of `processJob()` in processor.js.
**Example:**
```javascript
// In processor.js, after all files processed:
for (const file of files) {
  try {
    fs.unlinkSync(file.upload_path);
  } catch (err) {
    // Log but don't fail the job -- upload deletion is best-effort
    console.error(`Failed to delete upload ${file.upload_path}:`, err.message);
  }
}
```

### Anti-Patterns to Avoid
- **Buffering ZIP in memory:** Never use JSZip or adm-zip for video files -- they load everything into memory. Always stream with archiver.
- **Using zlib level 0 instead of store:** `{ zlib: { level: 0 } }` does NOT produce STORE-method ZIPs. It still wraps in DEFLATE headers. Use `{ store: true }` specifically.
- **Blocking cleanup on downloads:** The cleanup daemon should skip jobs that are currently being downloaded. Check if the job is mid-stream before deleting.
- **Deleting DB rows before files:** Always delete files from disk first, then DB rows. If the process crashes between the two, orphan files are safer than orphan DB references.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ZIP creation | Manual ZIP binary format | archiver with `{ store: true }` | ZIP format has many edge cases (ZIP64, path encoding, CRC checksums) |
| Disk usage | Spawning `df` and parsing output | `fs.statfsSync(path)` | Native Node.js API since v18.15, no parsing needed |
| Content-Disposition header | Manual string construction | Use template literal with proper escaping | RFC 6266 compliance for filenames with special chars |

**Key insight:** The archiver library handles streaming, backpressure, ZIP64 (for files >4GB), and CRC32 checksums automatically. Hand-rolling any of this is a multi-week mistake.

## Common Pitfalls

### Pitfall 1: Race Between Download and Cleanup
**What goes wrong:** Cleanup daemon deletes job files while a download is in-flight, causing a broken ZIP stream.
**Why it happens:** The cleanup daemon and download route operate independently.
**How to avoid:** Two strategies (pick one):
1. Check `expires_at` at the start of download -- if the job has <5 minutes left, still serve it but the daemon won't delete mid-stream because the daemon interval (5 min) provides a natural buffer.
2. Track active downloads with a counter and skip deletion of jobs with active downloads.
**Warning signs:** Truncated ZIP files, archiver 'error' events in logs.

### Pitfall 2: fs.statfsSync Returns Volume Stats, Not Directory Stats
**What goes wrong:** On a Fly Volume mounted at `/data`, `fs.statfsSync('/data')` returns the entire volume's usage, which includes the SQLite database, uploads, and output files -- not just output files.
**Why it happens:** statfs reports filesystem-level stats, not directory-level.
**How to avoid:** This is actually the correct behavior for STOR-02. The volume IS the constraint. When checking capacity, compare against the full volume, not a subdirectory.
**Warning signs:** N/A -- this is the expected behavior.

### Pitfall 3: SQLite Foreign Key Cascade Requires PRAGMA
**What goes wrong:** Deleting a job row doesn't cascade-delete job_files and output_files rows.
**Why it happens:** SQLite disables foreign keys by default. `PRAGMA foreign_keys = ON` must be set per-connection.
**How to avoid:** Already handled -- `db/index.js` sets `db.pragma('foreign_keys = ON')`. Just verify this is still in place. The CASCADE will work correctly because the schema defines `ON DELETE CASCADE` on both `job_files.job_id` and `output_files.job_id`.
**Warning signs:** Orphan rows accumulating in job_files/output_files tables.

### Pitfall 4: Archiver Finalize Must Be Called
**What goes wrong:** The ZIP stream never ends; the HTTP response hangs.
**Why it happens:** Forgetting to call `archive.finalize()` after adding all files.
**How to avoid:** Always call `archive.finalize()` as the last step. It returns a Promise, but for piping to response, the 'end' event on the archive stream will close the response.
**Warning signs:** HTTP requests timing out, browser showing "downloading" indefinitely.

### Pitfall 5: Cleanup Should Not Delete Currently Processing Jobs
**What goes wrong:** A long-running processing job could be cleaned up by the daemon.
**Why it happens:** Eviction looks for "oldest completed jobs" but doesn't check processing status.
**How to avoid:** The eviction query must filter to `status IN ('completed', 'failed')` -- never evict 'queued' or 'processing' jobs.
**Warning signs:** Jobs disappearing mid-processing.

## Code Examples

### Disk Usage Check
```javascript
// Source: Node.js v22 fs.statfsSync docs
import fs from 'node:fs';

function getVolumeUsage(volumePath) {
  const stats = fs.statfsSync(volumePath);
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bavail * stats.bsize; // bavail = available to unprivileged users
  const usedBytes = totalBytes - freeBytes;
  return {
    totalBytes,
    freeBytes,
    usedBytes,
    usagePercent: Math.round((usedBytes / totalBytes) * 100)
  };
}
```

### New Queries Needed for Cleanup
```javascript
// Queries to add to db/queries.js

// Find expired jobs (past expires_at, completed or failed)
getExpiredJobs: db.prepare(`
  SELECT * FROM jobs
  WHERE expires_at < datetime('now')
    AND status IN ('completed', 'failed')
`),

// Find eviction candidates: oldest completed/failed jobs first
getEvictionCandidates: db.prepare(`
  SELECT * FROM jobs
  WHERE status IN ('completed', 'failed')
  ORDER BY updated_at ASC
`),

// Delete a job (CASCADE handles child tables)
deleteJob: db.prepare(`
  DELETE FROM jobs WHERE id = ?
`),

// Get total output size for a job
getJobOutputSize: db.prepare(`
  SELECT COALESCE(SUM(file_size), 0) as total_size
  FROM output_files WHERE job_id = ?
`)
```

### Streaming ZIP Download with Folder Organization
```javascript
// Source: archiver docs (https://www.archiverjs.com/docs/archiver/)
import archiver from 'archiver';
import path from 'node:path';

function streamJobAsZip(job, jobFiles, outputFiles, res) {
  const archive = archiver('zip', { store: true });

  // Build folder name lookup (source video name -> folder)
  const folderMap = new Map();
  for (const jf of jobFiles) {
    folderMap.set(jf.id, jf.original_name.replace(/\.mp4$/i, ''));
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition',
    `attachment; filename="video-refresher-${job.id}.zip"`);

  archive.on('error', (err) => {
    console.error(`Archive error for job ${job.id}:`, err);
    // Response may already be streaming -- destroy it
    res.destroy(err);
  });

  archive.on('warning', (warn) => {
    if (warn.code === 'ENOENT') {
      console.warn(`Archive warning: file not found`, warn);
    } else {
      console.warn(`Archive warning:`, warn);
    }
  });

  archive.pipe(res);

  for (const out of outputFiles) {
    const folder = folderMap.get(out.job_file_id) || 'unknown';
    const filename = path.basename(out.output_path);
    archive.file(out.output_path, {
      name: `${folder}/${filename}`
    });
  }

  archive.finalize();
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `diskusage` npm package for disk stats | `fs.statfsSync()` native API | Node 18.15 (Apr 2023) | No native dependency needed |
| archiver v5 with CommonJS | archiver v7.0.1 with ESM support | Mar 2024 | Works with `"type": "module"` |
| Manual cron-based cleanup | setInterval with .unref() | Always been the pattern for simple daemons | No cron library needed |
| `fs.rmdirSync({recursive})` | `fs.rmSync({recursive, force})` | Node 14.14 | Cleaner API, `force: true` ignores ENOENT |

**Deprecated/outdated:**
- `fs.rmdirSync` with `{ recursive: true }`: Deprecated since Node 16. Use `fs.rmSync()` instead.
- archiver `{ zlib: { level: 0 } }`: Does NOT produce STORE-method ZIPs. Use `{ store: true }`.

## Open Questions

1. **Content-Length header for ZIP downloads**
   - What we know: Since we're streaming, the total ZIP size isn't known upfront. We cannot set Content-Length.
   - What's unclear: Whether this matters for the client UI. Browsers will show "unknown" download size.
   - Recommendation: Omit Content-Length. Use chunked transfer encoding (Express default). The client can estimate size from the sum of `output_files.file_size` values (plus ~100 bytes ZIP overhead per file).

2. **Concurrent download limit**
   - What we know: Each download streams from disk, so memory usage is low. But disk I/O could be a concern on shared-CPU Fly machines.
   - What's unclear: Whether we need to limit concurrent downloads.
   - Recommendation: Don't limit initially. With <10 users and a small team, concurrency won't be an issue. Add rate limiting if needed later.

3. **Should cleanup delete 'queued' jobs older than 24h?**
   - What we know: A queued job stuck for 24h is likely an error (queue worker crashed). The expires_at is already set at job creation time.
   - What's unclear: Whether to treat this as "expired" or "failed".
   - Recommendation: Mark jobs stuck in 'queued' for >24h as 'failed' first, then allow normal expiry cleanup to handle them on the next cycle.

## Sources

### Primary (HIGH confidence)
- [Node.js v22 fs.statfsSync docs](https://nodejs.org/docs/v22.19.0/api/fs.html#fsstatfssyncpath-options) - Confirmed API signature, return fields (bavail, bfree, blocks, bsize), stable in Node 22
- [Archiver API docs](https://www.archiverjs.com/docs/archiver/) - Confirmed `{ store: true }` option, archive.file() name option, archive.pipe() streaming, error events
- Existing codebase `server/db/schema.js` - Confirmed ON DELETE CASCADE on job_files and output_files, expires_at column exists
- Existing codebase `server/db/index.js` - Confirmed `PRAGMA foreign_keys = ON` already set

### Secondary (MEDIUM confidence)
- [archiverjs/node-archiver GitHub](https://github.com/archiverjs/node-archiver) - Version 7.0.1, last release Mar 2024, 18M+ weekly downloads
- [archiver issue #33](https://github.com/archiverjs/node-archiver/issues/33) - Confirmed zlib level 0 is NOT the same as STORE; must use `{ store: true }`
- [Fly.io volumes docs](https://fly.io/docs/volumes/overview/) - Volume mounting, 3GB initial size, pricing
- [Node.js timers docs](https://nodejs.org/en/docs/guides/timers-in-node) - setInterval, unref() for background daemons

### Tertiary (LOW confidence)
- None -- all findings verified with primary or secondary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - archiver is the undisputed standard; fs.statfsSync is a native API
- Architecture: HIGH - Patterns derived directly from official docs and existing codebase structure
- Pitfalls: HIGH - Verified through GitHub issues (store vs level 0), SQLite docs (CASCADE + PRAGMA), and Node.js docs (statfs behavior)

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (30 days -- stable domain, no fast-moving APIs)
