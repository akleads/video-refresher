# Phase 12: Server Job Cancellation - Research

**Researched:** 2026-02-09
**Domain:** Node.js child process management, FFmpeg graceful termination, async job cancellation
**Confidence:** HIGH

## Summary

Server job cancellation requires coordinating three layers: (1) HTTP endpoint for cancel requests, (2) database status tracking with race condition handling, and (3) graceful FFmpeg process termination. The standard approach uses a three-stage escalation: stdin 'q' → SIGTERM → SIGKILL, with 2-second timeouts between stages. Node.js child_process provides all necessary primitives (kill(), stdin.write(), event handlers). SQLite in WAL mode handles concurrent status updates atomically. FFmpeg's stdin 'q' command triggers internal cleanup that SIGTERM doesn't guarantee, making it the preferred first attempt. Partial output files from interrupted variations must be cleaned up by checking file system state against database completion records.

**Primary recommendation:** Implement cancellation as a three-stage timeout escalation (stdin 'q' → 2s → SIGTERM → 2s → SIGKILL), track current FFmpeg PID in job_files.ffmpeg_pid column (already exists), add 'cancelled' status to jobs table, handle race condition where job completes before kill takes effect by checking final status.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js child_process | Built-in (Node 22) | Spawn FFmpeg, send signals, write to stdin | Native module, zero dependencies, complete process control |
| SQLite WAL mode | better-sqlite3 (already in use) | Atomic status updates with concurrent reads | Already configured, handles reader-writer concurrency |
| fs.unlink / fs.unlinkSync | Node.js built-in | Delete partial output files | Standard file cleanup API |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| readline | Node.js built-in | Parse FFmpeg stderr (already used in ffmpeg.js) | Already integrated for progress parsing |
| setTimeout | Node.js built-in | Implement escalation timeouts | Standard async delay mechanism |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Three-stage escalation | Immediate SIGKILL | Immediate SIGKILL loses FFmpeg cleanup (corrupted output), no chance for graceful exit |
| Database status flag | In-memory cancellation flag | In-memory flag lost on restart, can't survive crashes, no audit trail |
| Polling for cancelled status | EventEmitter across modules | Polling is simpler for existing architecture, avoids tight coupling |

**Installation:**
No new dependencies required — uses Node.js built-in modules only.

## Architecture Patterns

### Recommended Project Structure
```
server/
├── routes/
│   └── jobs.js          # Add DELETE /:id/cancel endpoint
├── lib/
│   ├── processor.js     # Poll for cancelled status during variation loop
│   ├── ffmpeg.js        # Add gracefulKill() function
│   └── queue.js         # Check for cancelled status before/during processJob
└── db/
    ├── schema.js        # Add cancelled_at column to jobs table
    └── queries.js       # Add getCancellableJob, updateJobCancelled queries
```

### Pattern 1: Three-Stage Process Termination
**What:** Escalate from gentle (stdin 'q') → moderate (SIGTERM) → forceful (SIGKILL) with timeouts
**When to use:** Any scenario where process cleanup matters (FFmpeg finalizing MP4 headers, flushing buffers)
**Example:**
```javascript
// Source: Node.js official docs + FFmpeg community patterns
async function gracefulKill(childProcess, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let terminated = false;

    // Stage 1: Try stdin 'q' (FFmpeg-specific cleanup)
    try {
      childProcess.stdin.write('q\n');
    } catch (err) {
      // stdin may be closed, continue to SIGTERM
    }

    const onExit = () => {
      if (!terminated) {
        terminated = true;
        clearTimeout(sigtermTimeout);
        clearTimeout(sigkillTimeout);
        resolve();
      }
    };

    childProcess.once('exit', onExit);

    // Stage 2: SIGTERM after timeout
    const sigtermTimeout = setTimeout(() => {
      if (!terminated) {
        childProcess.kill('SIGTERM');
      }
    }, timeoutMs);

    // Stage 3: SIGKILL after second timeout
    const sigkillTimeout = setTimeout(() => {
      if (!terminated) {
        childProcess.kill('SIGKILL');
        resolve(); // Force resolve after SIGKILL
      }
    }, timeoutMs * 2);
  });
}
```

### Pattern 2: Cancellation Polling During Processing
**What:** Check database cancellation flag between variations, not mid-variation
**When to use:** Long-running jobs with multiple sub-tasks (perfect fit for variations loop)
**Example:**
```javascript
// In processor.js processFile() variation loop
for (let i = 0; i < variationsPerVideo; i++) {
  // Check for cancellation BEFORE starting next variation
  const job = queries.getJob.get(jobId);
  if (job.status === 'cancelled') {
    console.log(`Job ${jobId} cancelled, stopping at variation ${i}`);
    break; // Exit loop, don't start next variation
  }

  // Process variation...
  const ffmpegResult = spawnFFmpeg(...);
  await ffmpegResult.promise;
}
```

### Pattern 3: Race Condition Handling (Completion Wins)
**What:** If job completes naturally before kill takes effect, mark as 'completed' not 'cancelled'
**When to use:** Any async cancellation where final state matters for UX
**Example:**
```javascript
// In cancellation endpoint
router.delete('/:id/cancel', requireAuth, async (req, res) => {
  const job = queries.getJob.get(req.params.id);

  // Only cancellable if queued or processing
  if (!['queued', 'processing'].includes(job.status)) {
    return res.status(400).json({ error: 'Job cannot be cancelled' });
  }

  // Set cancelled status FIRST
  queries.updateJobStatus.run('cancelled', job.id);
  queries.updateJobCancelledAt.run(job.id); // timestamp

  // Kill FFmpeg processes
  const files = queries.getJobFiles.all(job.id);
  for (const file of files) {
    if (file.ffmpeg_pid) {
      await gracefulKill(file.ffmpeg_pid);
    }
  }

  // Check final status (may have completed during kill)
  const finalJob = queries.getJob.get(job.id);
  res.json({ status: finalJob.status }); // Could be 'completed' if race won
});
```

### Pattern 4: Partial File Cleanup
**What:** Delete incomplete variation files, keep completed ones
**When to use:** After cancellation, before marking job as cancelled
**Example:**
```javascript
// After breaking from variation loop
const completedOutputs = queries.getOutputFilesByJobFile.all(file.id);
const completedPaths = new Set(completedOutputs.map(o => o.output_path));

// Scan job output directory
const jobOutputDir = path.join(outputDir, job.id);
if (fs.existsSync(jobOutputDir)) {
  const allFiles = fs.readdirSync(jobOutputDir);
  for (const filename of allFiles) {
    const fullPath = path.join(jobOutputDir, filename);
    if (!completedPaths.has(fullPath)) {
      // Partial file not in database, delete it
      fs.unlinkSync(fullPath);
    }
  }
}
```

### Anti-Patterns to Avoid
- **Killing process without checking current status:** Always verify job is still cancellable before kill attempt
- **Synchronous kill without timeout:** FFmpeg may hang, always use escalation with force-kill fallback
- **Deleting all outputs on cancel:** User decision specifies keeping completed variations
- **No cleanup of partial files:** Leaves orphaned files consuming storage quota

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Signal escalation timing | Custom Promise chains with nested setTimeout | Graceful kill function with timeout array | Edge cases: process already dead, PID reused, signal ignored |
| PID validity checking | Just kill(pid) and hope | Check process.kill(pid, 0) first | PID may have been reassigned to different process |
| Stdin write error handling | Assume stdin is always writable | Try-catch around stdin.write() | stdin may be closed if process died between check and write |
| Race condition on status update | Application-level locking | SQLite atomic UPDATE with WHERE clause | Database handles atomicity, prevents TOCTOU bugs |

**Key insight:** Process termination has subtle platform differences (Windows vs Linux signal handling) and timing edge cases (process dies between check and kill). Use proven patterns rather than ad-hoc implementations.

## Common Pitfalls

### Pitfall 1: Ignoring FFmpeg stdin Cleanup
**What goes wrong:** Sending SIGTERM directly skips FFmpeg's internal cleanup, resulting in corrupt MP4 files (missing moov atom at end of file)
**Why it happens:** stdin 'q' command triggers FFmpeg's normal exit path (finalize file headers, flush buffers), while SIGTERM triggers signal handler that may not complete cleanup
**How to avoid:** Always try stdin 'q' first, wait 2 seconds before escalating to SIGTERM
**Warning signs:** Partial output files are not playable in browser, file size is smaller than expected

### Pitfall 2: PID Reuse Vulnerability
**What goes wrong:** Killing a PID that has been reassigned to a different process after FFmpeg exited
**Why it happens:** Linux/Unix can reuse PIDs quickly; storing PID in database means delay between process exit and kill attempt
**How to avoid:** Clear ffmpeg_pid from database immediately in 'exit' event handler; check if PID is still valid before kill
**Warning signs:** Unrelated processes being terminated, "no such process" errors

### Pitfall 3: Not Handling Already-Completed Jobs
**What goes wrong:** User clicks cancel on job detail page just as last variation finishes, gets error instead of success
**Why it happens:** Race condition between frontend poll detecting 'processing' and final variation completing
**How to avoid:** Check job status in cancel endpoint, return current status if already terminal (completed/failed/cancelled)
**Warning signs:** User confusion from error messages like "Job cannot be cancelled" when they saw it processing

### Pitfall 4: Partial File Accumulation
**What goes wrong:** Cancelling during variation writes leaves partial MP4 files (in-progress variation) consuming storage
**Why it happens:** FFmpeg creates output file on spawn, writes incrementally; kill interrupts before finalization
**How to avoid:** After cancellation, scan job output directory and delete any files not in output_files table
**Warning signs:** Storage fills faster than expected, orphaned .mp4 files in job directories

### Pitfall 5: SQLite BUSY Errors on Concurrent Updates
**What goes wrong:** Cancel request tries to update job status while queue worker is also updating progress, causing SQLITE_BUSY
**Why it happens:** Multiple writers trying to update same row; SQLite allows one writer at a time even in WAL mode
**How to avoid:** Use better-sqlite3's default retry mechanism (already configured in project); keep transactions short
**Warning signs:** Intermittent 500 errors on cancel requests, "database is locked" messages in logs

## Code Examples

Verified patterns from official sources:

### Checking Process Validity Before Kill
```javascript
// Source: Node.js Process documentation
function isProcessAlive(pid) {
  try {
    // Signal 0 doesn't kill, just checks if process exists and is accessible
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') {
      // No such process
      return false;
    } else if (err.code === 'EPERM') {
      // Process exists but no permission (still alive)
      return true;
    }
    throw err; // Unexpected error
  }
}
```

### Graceful FFmpeg Termination with Escalation
```javascript
// Source: Community patterns + Node.js child_process docs
async function gracefulKillFFmpeg(childProcess, timeoutMs = 2000) {
  if (!childProcess || childProcess.killed) {
    return; // Already dead
  }

  return new Promise((resolve) => {
    let killed = false;

    const cleanup = () => {
      if (!killed) {
        killed = true;
        clearTimeout(sigtermTimer);
        clearTimeout(sigkillTimer);
        childProcess.removeListener('exit', cleanup);
        resolve();
      }
    };

    childProcess.once('exit', cleanup);

    // Stage 1: stdin 'q'
    try {
      childProcess.stdin.write('q\n');
    } catch (err) {
      // stdin closed, skip to SIGTERM
    }

    // Stage 2: SIGTERM after timeout
    const sigtermTimer = setTimeout(() => {
      if (!killed && !childProcess.killed) {
        childProcess.kill('SIGTERM');
      }
    }, timeoutMs);

    // Stage 3: SIGKILL as last resort
    const sigkillTimer = setTimeout(() => {
      if (!killed && !childProcess.killed) {
        childProcess.kill('SIGKILL');
      }
      cleanup(); // Force cleanup after SIGKILL
    }, timeoutMs * 2);
  });
}
```

### Cancellation Endpoint with Status Validation
```javascript
// DELETE /api/jobs/:id/cancel
router.delete('/:id/cancel', requireAuth, async (req, res) => {
  const job = queries.getJob.get(req.params.id);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Only cancellable if not terminal
  if (!['queued', 'processing'].includes(job.status)) {
    return res.status(200).json({
      jobId: job.id,
      status: job.status,
      message: 'Job already completed or cancelled'
    });
  }

  // Mark as cancelled in database
  queries.updateJobStatus.run('cancelled', job.id);
  queries.updateJobCancelledAt.run(job.id);

  // Kill active FFmpeg processes
  const files = queries.getJobFiles.all(job.id);
  for (const file of files) {
    if (file.ffmpeg_pid && isProcessAlive(file.ffmpeg_pid)) {
      try {
        const proc = /* retrieve ChildProcess reference */;
        await gracefulKillFFmpeg(proc);
      } catch (err) {
        console.error(`Failed to kill FFmpeg PID ${file.ffmpeg_pid}:`, err);
      }
      queries.clearFilePid.run(file.id);
    }
  }

  // Clean up partial output files
  const jobOutputDir = path.join(outputDir, job.id);
  if (fs.existsSync(jobOutputDir)) {
    const completedPaths = new Set();
    for (const file of files) {
      const outputs = queries.getOutputFilesByJobFile.all(file.id);
      outputs.forEach(o => completedPaths.add(o.output_path));
    }

    const allFiles = fs.readdirSync(jobOutputDir);
    for (const filename of allFiles) {
      const fullPath = path.join(jobOutputDir, filename);
      if (!completedPaths.has(fullPath)) {
        fs.unlinkSync(fullPath); // Delete partial file
      }
    }
  }

  // Return final status (may have completed during kill attempt)
  const finalJob = queries.getJob.get(job.id);
  res.json({
    jobId: finalJob.id,
    status: finalJob.status,
    completedVariations: files.reduce((sum, f) => sum + f.completed_variations, 0),
    totalVariations: job.total_variations
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SIGTERM only | stdin 'q' → SIGTERM → SIGKILL | FFmpeg community practices (2015-present) | Prevents corrupted output files, ensures cleanup |
| Synchronous kill() | Timeout-based escalation with Promise | Node.js async best practices (2017+) | Prevents indefinite hangs, guarantees termination |
| In-memory process tracking | Database PID storage | Server restart resilience (2020+) | Survives crashes, enables recovery on startup |
| Delete all on cancel | Keep completed variations | UX improvement (context decision) | Users can download partial results |

**Deprecated/outdated:**
- **child_process.execSync for long-running processes**: Blocks event loop, can't handle progress or cancellation; spawn is current standard
- **fluent-ffmpeg library**: Archived May 2025 (per PROJECT.md); direct child_process.spawn is now standard
- **SIGKILL-first approach**: Lost graceful cleanup benefits, modern pattern uses escalation

## Open Questions

Things that couldn't be fully resolved:

1. **Process group killing on Unix**
   - What we know: FFmpeg spawns without `detached: true`, so it's in same process group as Node.js server
   - What's unclear: Whether FFmpeg spawns sub-processes (e.g., for multi-pass encoding) that need separate kill
   - Recommendation: Test cancellation with verbose FFmpeg output; if orphaned processes appear, use `process.kill(-pid, signal)` to kill entire process group (negative PID on Unix)

2. **Windows signal compatibility**
   - What we know: Windows only recognizes SIGTERM, SIGKILL, SIGINT, SIGQUIT; other signals ignored
   - What's unclear: Whether stdin 'q' works reliably on Windows FFmpeg builds
   - Recommendation: Test on Windows deployment if Fly.io machines use Windows (unlikely — default is Linux); may need platform-specific logic

3. **Corrupted MP4 recovery**
   - What we know: MP4 format requires 'moov' atom at end of file; incomplete files are unplayable
   - What's unclear: Whether partially-written variation files (interrupted mid-encode) are recoverable with ffmpeg -i corrupt.mp4 -c copy fixed.mp4
   - Recommendation: Don't attempt recovery — delete partial files (simpler, avoids bad UX of broken videos)

## Sources

### Primary (HIGH confidence)
- [Node.js Child Process Documentation](https://nodejs.org/api/child_process.html) - subprocess.kill(), stdin interaction, event handling
- [Node.js Process Documentation](https://nodejs.org/api/process.html) - Signal types, process.kill()
- [SQLite Atomic Commit](https://sqlite.org/atomiccommit.html) - Transaction atomicity guarantees
- [SQLite WAL Mode](https://sqlite.org/wal.html) - Concurrent read/write behavior

### Secondary (MEDIUM confidence)
- [Graceful Shutdown in Node.js](https://dev.to/superiqbal7/graceful-shutdown-in-nodejs-handling-stranger-danger-29jo) - Timeout escalation patterns
- [FFmpeg stdin 'q' command discussion](https://github.com/Ch00k/ffmpy/issues/11) - Community consensus on stdin vs SIGTERM
- [FFmpeg signal handling](https://forums.raspberrypi.com/viewtopic.php?t=284030) - Graceful termination approaches
- [Node.js Child Process Best Practices](https://runebook.dev/en/articles/node/child_process/subprocessref) - Event-driven cleanup patterns

### Tertiary (LOW confidence)
- [FFmpeg SIGTERM handling issue](https://www.mail-archive.com/ffmpeg-trac@avcodec.org/msg66152.html) - Anecdotal reports of SIGTERM not working, needs verification with current FFmpeg version
- WebSearch results on race conditions and database locking - General patterns, not Node.js/SQLite specific

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Node.js built-ins verified via official docs, SQLite already in use
- Architecture: HIGH - Three-stage escalation pattern verified across multiple sources, matches existing processor.js structure
- Pitfalls: MEDIUM - PID reuse and stdin cleanup verified, partial file cleanup inferred from MP4 format knowledge

**Research date:** 2026-02-09
**Valid until:** 2026-03-09 (30 days — Node.js APIs stable, FFmpeg behavior unlikely to change)
