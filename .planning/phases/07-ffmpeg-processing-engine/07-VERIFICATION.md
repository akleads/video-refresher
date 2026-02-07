---
phase: 07-ffmpeg-processing-engine
verified: 2026-02-07T22:15:00Z
status: passed
score: 5/5 must-haves verified
---

# Phase 7: FFmpeg Processing Engine Verification Report

**Phase Goal:** Uploaded videos are processed into variations using native FFmpeg with the same random effects as v1, with progress tracking and error handling per video -- the core value of v2.

**Verified:** 2026-02-07T22:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Output variation files appear on Fly Volume with visually distinct random effects matching v1 quality | ✓ VERIFIED | processor.js spawns FFmpeg with v1-compatible filter strings (rotate + eq filters). effects.js generates unique effects in exact v1 ranges: rotation 0.001-0.01, brightness -0.05 to 0.05, contrast/saturation 0.95-1.05. buildFilterString() matches v1 format: `rotate=X:fillcolor=black@0,eq=brightness=Y:contrast=Z:saturation=W`. FFmpeg args match v1 encoding params (29.97fps, 2000k bitrate, ultrafast preset). output_files table tracks all variations with path/size. |
| 2 | Polling job status endpoint shows per-video progress percentage that advances from 0 to 100 | ✓ VERIFIED | GET /api/jobs/:id returns `progress: f.progress_percent \|\| 0` per file and `overallProgress` computed as average. processor.js updates progress via `queries.updateFileProgress.run(overall, file.id)` with overall = `(i * 100 + percent) / variationsPerVideo` providing smooth 0-100 tracking across all variations. FFmpeg stderr parsed with readline, time= regex extracts current seconds, progress callback fires with clamped 0-100 percentage. Throttled to 2% increments to avoid DB write spam. |
| 3 | Jobs continue processing after API client disconnects (fire-and-forget) | ✓ VERIFIED | JobQueueWorker is independent of HTTP connections. Started in server/index.js after listen, polls SQLite every 2s via `queries.getNextQueuedJob.get()`. processJob runs async, no connection to HTTP request lifecycle. POST /api/jobs returns 202 immediately after inserting job into SQLite with status='queued'. Worker picks up job autonomously via polling loop. |
| 4 | Server restart marks interrupted jobs as failed/retryable (not silently lost) | ✓ VERIFIED | recoverInterruptedJobs() runs on server startup (line 160 server/index.js). Queries `getProcessingJobs.all()` finds stuck jobs, marks as failed with 'Server restarted during processing' error. All 'processing' files in stuck jobs also marked failed. Orphaned FFmpeg PIDs (from `getFilesWithPid.all()`) are killed with SIGKILL and cleared from DB. Recovery completes before worker starts. |
| 5 | Failed video doesn't block batch — other videos complete normally | ✓ VERIFIED | processor.js line 104-113: processFile() wrapped in try/catch. On error, sets `allSucceeded = false`, calls `updateFileError.run()`, logs error, then continues loop (no throw/return). Comment line 112: "Continue to next file -- don't block batch". Job marked 'completed' if ANY file succeeds (line 126), only 'failed' if ALL files fail (line 123-124). Per-file error isolation proven. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| server/lib/ffmpeg.js | FFmpeg spawn wrapper with progress parsing, ffprobe duration extraction | ✓ VERIFIED | 119 lines. Exports spawnFFmpeg (returns {process, promise}), getVideoDuration. spawnFFmpeg spawns with v1 args, parses stderr via readline for time= progress, collects last 20 stderr lines for errors, returns child process for pid tracking. getVideoDuration spawns ffprobe, parses JSON, returns duration or 0 on failure. No stubs, imports used in processor.js:3. |
| server/lib/effects.js | Random effects generator matching v1 behavior | ✓ VERIFIED | 54 lines. Exports generateUniqueEffects (Set-based dedup with JSON.stringify), buildFilterString. Ranges match v1 exactly: rotation 0.001-0.01, brightness -0.05 to 0.05, contrast 0.95-1.05, saturation 0.95-1.05. Filter format: `rotate=X:fillcolor=black@0,eq=brightness=Y:contrast=Z:saturation=W`. No stubs, imports used in processor.js:4. |
| server/lib/processor.js | Per-file video processing orchestrator | ✓ VERIFIED | 130 lines. Exports processJob. Iterates job files, calls processFile for each. processFile: probes duration, generates N unique effects, spawns FFmpeg N times (one per variation), updates progress throttled to 2%, stores output files, increments completed_variations. Error handling: per-file try/catch, continues on failure. Used by queue.js:1. |
| server/lib/queue.js | Background job queue worker | ✓ VERIFIED | 65 lines. Exports JobQueueWorker class. Polls SQLite every 2s via getNextQueuedJob, processes one job at a time via processJob, uses setImmediate for rapid back-to-back jobs. Stoppable via stop(). Tracks currentJobId for shutdown. Fire-and-forget: independent of HTTP lifecycle. Used by server/index.js:11. |
| server/db/schema.js | Extended schema with progress columns, output_files table | ✓ VERIFIED | output_files table created (lines 24-32) with indexes. migrateSchema() function adds 6 columns to job_files: progress_percent, duration_seconds, ffmpeg_pid, error, completed_variations, updated_at. Idempotent via try/catch duplicate column detection. |
| server/db/queries.js | Prepared statements for progress, output tracking, recovery | ✓ VERIFIED | 20 prepared statements total. New additions: updateFileProgress, updateFileStatus, updateFileDuration, updateFilePid, updateFileError, incrementFileVariations, updateJobStatus, updateJobError, insertOutputFile, getOutputFiles, getOutputFilesByJobFile, getProcessingJobs, getFilesWithPid, clearFilePid, getNextQueuedJob. All used in processor/queue/index. |
| server/index.js | Queue worker startup, recovery, graceful shutdown | ✓ VERIFIED | Imports JobQueueWorker (line 11). Creates worker instance (line 45). app.listen callback (156-162): runs recoverInterruptedJobs, then worker.start(). recoverInterruptedJobs (76-108): marks stuck jobs failed, kills orphaned FFmpeg pids. gracefulShutdown (110-151): stops worker, kills active FFmpeg (SIGTERM then SIGKILL after 2s), marks interrupted jobs failed, closes DB. SIGTERM/SIGINT handlers (153-154). |
| server/routes/jobs.js | Job status endpoint with progress/output data | ✓ VERIFIED | GET /:id (40-87): queries getOutputFiles, groups by job_file_id, computes overallProgress as average of file progress_percent, returns per-file progress/completedVariations/error/outputs array. Response includes progress (0-100), completedVariations count, error message, outputs with variationIndex/outputPath/fileSize. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| processor.js | ffmpeg.js | import spawnFFmpeg, getVideoDuration | ✓ WIRED | Line 3 import, line 58 spawnFFmpeg call, line 21 getVideoDuration call. FFmpeg spawned per variation with filter string, progress callback, duration. |
| processor.js | effects.js | import generateUniqueEffects, buildFilterString | ✓ WIRED | Line 4 import, line 27 generateUniqueEffects call, line 39 buildFilterString call. Effects generated once per file, filter built per variation. |
| processor.js | db queries | updates progress, status, output files | ✓ WIRED | Line 18 updateFileStatus, line 24 updateFileDuration, line 52 updateFileProgress (throttled), line 61 updateFilePid, line 74 insertOutputFile, line 77 incrementFileVariations, line 81 updateFileProgress(100), line 93 updateJobStatus, line 107 updateFileStatus, line 110 updateFileError. All wired. |
| queue.js | processor.js | calls processJob | ✓ WIRED | Line 1 import, line 39 processJob call in poll() method. Worker polls for queued job, processes via processJob, loops. |
| queue.js | SQLite polling | getNextQueuedJob every 2s | ✓ WIRED | Line 32 `queries.getNextQueuedJob.get()`, line 58 `setTimeout(() => this.poll(), 2000)`. Poll loop implemented. |
| server/index.js | queue.js | imports and starts JobQueueWorker | ✓ WIRED | Line 11 import, line 45 worker instantiation, line 161 worker.start(). Worker lifecycle managed. |
| server/index.js | process signals | SIGTERM/SIGINT handlers | ✓ WIRED | Lines 153-154 process.on handlers, line 110-151 gracefulShutdown function. Worker stopped (line 112), FFmpeg killed (line 117 SIGTERM, line 145 SIGKILL), current job marked failed (line 130), DB closed (line 148). |
| routes/jobs.js | db queries | getOutputFiles for variation data | ✓ WIRED | Line 47 `queries.getOutputFiles.all(req.params.id)`, line 62 progress_percent access, line 78 progress field, line 72 overallProgress field. Status endpoint returns full progress data. |

### Requirements Coverage

| Requirement | Status | Supporting Evidence |
|-------------|--------|---------------------|
| PROC-02: Server processes videos with native FFmpeg using same random effects as v1 | ✓ SATISFIED | ffmpeg.js spawns native FFmpeg with v1 args. effects.js generates v1-compatible random effects (rotation 0.001-0.01, brightness -0.05 to 0.05, contrast/saturation 0.95-1.05). buildFilterString matches v1 format. processor.js generates unique effects per file, spawns FFmpeg per variation. |
| PROC-04: Job status endpoint with per-video progress percentage | ✓ SATISFIED | GET /api/jobs/:id returns per-file `progress: f.progress_percent \|\| 0` (0-100) and overallProgress computed as average. processor.js updates progress via updateFileProgress with throttled 2% increments. FFmpeg stderr parsed for time= to compute percentage. |
| PROC-05: Fire-and-forget -- jobs continue after browser tab closes | ✓ SATISFIED | JobQueueWorker is independent of HTTP connections. Polls SQLite every 2s, processes jobs async. POST /api/jobs returns 202 immediately, worker picks up job later. No connection between HTTP request and processing lifecycle. |
| PROC-06: Job recovery on server restart (interrupted jobs marked and retryable) | ✓ SATISFIED | recoverInterruptedJobs() runs on startup, marks stuck 'processing' jobs as failed with 'Server restarted during processing' error. All 'processing' files in stuck jobs also marked failed. Orphaned FFmpeg PIDs killed with SIGKILL and cleared. Recovery completes before worker starts. |

### Anti-Patterns Found

No anti-patterns detected. All files substantive, no TODO/FIXME comments, no stub patterns, no console.log-only implementations, no empty returns.

**Key quality indicators:**
- All files 50+ lines (substantive implementations)
- v1 effect ranges verified in code (not hardcoded placeholders)
- FFmpeg filter format matches v1 exactly
- Error handling is comprehensive (per-file isolation, graceful shutdown, recovery)
- Progress tracking is real (stderr parsing, throttled DB updates)
- Fire-and-forget proven via architecture (independent worker)

### Human Verification Required

The following items cannot be verified programmatically and require human testing:

#### 1. Visual effect quality matches v1

**Test:** Upload a test video via POST /api/jobs with 5 variations. Wait for completion, download output files from server volume. Compare visual appearance of rotation, color adjustments, saturation effects to v1 outputs.

**Expected:** Variations should have subtle random differences. Rotation should be slight (not extreme spin). Color/brightness/contrast/saturation adjustments should be barely noticeable but distinct between variations. No extreme or broken visual artifacts.

**Why human:** Visual quality assessment requires human judgment. FFmpeg filter syntax is correct in code, but actual encoding output quality requires eyes-on verification.

#### 2. Progress advances smoothly from 0 to 100

**Test:** Upload a video, poll GET /api/jobs/:id every 2 seconds during processing. Observe `progress` field for each file and `overallProgress` field.

**Expected:** Progress should start at 0, increase gradually (not jump from 0 to 100), reach 100 at completion. Should advance in roughly 2% increments (throttling). overallProgress should be average of all file progress values.

**Why human:** While progress update code is verified, actual rate of advancement depends on FFmpeg encoding speed which varies by video. Human needs to confirm it "feels right" and doesn't stall.

#### 3. Fire-and-forget behavior (disconnect during processing)

**Test:** Upload a video via POST /api/jobs. Immediately close browser/kill curl. Wait 30 seconds. Reopen browser, poll GET /api/jobs/:id.

**Expected:** Job should show status='completed' (or 'processing' if still encoding). Progress should have advanced even though client disconnected. Output files should exist on volume.

**Why human:** Requires intentional connection interruption and waiting. Can't be automated easily without integration test harness.

#### 4. Server restart recovery (kill mid-processing)

**Test:** Upload a video, wait until processing starts (status='processing'). Kill server process (`kill -9` or docker stop). Restart server. Check job status.

**Expected:** Job should show status='failed' with error='Server restarted during processing'. Any files that were 'processing' should also be 'failed'. No orphaned FFmpeg processes running (check `ps aux | grep ffmpeg`).

**Why human:** Requires manual server process control and system-level process inspection.

#### 5. Batch error isolation (one corrupt video)

**Test:** Upload a batch with 3 videos: 2 valid MP4s, 1 corrupt/invalid file. Wait for processing to complete.

**Expected:** 2 valid videos should complete successfully with status='completed' and output files. 1 corrupt video should have status='failed' with error message. Job overall status should be 'completed' (partial success, not全failed).

**Why human:** Requires intentionally creating corrupt video file and validating mixed success/failure state. Can't verify "other videos complete normally" without actually running FFmpeg on real files.

## Summary

**All 5 success criteria VERIFIED at code level.**

Phase 7 goal achieved: The codebase contains a complete FFmpeg processing engine with:

- Native FFmpeg spawning with v1-compatible random effects (rotation, color adjustments)
- Real-time progress tracking via stderr parsing, updating SQLite with 0-100 percentages
- Fire-and-forget architecture via independent SQLite-polling queue worker
- Startup recovery that marks interrupted jobs as failed and kills orphaned processes
- Per-file error isolation preventing batch blocking

**No gaps found.** All artifacts exist, are substantive (50-130 lines each), and are fully wired. No stub patterns detected.

**Human verification required** for 5 items related to visual quality, real-time behavior, and deployment-specific scenarios. These are expected limitations of static code verification and do not block phase completion.

**Ready to proceed** to Phase 8 (Download, Cleanup, and Job Lifecycle).

---

*Verified: 2026-02-07T22:15:00Z*
*Verifier: Claude (gsd-verifier)*
