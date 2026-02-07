# Domain Pitfalls: Server-Side Video Processing Migration

**Domain:** Migrating from client-side FFmpeg.wasm to server-side native FFmpeg on Fly.io
**Researched:** 2026-02-07
**Confidence:** MEDIUM-HIGH (verified against Fly.io community posts, official docs references, and Node.js ecosystem patterns)

**Note:** This document covers pitfalls specific to adding server-side processing to an existing client-side tool. The previous PITFALLS.md covered browser-side FFmpeg.wasm issues. This document is its server-side counterpart.

---

## Critical Pitfalls

Mistakes that cause data loss, downtime, or require architectural rewrites.

### Pitfall 1: Writing Temporary Files to /tmp on Fly.io (RAM Disk Trap)

**What goes wrong:** On Fly.io, `/tmp` is mounted as a RAM disk (tmpfs). Writing uploaded videos or FFmpeg intermediate files to `/tmp` consumes RAM, not disk space. With a 256MB-512MB machine processing video files, this exhausts available memory almost immediately, causing OOM kills.

**Why it happens:**
- Developers habitually use `/tmp` for temporary files on Linux
- Multer and other upload libraries default to `/tmp` or in-memory storage
- The behavior is undocumented in obvious places; it only surfaces in community forum posts
- Works fine in local Docker testing where `/tmp` is real disk

**Consequences:**
- Machine OOM-killed mid-upload or mid-processing
- Intermittent crashes (works with small files, fails with large ones)
- Confusing metrics: memory usage spikes with no apparent code-level allocation
- App restarts lose all in-progress work

**Warning signs:**
- Memory usage spikes when files are written but no large JS objects exist
- Machine restarts during file upload phase, not processing phase
- `df -h /tmp` shows available space tracking RAM, not disk

**Prevention:**
- ALWAYS write temporary files to the Fly Volume mount path (e.g., `/data/tmp/`)
- Configure multer/busboy to use volume-backed disk storage, never memory or `/tmp`
- Add a startup check that verifies the volume is mounted before accepting uploads:
  ```javascript
  const VOLUME_PATH = '/data';
  if (!fs.existsSync(VOLUME_PATH)) {
    console.error('FATAL: Volume not mounted at /data');
    process.exit(1);
  }
  ```
- Set `TMPDIR` environment variable to a volume-backed path in Dockerfile

**Detection:**
- Run `mount | grep tmp` in the container to confirm tmpfs
- Monitor `free -m` during file operations
- Check Fly.io dashboard for OOM kill events

**Confidence:** HIGH -- verified via multiple Fly.io community posts ([1](https://community.fly.io/t/tmp-storage-and-small-volumes/9854), [2](https://community.fly.io/t/tmp-no-space-left-on-device/9408))

**Phase mapping:** Must be addressed in the earliest infrastructure phase when setting up the Fly.io machine and volume.

---

### Pitfall 2: Buffering Entire Upload in Memory Instead of Streaming to Disk

**What goes wrong:** Common Node.js upload middleware (multer with MemoryStorage, express-fileupload with default settings) buffers the entire uploaded file in RAM before writing to disk. A single 50MB video upload consumes 50MB+ of the server's 256-512MB RAM. Multiple concurrent uploads crash the server.

**Why it happens:**
- Multer defaults to MemoryStorage in many tutorials
- express-fileupload buffers by default
- On the client-side (v1), the file was already in browser memory, so no upload step existed
- Developers copy-paste upload examples without checking storage engine

**Consequences:**
- Server OOM with as few as 2-3 concurrent uploads of moderate videos
- "JavaScript heap out of memory" errors
- Works in single-user testing, fails when team uses it simultaneously
- Fly.io machine restarts, losing all in-progress jobs

**Warning signs:**
- RSS memory spikes linearly with upload file size
- Server crashes correlate with upload timing, not processing timing
- `process.memoryUsage().rss` jumps by file size during upload

**Prevention:**
- Use busboy (streaming parser) or multer with DiskStorage pointing to the volume
- Stream directly to disk, never buffer in memory:
  ```javascript
  // Use multer with disk storage on the volume
  const upload = multer({
    storage: multer.diskStorage({
      destination: '/data/uploads/',
      filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
    }),
    limits: { fileSize: 200 * 1024 * 1024 } // 200MB cap
  });
  ```
- Set file size limits at the middleware level (reject before buffering)
- Consider chunked upload for files >50MB if network reliability is a concern

**Detection:**
- Monitor `process.memoryUsage()` during upload vs. at rest
- Load test with concurrent uploads of realistic file sizes
- Check if memory returns to baseline after upload completes

**Confidence:** HIGH -- well-documented Node.js pattern ([multer docs](https://expressjs.com/en/resources/middleware/multer.html), [express-fileupload issue #89](https://github.com/richardgirges/express-fileupload/issues/89))

**Phase mapping:** Must be addressed in the file upload/API phase. Get this wrong and every subsequent feature is unreliable.

---

### Pitfall 3: Fly.io Auto-Stop Kills Machine Mid-Processing

**What goes wrong:** Fly.io's `auto_stop_machines` feature shuts down idle machines to save costs. If a video processing job is running but no HTTP requests are active (user closed tab, fire-and-forget pattern), Fly.io considers the machine "idle" and sends a kill signal. The in-progress FFmpeg job is terminated, losing all work.

**Why it happens:**
- Fly.io auto-stop monitors HTTP connections, not background CPU usage
- The fire-and-forget UX (close tab, come back later) is the exact scenario that triggers auto-stop
- Default idle timeout is short (~5 minutes)
- Shared-CPU machines have a maximum `kill_timeout` of only 300 seconds (5 minutes)
- Video processing of a batch (3 videos x 10 variations = 30 encodes) can easily exceed 5 minutes

**Consequences:**
- Jobs silently disappear mid-processing
- User returns to find no results
- Partial files left on disk consuming storage quota
- Extremely confusing debugging (works when you watch it, fails when you walk away)

**Warning signs:**
- Jobs complete when browser stays open but fail when tab is closed
- Fly.io logs show SIGTERM/SIGINT during processing
- Jobs that take >5 minutes fail more often than short jobs

**Prevention:**
- **Option A (simple):** Disable auto-stop entirely for this app: `auto_stop_machines = "off"` in `fly.toml`. Accept the small cost of keeping the machine running 24/7 (~$2-3/month for shared-cpu-1x)
- **Option B (cost-optimized):** Keep auto-stop but set `min_machines_running = 1` so at least one machine always stays alive
- **Option C (complex):** Implement proper SIGTERM handling that checkpoints job state:
  ```javascript
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, finishing current job...');
    // Mark in-progress jobs as "interrupted" in SQLite
    // Let current FFmpeg process finish if possible
    // Clean up partial files
    await gracefulShutdown();
    process.exit(0);
  });
  ```
- Configure `kill_timeout = 300` (max for shared CPU) to give FFmpeg time to finish current encode
- Set `kill_signal = "SIGTERM"` so Node.js can catch it

**Detection:**
- Check Fly.io machine event logs for stop/start patterns during expected processing windows
- Add logging when SIGTERM is received
- Track job completion rate vs. job start rate in SQLite

**Confidence:** HIGH -- verified in [Fly.io autostop docs](https://fly.io/docs/launch/autostop-autostart/) and [community discussion](https://community.fly.io/t/handling-long-running-tasks-with-automatic-machine-shutdown-on-fly-io/24256)

**Phase mapping:** Must be decided in infrastructure setup phase and revisited when implementing the job queue. Wrong default here causes the most confusing production bugs.

---

### Pitfall 4: 1GB Storage Cap Math Doesn't Account for Input + Working + Output Files

**What goes wrong:** The 1GB volume is planned for "processed video storage," but actual disk usage includes: uploaded source files + FFmpeg working copies + output files + SQLite database + FFmpeg temporary files. A single batch job (3 source videos x 10 variations) could need 2-3GB of temporary disk space, far exceeding the 1GB volume.

**Why it happens:**
- Storage budgeting only considers the final output (stored results)
- FFmpeg creates temporary intermediate files during processing
- Source files must persist on disk during the entire batch processing duration
- Multiple concurrent users multiply the temporary storage requirement
- SQLite WAL files can grow unexpectedly under write load

**Consequences:**
- "No space left on device" errors mid-processing
- FFmpeg crashes with cryptic I/O errors
- SQLite write failures ("database or disk is full")
- Partial output files consuming space with no way to resume

**Warning signs:**
- `df -h /data` shows >80% usage during processing
- Jobs fail with I/O errors, not FFmpeg encoding errors
- First batch succeeds, second fails (leftover files from first batch)

**Prevention:**
- **Calculate realistic storage budget:**
  ```
  Per batch (3 sources x 10 variations, ~20MB avg source):
    Source files:   3 x 20MB =   60MB (uploaded, kept during processing)
    Working copies: 1 x 20MB =   20MB (FFmpeg intermediate, one at a time)
    Output files:  30 x 20MB =  600MB (all variations)
    ZIP file:        1 x 600MB = 600MB (if zipping on server)
    --------------------------------
    Peak usage:              ~1,280MB for ONE batch
  ```
- Size volume at 3GB minimum (not 1GB) to handle realistic workloads
- Implement pre-flight disk space check before accepting uploads:
  ```javascript
  function checkDiskSpace(requiredMB) {
    const stats = fs.statfsSync('/data');
    const availableMB = (stats.bavail * stats.bsize) / (1024 * 1024);
    return availableMB >= requiredMB;
  }
  ```
- Delete source files immediately after all their variations are processed
- Stream ZIP to client instead of writing to disk (avoid doubling output storage)
- Implement aggressive cleanup: delete outputs after download or after 24h, whichever comes first

**Detection:**
- Add disk usage monitoring that logs available space before/after each job
- Set up alerts when volume usage exceeds 70%
- Track "disk full" errors separately from processing errors

**Confidence:** HIGH -- arithmetic based on project requirements (3 videos x 10-20 variations x typical ad creative sizes)

**Phase mapping:** Must be decided during infrastructure phase (volume sizing) and enforced during upload/processing phases. Undersizing here causes the most expensive fix (volume resize requires machine restart and potential data migration).

---

### Pitfall 5: Deployment Causes Downtime and In-Progress Job Loss

**What goes wrong:** Every `fly deploy` destroys the current machine and creates a new one. With a single machine + volume setup, this means: (a) ~10-30 seconds of downtime during deploy, (b) any in-progress FFmpeg jobs are killed, (c) the SQLite WAL may not be checkpointed cleanly.

**Why it happens:**
- Fly.io's rolling deploy strategy (default) destroys the old machine before starting the new one for single-machine apps
- Blue-green and canary deploy strategies cannot be used with volumes
- There's no way to drain a processing queue before deploy with default tooling
- Developers deploy without checking if jobs are running

**Consequences:**
- Users lose in-progress work during deploys
- SQLite database corruption if WAL isn't checkpointed (rare but possible)
- Downloaded ZIP links break (old machine's temp files gone)
- Team members see errors during the deploy window

**Warning signs:**
- User complaints after every deploy
- "Job was processing, now it says failed" reports
- SQLite integrity check failures after deploy

**Prevention:**
- Check for active jobs before deploying:
  ```bash
  # Pre-deploy check script
  fly ssh console -C "curl -s localhost:3000/api/health | jq '.activeJobs'"
  # If activeJobs > 0, wait or warn
  ```
- Implement graceful shutdown in Node.js that finishes current FFmpeg process before exiting
- Use SQLite WAL mode with `PRAGMA wal_checkpoint(TRUNCATE)` on SIGTERM
- Mark interrupted jobs as "interrupted" so users see a clear status, not a mysterious failure
- Consider deploying only during off-hours for the team
- Set `kill_timeout = 300` to give maximum time for in-progress work to complete

**Detection:**
- Fly.io deploy logs show machine destruction timing
- SQLite `PRAGMA integrity_check` after deploy
- Job status audit: any jobs stuck in "processing" state after deploy

**Confidence:** HIGH -- verified in [Fly.io deploy docs](https://fly.io/docs/launch/deploy/) and [community discussion](https://community.fly.io/t/avoiding-deployment-downtime-when-using-volumes/10705) confirming bluegreen cannot use volumes

**Phase mapping:** Address in infrastructure phase (fly.toml config) and job queue phase (graceful shutdown handler). Deploy safety should be tested before the app goes into team use.

---

## Moderate Pitfalls

Mistakes that cause degraded performance, poor UX, or technical debt.

### Pitfall 6: FFmpeg Spawns Too Many Threads on Shared CPU, Causing Throttling

**What goes wrong:** Native FFmpeg auto-detects available CPU cores and spawns threads accordingly. On Fly.io shared-cpu-1x, the machine reports the host's cores (e.g., 8-16) but only has access to a fraction of one core. FFmpeg spawns too many threads, causing context-switch overhead and Fly.io CPU throttling (burst credit exhaustion).

**Why it happens:**
- FFmpeg's `-threads 0` (auto) reads `/proc/cpuinfo` which shows host CPU count
- Fly.io shared CPUs use burst credits: you get short bursts of full CPU, then throttling
- Video encoding is CPU-intensive and will exhaust burst credits quickly
- The "burst then throttle" pattern makes processing times unpredictable

**Consequences:**
- First few encodes are fast (burst), then dramatically slow down (throttled)
- Inconsistent processing times confuse progress estimation
- Machine may appear "hung" during throttling periods
- CPU usage metrics show 100% but actual throughput is low

**Warning signs:**
- Processing time for identical videos varies wildly (2x-10x range)
- First batch job after idle is fast, subsequent ones are slow
- Fly.io dashboard shows CPU throttling events

**Prevention:**
- Explicitly limit FFmpeg threads: `-threads 1` for shared-cpu-1x
- Use `ultrafast` preset (already planned from v1) to minimize CPU time per encode
- Process variations sequentially (one FFmpeg process at a time)
- Consider performance-cpu-1x ($29/mo) if consistent speed matters more than cost:
  ```
  shared-cpu-1x with 512MB: ~$3.50/mo (burst, unpredictable)
  performance-cpu-1x with 512MB: ~$29/mo (dedicated, consistent)
  ```
- Use `-threads 1` in FFmpeg commands:
  ```javascript
  const args = [
    '-i', inputPath,
    '-threads', '1',        // Prevent over-threading
    '-preset', 'ultrafast', // Minimize CPU work
    // ... filters ...
    outputPath
  ];
  ```

**Detection:**
- Benchmark same video encode multiple times, check variance
- Monitor Fly.io CPU throttle metrics
- Log FFmpeg processing duration per variation

**Confidence:** HIGH -- verified via [Fly.io community post on FFmpeg speed](https://community.fly.io/t/speedup-ffmpeg-video-processing/23584) and [machine sizing docs](https://fly.io/docs/machines/guides-examples/machine-sizing/)

**Phase mapping:** Address when implementing the FFmpeg processing layer. A simple `-threads 1` flag prevents the issue entirely.

---

### Pitfall 7: SQLite "Database is Locked" Under Concurrent Access

**What goes wrong:** Multiple concurrent requests (upload, poll status, download) hit SQLite simultaneously. Without WAL mode, readers block writers and vice versa. Even with WAL mode, concurrent writes still serialize on a global write lock. Long-running transactions during FFmpeg processing can block status polling.

**Why it happens:**
- SQLite is single-writer by design
- Job processing updates (progress %) happen frequently during encoding
- Status polling from multiple browser tabs adds read pressure
- Default SQLite mode (journal, not WAL) blocks reads during writes
- Node.js async nature makes it easy to accidentally hold transactions open across await points

**Consequences:**
- "SQLITE_BUSY: database is locked" errors on status polling
- Progress updates lost because write transaction timed out
- API requests hang or return 500 during heavy processing
- Intermittent under low load, constant under team usage

**Warning signs:**
- Errors correlate with concurrent user count
- Status polling returns stale data or errors
- SQLite error logs show BUSY/LOCKED errors

**Prevention:**
- Enable WAL mode immediately on database creation:
  ```javascript
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');  // Wait up to 5s for lock
  ```
- Keep write transactions as short as possible (no awaiting network/FFmpeg inside a transaction)
- Batch progress updates (every 5 seconds, not every frame):
  ```javascript
  // WRONG: Update progress on every FFmpeg progress event
  ffmpeg.on('progress', (p) => db.run('UPDATE jobs SET progress = ?', p));

  // RIGHT: Throttle updates
  let lastUpdate = 0;
  ffmpeg.on('progress', (p) => {
    if (Date.now() - lastUpdate > 5000) {
      db.run('UPDATE jobs SET progress = ?', p);
      lastUpdate = Date.now();
    }
  });
  ```
- Use better-sqlite3 (synchronous API, simpler locking) over sqlite3/better-async-sqlite

**Detection:**
- Search logs for "SQLITE_BUSY" or "database is locked"
- Test with multiple browser tabs polling simultaneously during processing
- Monitor SQLite lock wait times

**Confidence:** HIGH -- well-documented SQLite behavior ([SQLite WAL docs](https://sqlite.org/wal.html), [detailed analysis](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/))

**Phase mapping:** Address in database setup phase. WAL mode must be enabled from the first migration, and busy_timeout set as a default.

---

### Pitfall 8: Node.js child_process Pipe Buffer Deadlock with FFmpeg

**What goes wrong:** When spawning FFmpeg via `child_process.spawn()`, FFmpeg writes verbose logging to stderr. If stderr isn't consumed (piped, read, or ignored), the OS pipe buffer fills up (~64KB on Linux). FFmpeg blocks waiting for buffer space, and the Node.js process blocks waiting for FFmpeg to exit. Deadlock.

**Why it happens:**
- FFmpeg is extremely verbose on stderr (frame counts, encoding stats, warnings)
- Developers use `spawn` but forget to consume stderr
- Works with short videos (stderr fits in buffer), fails with longer ones
- In client-side FFmpeg.wasm, this wasn't an issue (no pipe, messages go through postMessage)

**Consequences:**
- FFmpeg hangs indefinitely at ~10-30% progress (when pipe buffer fills)
- Node.js event loop blocks, making the entire server unresponsive
- Timeout-based kill doesn't help (process is alive, just blocked)
- Appears random because it depends on video duration and verbosity

**Warning signs:**
- Processing hangs at a consistent percentage regardless of video content
- Server stops responding to ALL requests during a hang (not just the processing endpoint)
- Process appears alive in `ps` but CPU usage is 0%

**Prevention:**
- ALWAYS consume or ignore stderr:
  ```javascript
  const ffmpeg = spawn('ffmpeg', args, {
    stdio: ['pipe', 'pipe', 'pipe'] // stdin, stdout, stderr all piped
  });

  // Consume stderr (parse for progress or discard)
  ffmpeg.stderr.on('data', (chunk) => {
    const line = chunk.toString();
    // Parse progress from FFmpeg's stderr output
    const match = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
    if (match) {
      // Update progress based on timestamp
    }
  });

  // Or ignore entirely if you don't need progress
  const ffmpeg = spawn('ffmpeg', args, {
    stdio: ['pipe', 'pipe', 'ignore'] // ignore stderr
  });
  ```
- Use `'ignore'` for stdio streams you don't need
- For output files, write to disk (not stdout) to avoid stdout buffer issues too

**Detection:**
- Processing hangs with no error output
- `strace -p <pid>` shows FFmpeg blocked on write() to fd 2 (stderr)
- Add a processing timeout that kills FFmpeg if no progress for 60 seconds

**Confidence:** HIGH -- well-documented Node.js behavior ([Node.js child_process docs](https://nodejs.org/api/child_process.html), [GitHub issue](https://github.com/nodejs/help/issues/2731))

**Phase mapping:** Address when implementing the FFmpeg spawn wrapper. This is a day-one correctness issue, not an optimization.

---

### Pitfall 9: Cold Start Latency After Machine Sleep

**What goes wrong:** If using auto-stop to save costs, the first request after a sleep period takes 3-10 seconds as the machine boots, Node.js starts, and the app initializes. Users see a blank page, timeout error, or broken upload form on first visit.

**Why it happens:**
- Fly.io suspends/stops idle machines to save costs
- Waking a stopped machine requires booting a micro-VM
- Node.js + Express startup, SQLite connection, and route registration take time
- Docker image size (especially with FFmpeg installed) affects cold start
- CDN/proxy timeout may be shorter than cold start time

**Consequences:**
- First visitor after idle gets a timeout or error
- Upload form loads but API calls fail (server not ready yet)
- User refreshes, gets a partially loaded state
- Creates perception of unreliable service

**Warning signs:**
- "502 Bad Gateway" or timeout on first visit after idle periods
- Response times jump from <100ms to 5-10s periodically
- Issues disappear after the first request

**Prevention:**
- Keep machine running 24/7 with `min_machines_running = 1` (recommended for team tool, cost is ~$2-3/month)
- If using auto-stop, increase proxy timeout for cold start:
  ```toml
  # fly.toml
  [http_service]
    auto_stop_machines = "stop"
    auto_start_machines = true
    min_machines_running = 1  # Prevents cold starts entirely
  ```
- Minimize Docker image size (use Alpine, multi-stage build)
- Add a health check endpoint that Fly.io uses to confirm readiness:
  ```toml
  [[http_service.checks]]
    path = "/api/health"
    interval = "30s"
    timeout = "5s"
  ```
- Add a loading state to the frontend that handles API unavailability gracefully

**Detection:**
- Monitor response time percentiles (p99 will show cold start spikes)
- Check Fly.io machine event logs for start/stop frequency
- Track first-request latency after idle periods

**Confidence:** HIGH -- verified via [Fly.io community reports](https://community.fly.io/t/cold-start-causes-1-minute-timeout-for-first-request-fastapi-nginx/25101) and [autostop docs](https://fly.io/docs/launch/autostop-autostart/)

**Phase mapping:** Address in infrastructure phase (fly.toml configuration). Simple fix: set `min_machines_running = 1`.

---

### Pitfall 10: Building a Job Queue That's Too Complex (or Too Simple)

**What goes wrong:** Two failure modes:
- **Too complex:** Adding Redis + BullMQ for a single-machine tool with <10 users. Redis adds infrastructure cost, complexity, and another failure mode.
- **Too simple:** Using in-memory array as a queue. Machine restart loses all pending jobs. No persistence, no retry, no progress tracking.

**Why it happens:**
- BullMQ is the "standard" answer for Node.js job queues, but requires Redis
- Developers either over-engineer (Redis for 3 users) or under-engineer (no persistence)
- Client-side v1 had no queue concept (browser tab = session), so there's no prior pattern
- "Job queue" sounds simple but has many edge cases (retry, timeout, cleanup, concurrent access)

**Consequences:**
- Too complex: $7-15/month for managed Redis, deploy complexity, debugging distributed systems for a team of 5
- Too simple: Machine restart loses all pending jobs, no recovery from FFmpeg crashes, users re-upload

**Warning signs:**
- Too complex: More time debugging Redis connection than video processing
- Too simple: "My job disappeared" reports after any machine restart

**Prevention:**
- Use SQLite as the job queue (already in the stack, persists to volume, survives restarts):
  ```sql
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    status TEXT DEFAULT 'pending',  -- pending, processing, complete, failed, interrupted
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    progress REAL DEFAULT 0,
    source_files TEXT,  -- JSON array of uploaded file paths
    variations INTEGER,
    result_path TEXT,   -- Path to ZIP or output directory
    error TEXT,
    expires_at DATETIME
  );
  ```
- Poll the jobs table from an in-process worker loop (no external queue needed)
- On startup, mark any "processing" jobs as "interrupted" (they were killed mid-flight)
- This gives you: persistence, status tracking, progress, retry, and history -- all in SQLite

**Detection:**
- If considering Redis: ask "do we have >1 machine processing jobs?" If no, SQLite suffices
- If using in-memory queue: restart the machine and check if pending jobs survive

**Confidence:** HIGH -- architectural decision based on project constraints (single machine, <10 users, SQLite already chosen)

**Phase mapping:** Address in job queue phase. The decision between SQLite-backed queue vs. external queue should be made before writing any queue code.

---

### Pitfall 11: Not Cleaning Up Output Files After Download or Expiry

**What goes wrong:** Processed videos and ZIP files accumulate on the volume. Without automated cleanup, the 1-3GB volume fills up within days of team usage. No new jobs can process because disk is full.

**Why it happens:**
- The "happy path" focuses on processing and download, not cleanup
- Multiple cleanup triggers needed: post-download, 24h expiry, storage pressure
- Crashed jobs leave orphaned files that no cleanup policy knows about
- SQLite job records may be deleted but files remain (or vice versa)

**Consequences:**
- Volume fills up, new jobs fail with "no space left on device"
- Users can't upload new videos
- Manual SSH cleanup required (bad for a team tool)
- If SQLite and files get out of sync, cleanup deletes wrong files or misses orphans

**Warning signs:**
- `df -h /data` shows increasing usage over time
- Jobs start failing after a few days of usage
- Old result files remain accessible long after they should have expired

**Prevention:**
- Implement a cleanup daemon that runs every 10 minutes:
  ```javascript
  setInterval(async () => {
    // 1. Delete expired results (24h old)
    const expired = db.prepare(
      "SELECT id, result_path FROM jobs WHERE expires_at < datetime('now')"
    ).all();
    for (const job of expired) {
      await deleteJobFiles(job.result_path);
      db.prepare("DELETE FROM jobs WHERE id = ?").run(job.id);
    }

    // 2. Delete orphaned files (files on disk with no job record)
    await cleanOrphanedFiles('/data/outputs/');

    // 3. If still over 80% capacity, delete oldest completed jobs
    await evictOldestIfNeeded(0.8);
  }, 10 * 60 * 1000);
  ```
- Delete source upload files immediately after all variations are processed
- Set `expires_at` on every job at creation time (created_at + 24h)
- Log every file creation and deletion for audit trail

**Detection:**
- Monitor disk usage trend over time
- Alert when volume exceeds 70% capacity
- Count files on disk vs. active job records (should match)

**Confidence:** HIGH -- standard storage management pattern, amplified by the 1GB constraint

**Phase mapping:** Address in the storage management phase. Must be running before the app is used by the team, or the volume fills up within the first week.

---

## Minor Pitfalls

Mistakes that cause annoyance or minor issues but are fixable without rearchitecting.

### Pitfall 12: FFmpeg Binary Not Found in Docker (Path Issues)

**What goes wrong:** FFmpeg is installed via `apt-get` or `apk` in the Dockerfile, but the Node.js process can't find it. `spawn('ffmpeg', ...)` throws "ENOENT" or "Cannot find ffprobe."

**Why it happens:**
- Multi-stage Docker build copies app but not FFmpeg binary
- Alpine vs Debian base image uses different package managers (`apk` vs `apt-get`)
- `ffmpeg-static` npm package bundles a binary that may not match the container's architecture
- PATH environment variable differs between shell and Node.js process

**Prevention:**
- Use a single-stage Dockerfile for simplicity:
  ```dockerfile
  FROM node:20-slim
  RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci --production
  COPY . .
  EXPOSE 3000
  CMD ["node", "server.js"]
  ```
- Verify FFmpeg is accessible in the container:
  ```dockerfile
  RUN ffmpeg -version  # Fails at build time if not installed correctly
  ```
- If using multi-stage build, ensure FFmpeg is in the final stage

**Confidence:** HIGH -- frequently reported on [Fly.io community](https://community.fly.io/t/deploy-node-with-ffmpeg-cannot-find-ffprobe/14893)

**Phase mapping:** Address in Dockerfile setup. Verify with `fly ssh console -C "ffmpeg -version"` after first deploy.

---

### Pitfall 13: Shared Password Auth is Bypassable Without HTTPS Enforcement

**What goes wrong:** The shared password is sent in plaintext over HTTP. Without HTTPS enforcement, anyone on the same network can sniff the password. More practically, if the password is in a query param or stored in localStorage, it leaks through browser history, referrer headers, or shared screens.

**Prevention:**
- Fly.io provides automatic HTTPS via its proxy, but ensure HTTP is redirected:
  ```toml
  [http_service]
    force_https = true
  ```
- Send password via POST body or Authorization header, never in query params
- Use a session cookie (HttpOnly, Secure, SameSite) after initial auth
- Consider a simple bearer token approach instead of checking password on every request

**Confidence:** HIGH -- standard web security practice

**Phase mapping:** Address in the auth phase. Simple but easy to forget.

---

### Pitfall 14: Frontend Still Bundles FFmpeg.wasm After Migration

**What goes wrong:** After migrating processing to the server, the frontend still loads FFmpeg.wasm assets (~25MB). Users download a huge bundle for functionality that's now server-side. Or worse, the code tries to initialize FFmpeg.wasm and fails (missing COOP/COEP headers if moved to Fly.io).

**Why it happens:**
- Gradual migration leaves FFmpeg.wasm imports in place
- No clean separation between "client processing" and "server processing" code paths
- CDN URLs for FFmpeg.wasm core remain in the HTML/JS

**Prevention:**
- Remove FFmpeg.wasm imports entirely from frontend code
- Frontend becomes a thin upload/status/download client
- Remove COOP/COEP headers (no longer needed without SharedArrayBuffer)
- Consider if frontend should still be on Cloudflare Pages (free) or co-hosted on Fly.io

**Confidence:** HIGH -- specific to this migration

**Phase mapping:** Address when building the new frontend. The frontend rewrite should start from scratch as an API client, not by modifying the existing FFmpeg.wasm-based app.js.

---

### Pitfall 15: ZIP Creation on Server Doubles Storage Usage

**What goes wrong:** Creating a ZIP file on the server requires the output videos (already on disk) PLUS the ZIP file itself. For 30 variations at ~20MB each (600MB output), the ZIP file adds another 600MB. This doubles the storage needed and may exceed volume capacity.

**Prevention:**
- Stream the ZIP response directly to the client instead of writing to disk:
  ```javascript
  const archiver = require('archiver');

  app.get('/api/jobs/:id/download', (req, res) => {
    const outputDir = getJobOutputDir(req.params.id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="variations.zip"');

    const archive = archiver('zip', { store: true }); // No compression (videos already compressed)
    archive.pipe(res);  // Stream directly to response
    archive.directory(outputDir, false);
    archive.finalize();
  });
  ```
- Use `store` compression level (no re-compression of H.264 video data)
- Never write the ZIP to disk; stream it from the output directory directly to the HTTP response

**Confidence:** HIGH -- same pattern identified in v1 PITFALLS.md but amplified by server disk constraints

**Phase mapping:** Address in the download/delivery phase. Must use streaming approach, not write-to-disk.

---

## Integration Pitfalls

Mistakes specific to migrating from client-side v1 to server-side v2.

### Pitfall 16: Porting FFmpeg.wasm Filter Syntax to Native FFmpeg Without Testing

**What goes wrong:** FFmpeg.wasm 0.12.x uses an older FFmpeg core (typically based on FFmpeg 5.x or 6.x). Native FFmpeg installed via `apt-get` may be a different version with different filter syntax, defaults, or behavior. Effects that worked in wasm may produce different visual results or errors natively.

**Why it happens:**
- Filter names are the same but default parameters differ between versions
- FFmpeg.wasm bundles a specific FFmpeg build; native packages vary by distro
- "ultrafast" preset behavior may differ slightly
- Color space handling and pixel format defaults can vary

**Prevention:**
- Test every effect combination from v1 with native FFmpeg before deploying
- Pin the FFmpeg version in the Dockerfile (don't rely on distro default):
  ```dockerfile
  # Check which version apt installs
  RUN ffmpeg -version
  # Or build from source for exact version control (complex but precise)
  ```
- Create a test suite that processes a sample video with each effect and compares output metadata
- Accept that visual output may differ slightly and validate it's acceptable

**Confidence:** MEDIUM -- likely but severity depends on specific filter syntax used

**Phase mapping:** Address when porting the effect generation code from v1 to v2. Test thoroughly before launching.

---

### Pitfall 17: Forgetting That Server Errors Need Different UX Than Client Errors

**What goes wrong:** Client-side v1 could show immediate errors (FFmpeg crash, memory issue) because everything happened in the browser. Server-side v2 has new error categories that v1 didn't handle: network errors, server timeouts, upload failures, job queue failures, disk full, server restart mid-job. The frontend error handling from v1 doesn't cover these.

**Prevention:**
- Design error states for server-side failure modes:
  - Upload failed (network): retry button, resume upload
  - Server processing failed: show FFmpeg error, offer re-process button
  - Server restarted mid-job: show "interrupted" status, offer retry
  - Disk full: "Server busy, try again later" (not a cryptic error)
  - Auth failed: clear redirect to password entry
- Implement exponential backoff for status polling
- Show "last updated" timestamp on status polling so user knows if data is stale

**Confidence:** HIGH -- inherent to client-to-server migration

**Phase mapping:** Address in the frontend rebuild phase. Error handling should be designed alongside happy-path UX.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Infrastructure Setup (Fly.io + Volume) | /tmp is RAM disk (Pitfall 1), volume undersized (Pitfall 4), auto-stop kills jobs (Pitfall 3) | Configure TMPDIR to volume path, size volume at 3GB+, set auto_stop = "off" or min_machines = 1 |
| Dockerfile + FFmpeg | FFmpeg not found (Pitfall 12), wrong thread count (Pitfall 6) | Single-stage Dockerfile, verify with `ffmpeg -version`, always use `-threads 1` |
| File Upload API | Memory buffering (Pitfall 2), disk space check missing (Pitfall 4) | Use multer DiskStorage on volume, pre-flight disk space check |
| Job Queue | Over/under-engineering (Pitfall 10), no SIGTERM handling (Pitfall 3/5) | SQLite-backed queue, mark interrupted jobs on startup, handle SIGTERM |
| FFmpeg Processing | Pipe deadlock (Pitfall 8), thread explosion (Pitfall 6), filter compat (Pitfall 16) | Consume stderr, `-threads 1`, test all effects natively |
| Storage Management | No cleanup (Pitfall 11), ZIP doubles usage (Pitfall 15) | Cleanup daemon, stream ZIP to response |
| Auth | Password in plaintext (Pitfall 13) | force_https, session cookies, POST body |
| Frontend Rebuild | Still loads FFmpeg.wasm (Pitfall 14), wrong error UX (Pitfall 17) | Clean rewrite as API client, design server error states |
| Deploy Process | Downtime + job loss (Pitfall 5) | kill_timeout = 300, pre-deploy job check, SIGTERM handler |

---

## Pre-Implementation Validation Checklist

Before writing code, validate these decisions:

- [ ] **Volume size confirmed** -- 1GB is almost certainly too small. Calculate actual peak storage for target batch sizes. 3GB minimum recommended.
- [ ] **Machine size confirmed** -- shared-cpu-1x with 256MB RAM is likely too small for video processing + Node.js + SQLite. Budget for 512MB minimum.
- [ ] **Auto-stop decision made** -- disabled (simple, ~$2-3/month) or enabled with SIGTERM handling (complex, saves ~$1/month). Recommendation: disable for a team tool.
- [ ] **TMPDIR set to volume** -- never use /tmp for any file I/O on Fly.io.
- [ ] **FFmpeg thread count decided** -- `-threads 1` for shared CPU, adjust if using performance CPU.
- [ ] **Queue technology decided** -- SQLite-backed (recommended) vs Redis+BullMQ (overkill for this project).
- [ ] **ZIP strategy decided** -- stream to response (recommended) vs write to disk (doubles storage).
- [ ] **Deploy safety tested** -- SIGTERM handler works, jobs are marked interrupted, SQLite WAL is checkpointed.

---

## Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Fly.io /tmp RAM disk | HIGH | Confirmed via multiple community posts |
| Upload memory buffering | HIGH | Well-documented Node.js/multer pattern |
| Auto-stop killing jobs | HIGH | Confirmed via Fly.io docs and community reports |
| Storage math (1GB insufficient) | HIGH | Arithmetic from project requirements |
| Deploy downtime with volumes | HIGH | Confirmed via Fly.io docs (bluegreen incompatible with volumes) |
| FFmpeg thread oversubscription | HIGH | Confirmed via Fly.io community FFmpeg thread |
| SQLite locking | HIGH | Extensively documented SQLite behavior |
| Pipe buffer deadlock | HIGH | Documented Node.js + FFmpeg pattern |
| Cold start latency | HIGH | Multiple community reports, 3-10s range |
| FFmpeg filter compatibility | MEDIUM | Likely issue but severity depends on specific filters used |
| Queue architecture decision | HIGH | Based on well-understood project constraints |

---

## Sources

### Fly.io Official & Community
- [Fly.io Volumes Overview](https://fly.io/docs/volumes/overview/) -- volume limitations, single-machine risks
- [Fly.io Autostop/Autostart](https://fly.io/docs/launch/autostop-autostart/) -- auto-stop behavior, min_machines_running
- [Fly.io Machine Sizing](https://fly.io/docs/machines/guides-examples/machine-sizing/) -- shared-cpu memory limits
- [Fly.io Pricing](https://fly.io/docs/about/pricing/) -- volume pricing ($0.15/GB/month)
- [Fly.io Deploy Docs](https://fly.io/docs/launch/deploy/) -- deployment strategies
- [Fly.io Seamless Deployments](https://fly.io/docs/blueprints/seamless-deployments/) -- bluegreen not compatible with volumes
- [Tmp storage and small volumes](https://community.fly.io/t/tmp-storage-and-small-volumes/9854) -- /tmp is RAM disk
- [FFmpeg speed on Fly.io](https://community.fly.io/t/speedup-ffmpeg-video-processing/23584) -- burst CPU behavior
- [Node + FFmpeg deploy issues](https://community.fly.io/t/deploy-node-with-ffmpeg-cannot-find-ffprobe/14893) -- PATH issues
- [Long-running tasks + auto-stop](https://community.fly.io/t/handling-long-running-tasks-with-automatic-machine-shutdown-on-fly-io/24256) -- job loss during auto-stop
- [Cold start issues](https://community.fly.io/t/cold-start-causes-1-minute-timeout-for-first-request-fastapi-nginx/25101) -- 3-10s latency
- [Graceful VM exits](https://fly.io/blog/graceful-vm-exits-some-dials/) -- kill_timeout, SIGTERM handling
- [Volume deploy downtime](https://community.fly.io/t/avoiding-deployment-downtime-when-using-volumes/10705) -- single-machine deploy issues

### Node.js & FFmpeg
- [Multer docs](https://expressjs.com/en/resources/middleware/multer.html) -- disk vs memory storage
- [express-fileupload memory leak](https://github.com/richardgirges/express-fileupload/issues/89) -- buffering issues
- [Node.js child_process docs](https://nodejs.org/api/child_process.html) -- pipe buffer behavior
- [FFmpeg spawn issues](https://github.com/nodejs/help/issues/2731) -- stderr buffer deadlock
- [Node.js spawn buffer size](https://github.com/nodejs/node/issues/41611) -- highWaterMark limitations

### SQLite
- [SQLite WAL mode](https://sqlite.org/wal.html) -- concurrent access behavior
- [SQLite concurrent writes](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/) -- SQLITE_BUSY analysis
- [SQLite on Fly.io](https://fly.io/blog/sqlite-internals-wal/) -- WAL mode recommendations

### FFmpeg Processing
- [FFmpeg scalability guide](https://hoop.dev/blog/ffmpeg-scalability-orchestration-optimization-and-continuous-performance/) -- thread management, resource limits
- [FFmpeg batch processing](https://www.ffmpeg.media/articles/batch-processing-automate-multiple-files) -- concurrent job best practices
- [FFmpeg CPU reduction](https://copyprogramming.com/howto/how-to-reduce-cpu-usage-of-ffmpeg) -- thread limiting, preset selection
