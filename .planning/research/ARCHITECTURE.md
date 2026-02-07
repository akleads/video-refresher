# Architecture: Server-Side Multi-Video Processing on Fly.io

**Project:** Video Refresher v2.0 -- Server-Side Processing Milestone
**Researched:** 2026-02-07
**Confidence:** HIGH (verified via Fly.io docs, community examples, Node.js ecosystem research)

## Executive Summary

This architecture replaces browser-based FFmpeg.wasm processing with a Node.js + native FFmpeg backend on Fly.io, while keeping the existing Cloudflare Pages frontend. The system becomes a two-tier architecture: a static frontend that uploads videos and polls for results, and a Fly.io backend that runs FFmpeg natively in Docker. This eliminates the 100MB browser memory constraint, removes SharedArrayBuffer/COOP/COEP header headaches, and enables fire-and-forget processing (close tab, return later for results).

The key architectural decisions are:
1. **Keep the frontend on Cloudflare Pages** -- it already works, costs nothing, and only needs API integration code added to app.js
2. **Single Fly.io Machine with a Fly Volume** -- no horizontal scaling needed for a personal tool; SQLite on the volume handles job tracking; processed files stored on the same volume
3. **Polling over SSE/WebSockets** -- simpler to implement, works with Fly Proxy autostop, and supports the fire-and-forget use case natively
4. **Custom SQLite-based job queue** -- no Redis dependency, no BullMQ complexity; better-sqlite3 is synchronous and perfect for a single-machine setup
5. **Shared password auth via bearer token** -- simple, sufficient for personal/small-team use

## Current vs. New Architecture

### Current: All Client-Side

```
User Browser
  |
  +-- Cloudflare Pages (static files)
  |     index.html, app.js, styles.css, ffmpeg-worker.js
  |
  +-- CDN Dependencies
  |     @ffmpeg/ffmpeg 0.12.14 (WASM)
  |     @ffmpeg/core 0.12.10 (WASM binary)
  |     JSZip 3.10.1
  |
  +-- In-Browser Processing
        FFmpeg.wasm -> encode -> blob URL -> download
```

**Problems solved by moving server-side:**
- 100MB file size limit (browser memory)
- Slow processing (WASM is 3-10x slower than native FFmpeg)
- Tab must stay open during processing
- SharedArrayBuffer/COOP/COEP header complexity
- Different performance across browsers/devices

### New: Frontend + Backend

```
+---------------------------+          +----------------------------------+
| Cloudflare Pages          |          | Fly.io (single Machine)          |
| (static frontend)         |          | Docker: Node.js + native FFmpeg  |
|                           |   HTTPS  |                                  |
| index.html                | -------> | Express API server               |
| app.js (modified)         |          |   POST /api/jobs                 |
| styles.css                |          |   GET  /api/jobs/:id             |
|                           |          |   GET  /api/jobs/:id/download    |
|                           |          |   POST /api/auth                 |
|                           |          |                                  |
| No more:                  |          | Fly Volume (/data, 1GB)          |
|   ffmpeg-worker.js        |          |   /data/db/jobs.sqlite           |
|   FFmpeg.wasm CDN deps    |          |   /data/uploads/                 |
|   JSZip (server zips now) |          |   /data/output/                  |
+---------------------------+          +----------------------------------+
```

## Component Architecture

### Component 1: Express API Server

**Responsibility:** HTTP API for upload, job management, and file download
**Technology:** Express.js (stable, well-documented, Fly.io compatible)
**Location:** `server/index.js` (entrypoint), `server/routes/`

**Endpoints:**

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| `POST` | `/api/auth` | Exchange password for session token | No |
| `POST` | `/api/jobs` | Upload video(s), create processing job | Yes |
| `GET` | `/api/jobs` | List all jobs for session | Yes |
| `GET` | `/api/jobs/:id` | Get job status, progress, results | Yes |
| `GET` | `/api/jobs/:id/download` | Download single processed file | Yes |
| `GET` | `/api/jobs/:id/download-all` | Download ZIP of all variations | Yes |
| `DELETE` | `/api/jobs/:id` | Cancel job / delete results | Yes |
| `GET` | `/api/health` | Health check (for Fly.io) | No |

**Request/Response patterns:**

```
POST /api/jobs
  Content-Type: multipart/form-data
  Authorization: Bearer <token>
  Body: { files: [video1.mp4, video2.mp4], variations: 5 }

  Response 201:
  {
    "job_id": "abc123",
    "status": "queued",
    "files": [
      { "name": "video1.mp4", "size": 5242880 },
      { "name": "video2.mp4", "size": 3145728 }
    ],
    "variations": 5,
    "total_outputs": 10,
    "created_at": "2026-02-07T10:00:00Z"
  }

GET /api/jobs/:id
  Response 200:
  {
    "job_id": "abc123",
    "status": "processing",  // queued | processing | complete | failed | cancelled
    "progress": {
      "current_file": "video1.mp4",
      "current_variation": 3,
      "total_variations": 10,
      "percent": 45
    },
    "results": [
      { "id": "out1", "name": "video1_var1_a1b2c3.mp4", "size": 4800000, "ready": true },
      { "id": "out2", "name": "video1_var2_d4e5f6.mp4", "size": 4900000, "ready": true }
    ],
    "created_at": "2026-02-07T10:00:00Z",
    "expires_at": "2026-02-08T10:00:00Z"
  }
```

**Build dependency:** None -- this is the foundation

---

### Component 2: File Upload Handler (Multer)

**Responsibility:** Accept multipart file uploads, stream to disk (not memory)
**Technology:** Multer with disk storage engine
**Location:** `server/middleware/upload.js`

**Why disk storage, not memory storage:**
- Videos can be 500MB+; memory storage would crash the 1GB RAM Machine
- Disk storage streams directly to Fly Volume, never holding full file in RAM
- Multer's disk engine writes a temp file, then the job processor moves it

**Configuration:**

```javascript
const multer = require('multer');

const storage = multer.diskStorage({
  destination: '/data/uploads/',
  filename: (req, file, cb) => {
    const uniqueId = crypto.randomUUID();
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueId}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB per file
    files: 10                      // max 10 files per request
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only video files allowed'), false);
  }
});
```

**Build dependency:** Requires Component 1 (Express server)

---

### Component 3: SQLite Job Queue (better-sqlite3)

**Responsibility:** Persist job state, track progress, support fire-and-forget
**Technology:** better-sqlite3 (synchronous, fastest SQLite for Node.js, no external dependencies)
**Location:** `server/db.js`, database file at `/data/db/jobs.sqlite`

**Why better-sqlite3 over BullMQ/Redis:**
- No Redis server needed (saves cost, reduces complexity)
- SQLite lives on Fly Volume -- survives Machine restarts
- Synchronous API is perfect for single-Machine, single-process architecture
- Job state persists across deploys (volume is persistent)
- better-sqlite3 is the recommended SQLite library for Fly.io Node.js apps

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued',    -- queued|processing|complete|failed|cancelled
  password_hash TEXT NOT NULL,              -- ties job to authenticated session
  variations_per_file INTEGER NOT NULL DEFAULT 1,
  progress_current INTEGER DEFAULT 0,
  progress_total INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL                  -- 24h from creation
);

CREATE TABLE IF NOT EXISTS job_files (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  upload_path TEXT NOT NULL,               -- /data/uploads/<uuid>.mp4
  file_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_outputs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  job_file_id TEXT NOT NULL REFERENCES job_files(id),
  output_name TEXT NOT NULL,               -- video1_var1_a1b2c3.mp4
  output_path TEXT NOT NULL,               -- /data/output/<job_id>/<name>.mp4
  file_size INTEGER,
  effects_json TEXT,                       -- JSON of applied effects
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|processing|complete|failed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_expires ON jobs(expires_at);
CREATE INDEX idx_outputs_job ON job_outputs(job_id);
```

**Job lifecycle:**

```
1. POST /api/jobs -> INSERT job (status='queued')
                  -> INSERT job_files (one per uploaded file)
                  -> INSERT job_outputs (variations_per_file * files count)
                  -> Emit to in-process queue

2. Worker picks up -> UPDATE job SET status='processing'
                   -> For each output:
                        UPDATE job_outputs SET status='processing'
                        Run FFmpeg
                        UPDATE job_outputs SET status='complete', file_size=X
                        UPDATE job SET progress_current = progress_current + 1

3. All done -> UPDATE job SET status='complete'
4. 24h later -> Cleanup cron deletes files + DB rows
```

**Build dependency:** None -- can be built in parallel with Component 1

---

### Component 4: FFmpeg Processing Engine

**Responsibility:** Execute native FFmpeg commands for video variations
**Technology:** Node.js `child_process.spawn()` with native FFmpeg binary
**Location:** `server/processor.js`

**Why spawn over fluent-ffmpeg:**
- fluent-ffmpeg was archived (May 2025, confirmed via WebSearch) -- no longer maintained
- Direct spawn gives full control over FFmpeg arguments
- Progress parsing from stderr is straightforward
- No abstraction layer to debug when things go wrong
- Fewer dependencies

**Processing flow:**

```javascript
const { spawn } = require('child_process');

function processVideo(inputPath, outputPath, effects) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-vf', buildFilterChain(effects),
      '-r', '29.97',
      '-b:v', '2000k',
      '-bufsize', '4000k',
      '-maxrate', '2500k',
      '-preset', 'medium',        // Native FFmpeg: 'medium' is fast enough
      '-crf', '23',
      '-map_metadata', '-1',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y',                        // Overwrite output
      outputPath
    ];

    const ffmpeg = spawn('ffmpeg', args);
    let duration = null;

    ffmpeg.stderr.on('data', (data) => {
      const line = data.toString();

      // Parse duration from input info
      const durMatch = line.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (durMatch) {
        duration = parseFloat(durMatch[1]) * 3600 +
                   parseFloat(durMatch[2]) * 60 +
                   parseFloat(durMatch[3]);
      }

      // Parse current time for progress
      const timeMatch = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch && duration) {
        const current = parseFloat(timeMatch[1]) * 3600 +
                        parseFloat(timeMatch[2]) * 60 +
                        parseFloat(timeMatch[3]);
        const percent = Math.min(100, Math.round((current / duration) * 100));
        // Update progress in SQLite
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });

    ffmpeg.on('error', reject);
  });
}
```

**Effect generation (carried over from existing app.js logic):**

```javascript
function buildFilterChain(effects) {
  return `rotate=${effects.rotation}:fillcolor=black@0,` +
         `eq=brightness=${effects.brightness}:` +
         `contrast=${effects.contrast}:` +
         `saturation=${effects.saturation}`;
}

function generateEffects() {
  return {
    rotation: randomInRange(0.001, 0.01),
    brightness: randomInRange(-0.05, 0.05),
    contrast: randomInRange(0.95, 1.05),
    saturation: randomInRange(0.95, 1.05)
  };
}
```

**Key improvement over client-side:**
- Native FFmpeg `medium` preset produces better quality than WASM `ultrafast`
- No 100MB memory limit -- process 500MB files on a 1GB Machine (FFmpeg streams, doesn't load entire file)
- Native FFmpeg is 3-10x faster than WASM for encoding

**Build dependency:** Requires Component 3 (job queue for progress updates)

---

### Component 5: In-Process Job Worker

**Responsibility:** Process jobs sequentially from the SQLite queue
**Technology:** Simple setInterval polling loop within the same Node.js process
**Location:** `server/worker.js`

**Why in-process, not separate worker:**
- Single Machine, single process is simpler to deploy and debug
- No IPC needed -- direct access to SQLite via better-sqlite3
- Fly.io auto-stop works correctly with single process (process.exit on idle)
- If the job queue grows, can always split later (YAGNI)

**Worker loop:**

```javascript
class JobWorker {
  constructor(db, processor) {
    this.db = db;
    this.processor = processor;
    this.currentJob = null;
    this.interval = null;
  }

  start() {
    this.interval = setInterval(() => this.tick(), 2000);
  }

  async tick() {
    if (this.currentJob) return; // Already processing

    // Find next queued job (FIFO)
    const job = this.db.prepare(
      `SELECT * FROM jobs WHERE status = 'queued'
       ORDER BY created_at ASC LIMIT 1`
    ).get();

    if (!job) return;

    this.currentJob = job.id;
    try {
      await this.processJob(job);
    } catch (err) {
      this.db.prepare(
        `UPDATE jobs SET status = 'failed', error_message = ?,
         updated_at = datetime('now') WHERE id = ?`
      ).run(err.message, job.id);
    } finally {
      this.currentJob = null;
    }
  }

  async processJob(job) {
    this.db.prepare(
      `UPDATE jobs SET status = 'processing', updated_at = datetime('now')
       WHERE id = ?`
    ).run(job.id);

    const files = this.db.prepare(
      `SELECT * FROM job_files WHERE job_id = ?`
    ).all(job.id);

    const outputs = this.db.prepare(
      `SELECT * FROM job_outputs WHERE job_id = ? ORDER BY id`
    ).all(job.id);

    let completed = 0;
    for (const output of outputs) {
      // Check for cancellation
      const current = this.db.prepare(
        `SELECT status FROM jobs WHERE id = ?`
      ).get(job.id);
      if (current.status === 'cancelled') break;

      const file = files.find(f => f.id === output.job_file_id);
      const effects = JSON.parse(output.effects_json);

      await this.processor.processVideo(
        file.upload_path,
        output.output_path,
        effects,
        (percent) => {
          // Progress callback
          this.db.prepare(
            `UPDATE jobs SET progress_current = ?,
             updated_at = datetime('now') WHERE id = ?`
          ).run(completed * 100 + percent, job.id);
        }
      );

      // Mark output complete
      const stat = fs.statSync(output.output_path);
      this.db.prepare(
        `UPDATE job_outputs SET status = 'complete', file_size = ?
         WHERE id = ?`
      ).run(stat.size, output.id);

      completed++;
      this.db.prepare(
        `UPDATE jobs SET progress_current = ?,
         updated_at = datetime('now') WHERE id = ?`
      ).run(completed * 100, job.id);
    }

    this.db.prepare(
      `UPDATE jobs SET status = 'complete', updated_at = datetime('now')
       WHERE id = ?`
    ).run(job.id);
  }
}
```

**Build dependency:** Requires Component 3 (SQLite) and Component 4 (FFmpeg processor)

---

### Component 6: Authentication Middleware

**Responsibility:** Shared password auth, session tokens
**Technology:** Express middleware, crypto for token generation
**Location:** `server/middleware/auth.js`

**Design: Simple shared password with bearer token**

Why this approach:
- Single shared password set via `AUTH_PASSWORD` env var on Fly.io
- No user accounts, no database users table, no OAuth complexity
- Client sends password, gets back a token valid for 24h
- Token is a signed HMAC of password + timestamp (no JWT dependency needed)

```javascript
const crypto = require('crypto');

const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

function generateToken() {
  const timestamp = Date.now().toString();
  const hmac = crypto.createHmac('sha256', TOKEN_SECRET)
    .update(timestamp)
    .digest('hex');
  return Buffer.from(`${timestamp}:${hmac}`).toString('base64');
}

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const [timestamp, hmac] = decoded.split(':');

    // Check expiry (24h)
    if (Date.now() - parseInt(timestamp) > 24 * 60 * 60 * 1000) return false;

    // Verify HMAC
    const expected = crypto.createHmac('sha256', TOKEN_SECRET)
      .update(timestamp)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Middleware
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required' });
  }
  const token = authHeader.slice(7);
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  next();
}
```

**Build dependency:** Requires Component 1 (Express server)

---

### Component 7: Cleanup Scheduler

**Responsibility:** Delete expired jobs, uploads, and output files
**Technology:** setInterval cron within Node.js process
**Location:** `server/cleanup.js`

**Why it matters:**
- 1GB Fly Volume is the constraint -- must reclaim space
- 24h expiry prevents unbounded growth
- Runs every hour, deletes jobs older than 24h

```javascript
function runCleanup(db) {
  // Find expired jobs
  const expired = db.prepare(
    `SELECT id FROM jobs WHERE expires_at < datetime('now')`
  ).all();

  for (const job of expired) {
    // Delete output files
    const outputs = db.prepare(
      `SELECT output_path FROM job_outputs WHERE job_id = ?`
    ).all(job.id);
    for (const out of outputs) {
      try { fs.unlinkSync(out.output_path); } catch {}
    }

    // Delete upload files
    const files = db.prepare(
      `SELECT upload_path FROM job_files WHERE job_id = ?`
    ).all(job.id);
    for (const file of files) {
      try { fs.unlinkSync(file.upload_path); } catch {}
    }

    // Delete output directory
    try { fs.rmdirSync(`/data/output/${job.id}`); } catch {}

    // Delete DB rows (CASCADE handles job_files and job_outputs)
    db.prepare(`DELETE FROM jobs WHERE id = ?`).run(job.id);
  }

  console.log(`Cleanup: removed ${expired.length} expired jobs`);
}

// Run every hour
setInterval(() => runCleanup(db), 60 * 60 * 1000);
```

**Build dependency:** Requires Component 3 (SQLite)

---

### Component 8: Modified Frontend (app.js)

**Responsibility:** Replace FFmpeg.wasm processing with API calls to backend
**Technology:** Fetch API, FormData for uploads
**Location:** Existing `app.js` (modified), existing `index.html` (modified)

**What stays:**
- Upload UI (drag-drop, file selection) -- keep as-is
- Variation count input -- keep as-is
- Progress bar UI -- keep as-is
- Processed videos grid -- keep as-is
- Download buttons -- redirect to server download URLs

**What gets removed:**
- FFmpeg.wasm loading and initialization (lines 1-173)
- In-browser processVideo function (lines 541-716)
- In-browser generateBatch function (lines 718-831)
- ffmpeg-worker.js (entire file)
- JSZip dependency (server creates ZIPs now)
- BlobURLRegistry (no more blob URLs for processed videos)
- SharedArrayBuffer detection (no longer needed)

**What gets added:**
- Login screen (password input -> POST /api/auth -> store token)
- Upload via FormData to POST /api/jobs
- Polling loop: GET /api/jobs/:id every 2 seconds while status != complete
- Download links pointing to /api/jobs/:id/download and /api/jobs/:id/download-all
- Job listing (GET /api/jobs to show all active/completed jobs)

**Frontend flow:**

```
1. Login:      Password -> POST /api/auth -> store Bearer token in sessionStorage
2. Upload:     Files + variation count -> POST /api/jobs (multipart)
3. Poll:       setInterval -> GET /api/jobs/:id -> update progress bar
4. Complete:   Show download buttons -> GET /api/jobs/:id/download-all
5. Close tab:  No problem -- job continues on server
6. Return:     GET /api/jobs -> see all jobs -> download results
```

**Estimated size reduction:** app.js goes from ~1001 LOC to ~400 LOC (remove all FFmpeg logic, add API client logic)

**Build dependency:** Requires Component 1 (API endpoints) to be defined first

## Data Flow

### Upload and Processing Flow

```
Browser                          Fly.io Backend
  |                                    |
  |-- POST /api/jobs ----------------->|
  |   (multipart: video files)         |
  |                                    |-- Multer streams to /data/uploads/
  |                                    |-- INSERT jobs, job_files, job_outputs
  |                                    |-- Return job_id
  |<-- 201 { job_id: "abc123" } -------|
  |                                    |
  |                                    |-- Worker picks up job
  |                                    |-- For each file x variation:
  |                                    |     spawn ffmpeg
  |-- GET /api/jobs/abc123 ----------->|     /data/uploads/X -> /data/output/abc123/Y
  |<-- { status: processing, 45% } ----|     UPDATE progress in SQLite
  |                                    |
  |-- GET /api/jobs/abc123 ----------->|
  |<-- { status: complete, results } --|
  |                                    |
  |-- GET /api/jobs/abc123/download-all|
  |<-- ZIP stream (/data/output/...) --|  (archiver library streams ZIP)
  |                                    |
  |                              [24h later]
  |                                    |-- Cleanup: delete files + DB rows
```

### File System Layout on Fly Volume

```
/data/                          # Fly Volume mount point
  db/
    jobs.sqlite                 # SQLite database
  uploads/
    <uuid>.mp4                  # Uploaded originals (deleted after processing or 24h)
  output/
    <job_id>/
      video1_var1_a1b2c3.mp4   # Processed variations
      video1_var2_d4e5f6.mp4
      video2_var1_g7h8i9.mp4
```

### Storage Budget (1GB Volume)

| Item | Estimate | Notes |
|------|----------|-------|
| SQLite DB | <1MB | Job metadata only, rows cleaned after 24h |
| Upload files | 100-500MB | Deleted after job completes or 24h |
| Output files | 100-500MB | Variations, typically similar size to input |
| Headroom | 200MB+ | Safety margin |

**Constraint management:**
- Reject uploads that would exceed 80% volume capacity (check `df` before accepting)
- Delete upload files immediately after all variations processed (not after 24h)
- Single concurrent job ensures predictable disk usage

## Deployment Architecture

### Dockerfile

```dockerfile
FROM node:20-alpine

# Install native FFmpeg
RUN apk add --no-cache ffmpeg

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy application code
COPY server/ ./server/

# Create data directories (will be overridden by volume mount)
RUN mkdir -p /data/db /data/uploads /data/output

EXPOSE 8080

CMD ["node", "server/index.js"]
```

### fly.toml

```toml
app = "video-refresher-api"
primary_region = "iad"

[build]

[env]
  NODE_ENV = "production"
  PORT = "8080"
  DATA_DIR = "/data"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[mounts]
  source = "data"
  destination = "/data"

[[vm]]
  size = "shared-cpu-1x"
  memory = "1gb"
```

### Key Fly.io Configuration Details

**Auto-stop behavior:**
- Machine stops when no HTTP requests for ~5 minutes
- BUT: Must not stop during active FFmpeg processing
- Solution: The worker loop keeps the process alive; Fly Proxy sees active connections (polling requests) and won't stop the Machine while a job is processing
- When idle (no jobs, no polling), Machine stops -- costs nothing

**Costs (verified from Fly.io pricing):**
- shared-cpu-1x + 1GB RAM: ~$5.70/month at full uptime
- With auto-stop (personal use, maybe 2h/day active): ~$0.50/month
- 1GB Volume: $0.15/month
- **Total estimated: $1-6/month depending on usage**

**Volume persistence:**
- Volume survives Machine restarts and deploys
- Volume does NOT replicate across regions (single-region is fine for personal tool)
- Volume snapshots cost extra as of Jan 2026 -- disable if not needed

### CORS Configuration

Frontend on Cloudflare Pages (e.g., `video-refresher.pages.dev`) needs to call the Fly.io API (e.g., `video-refresher-api.fly.dev`). CORS headers required:

```javascript
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://video-refresher.pages.dev',
    'http://localhost:8000'  // local dev
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
```

## Patterns to Follow

### Pattern 1: Streaming ZIP Download (Never Buffer Entire ZIP)

**What:** Use `archiver` library to stream ZIP directly to HTTP response
**Why:** A ZIP of 10 variations at 50MB each = 500MB. Cannot buffer that in 1GB RAM.

```javascript
const archiver = require('archiver');

app.get('/api/jobs/:id/download-all', requireAuth, (req, res) => {
  const outputs = db.prepare(
    `SELECT * FROM job_outputs WHERE job_id = ? AND status = 'complete'`
  ).all(req.params.id);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="variations.zip"');

  const archive = archiver('zip', { store: true }); // No compression for video
  archive.pipe(res);

  for (const out of outputs) {
    archive.file(out.output_path, { name: out.output_name });
  }

  archive.finalize();
});
```

### Pattern 2: Disk-Based Processing (Never Hold Video in RAM)

**What:** FFmpeg reads from disk, writes to disk. Node.js never touches video bytes.
**Why:** 1GB Machine RAM. Videos can be 500MB. Must stay on disk.

```
Input file on disk -> FFmpeg reads from disk -> Output file on disk
                      (streamed internally)
Node.js only:
  - Passes file paths to FFmpeg (strings, not buffers)
  - Reads/writes SQLite metadata (tiny)
  - Streams ZIP from disk files to HTTP response
```

### Pattern 3: Polling with Exponential Backoff

**What:** Frontend polls GET /api/jobs/:id, starting at 2s intervals, backing off to 10s
**Why:** Keeps Fly Machine awake during processing; doesn't waste bandwidth when idle

```javascript
// Frontend polling
async function pollJob(jobId) {
  let interval = 2000; // Start at 2s
  const maxInterval = 10000;

  while (true) {
    const res = await fetch(`${API_URL}/api/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const job = await res.json();

    updateProgressUI(job);

    if (job.status === 'complete' || job.status === 'failed') break;

    await sleep(interval);
    interval = Math.min(interval * 1.2, maxInterval); // Gradual backoff
  }
}
```

### Pattern 4: Graceful Shutdown for Active Jobs

**What:** Handle SIGTERM (Fly.io sends this before stopping Machine) by finishing current FFmpeg process
**Why:** Don't leave half-processed files; mark job as queued so it resumes on next start

```javascript
let activeFFmpegProcess = null;

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');

  // Stop accepting new requests
  server.close();

  // If FFmpeg is running, let it finish (up to 30s)
  if (activeFFmpegProcess) {
    console.log('Waiting for active FFmpeg process to complete...');
    // Fly.io gives ~10s grace period by default
    // Could kill FFmpeg and mark job as queued for retry
    activeFFmpegProcess.kill('SIGTERM');
    db.prepare(
      `UPDATE jobs SET status = 'queued' WHERE status = 'processing'`
    ).run();
  }

  process.exit(0);
});
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Buffering Upload Files in Memory

**What:** Using `multer({ storage: multer.memoryStorage() })`
**Why bad:** A 500MB video upload would consume 500MB of 1GB RAM, leaving nothing for FFmpeg
**Instead:** Always use `multer.diskStorage()` with destination on the Fly Volume

### Anti-Pattern 2: Reading FFmpeg Output into Node.js Buffer

**What:** `fs.readFileSync(outputPath)` before sending to client
**Why bad:** Loads entire processed video into RAM. With 1GB Machine and 500MB video, this crashes.
**Instead:** Stream files: `res.sendFile(outputPath)` or `fs.createReadStream(outputPath).pipe(res)`

### Anti-Pattern 3: Server-Sent Events with Fly.io Auto-Stop

**What:** Using SSE for progress updates instead of polling
**Why bad:** SSE keeps a persistent connection open. Fly Proxy auto-stop considers connections when deciding to stop the Machine. A lingering SSE connection can prevent auto-stop OR (worse) Fly Proxy may close the connection when the Machine is stopped, causing the client to lose the event stream.
**Instead:** Polling works naturally with auto-stop. When the Machine is stopped, the next poll request wakes it up.

### Anti-Pattern 4: Using fluent-ffmpeg

**What:** Installing fluent-ffmpeg as the FFmpeg wrapper
**Why bad:** The library was archived on May 22, 2025. It is no longer maintained. Known issues with progress reporting (percent returning NaN for large files) will never be fixed.
**Instead:** Use `child_process.spawn('ffmpeg', args)` directly. Parse stderr for progress. More code, but full control and no dead dependency.

### Anti-Pattern 5: Multiple Machines / Horizontal Scaling

**What:** Running 2+ Fly.io Machines for "redundancy" or "scaling"
**Why bad:** Fly Volumes are local to a single Machine. Two Machines cannot share a volume. You'd need network storage (S3, Tigris), which adds latency, complexity, and cost. This is a personal tool, not a SaaS product.
**Instead:** Single Machine, single volume. If it's slow, upgrade to shared-cpu-2x. Vertical scaling is simpler and cheaper.

## Integration Points with Existing Components

### What Changes in Existing Files

| File | Change | Scope |
|------|--------|-------|
| `app.js` | Major rewrite: remove FFmpeg.wasm, add API client | ~600 lines removed, ~300 added |
| `index.html` | Add login form, update info text, remove COOP/COEP meta | Minor modifications |
| `styles.css` | Add login form styles, job list styles | Additive only |
| `ffmpeg-worker.js` | DELETE entirely | No longer needed |
| `_headers` | Remove COOP/COEP headers (no longer needed for SharedArrayBuffer) | Simplification |
| `package.json` | Add server dependencies, update scripts | Major update |

### What's New

| File/Directory | Purpose |
|----------------|---------|
| `server/index.js` | Express server entrypoint |
| `server/routes/auth.js` | Authentication routes |
| `server/routes/jobs.js` | Job CRUD routes |
| `server/middleware/auth.js` | Bearer token middleware |
| `server/middleware/upload.js` | Multer configuration |
| `server/db.js` | SQLite schema + queries |
| `server/worker.js` | Job processing worker |
| `server/processor.js` | FFmpeg spawn wrapper |
| `server/cleanup.js` | Expired job cleanup |
| `server/effects.js` | Random effect generator (ported from app.js) |
| `Dockerfile` | Docker image for Fly.io |
| `fly.toml` | Fly.io app configuration |
| `.dockerignore` | Exclude frontend files from Docker build |

### What Stays Unchanged

| File | Reason |
|------|--------|
| `styles.css` (mostly) | Visual design stays the same |
| `wrangler.toml` | Frontend still deploys to Cloudflare Pages |
| `server.py` | Local dev server (still useful for frontend development) |

## Suggested Build Order

The build order considers dependencies, testability, and ability to verify each phase independently.

### Phase 1: Backend Foundation (API + DB + Auth)

Build the server skeleton that can accept requests and store job records, without any FFmpeg processing yet.

**Components:** 1 (Express), 3 (SQLite), 6 (Auth)
**Deliverable:** Server that accepts uploads, stores in SQLite, returns job status -- FFmpeg processing is stubbed
**Testable via:** curl commands to all endpoints, verify SQLite contents
**Why first:** Everything else depends on the API contract being defined and working

### Phase 2: FFmpeg Processing Engine

Add actual video processing to the backend, turning the stub into a working processor.

**Components:** 4 (FFmpeg processor), 5 (Worker)
**Deliverable:** Jobs submitted via API are actually processed by FFmpeg; progress updates in SQLite
**Testable via:** Submit job via curl, poll for completion, verify output files exist on volume
**Why second:** Core value -- the whole point of moving server-side

### Phase 3: Download and Cleanup

Add file download endpoints and automatic cleanup of expired data.

**Components:** ZIP streaming, download routes, 7 (Cleanup)
**Deliverable:** Complete backend -- upload, process, download, cleanup lifecycle
**Testable via:** Full workflow via curl -- upload video, wait for processing, download ZIP, verify cleanup after 24h

### Phase 4: Frontend Integration

Modify the existing app.js to call the backend API instead of FFmpeg.wasm.

**Components:** 8 (Modified frontend)
**Deliverable:** Working end-to-end application -- existing UI talks to new backend
**Testable via:** Full user workflow in browser

### Phase 5: Deployment and Polish

Deploy to Fly.io, configure auto-stop, verify fire-and-forget, polish edge cases.

**Deliverable:** Production-deployed system with auto-stop, volume persistence, graceful shutdown
**Testable via:** Deploy, process a video, stop Machine, return and download results

### Dependency Graph

```
Phase 1: API + DB + Auth
    |
    v
Phase 2: FFmpeg Processing
    |
    v
Phase 3: Downloads + Cleanup
    |
    v
Phase 4: Frontend Rewrite
    |
    v
Phase 5: Deploy + Polish
```

All phases are sequential. Each phase produces a testable artifact.

## Scalability Path (If Needed Later)

| Growth Stage | What to Do | Effort |
|-------------|-----------|--------|
| Processing too slow | Upgrade VM: shared-cpu-2x or performance-cpu-1x | fly.toml change, <5 min |
| Disk too small | Extend volume: `fly volumes extend` to 5GB or 10GB | CLI command, <5 min |
| Need concurrent jobs | Add job priority + limited concurrency (2 FFmpeg processes) | Code change, ~2h |
| Multiple users | Add real auth (user accounts, JWT, separate job namespaces) | Code change, ~1 day |
| High volume | Move files to Tigris (S3-compatible on Fly.io), allow multi-Machine | Architecture change, ~1 week |

For a personal tool, the single-Machine architecture will handle the workload for years.

## Sources

### HIGH Confidence
- Existing codebase analysis (app.js, index.html, ffmpeg-worker.js) -- directly examined
- [Fly.io Volumes overview](https://fly.io/docs/volumes/overview/) -- official docs on volume behavior and limitations
- [Fly.io Autostop/Autostart](https://fly.io/docs/launch/autostop-autostart/) -- verified auto-stop behavior and configuration
- [Fly.io fly.toml configuration](https://fly.io/docs/reference/configuration/) -- verified mounts and http_service config
- [Fly.io Node.js Dockerfile](https://github.com/fly-apps/dockerfile-node) -- official Node.js Dockerfile patterns
- [Fly.io community: FFmpeg installation](https://community.fly.io/t/install-ffmpeg-in-the-v2/12130) -- confirmed `apk add ffmpeg` approach
- [Express multer middleware](https://expressjs.com/en/resources/middleware/multer.html) -- official Multer docs
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) -- confirmed synchronous API, performance claims

### MEDIUM Confidence
- [Fly.io pricing](https://fly.io/docs/about/pricing/) -- verified shared-cpu-1x + 1GB pricing at ~$5.70/month
- [fluent-ffmpeg archived](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) -- confirmed archived May 2025
- [Fly.io Volumes pricing](https://fly.io/docs/about/pricing/) -- $0.15/GB/month, snapshot charges from Jan 2026
- [Node.js SSE patterns](https://masteringjs.io/tutorials/express/server-sent-events) -- verified SSE implementation but not tested with Fly Proxy
- [SQLite job queue patterns](https://jasongorman.uk/writing/sqlite-background-job-system/) -- community pattern, not a library

### LOW Confidence (Needs Validation)
- FFmpeg native vs WASM performance claim (3-10x) -- general knowledge, not benchmarked for this specific use case
- Auto-stop interaction with polling -- should work per docs, but needs testing with actual Fly.io deployment
- 1GB RAM sufficiency for FFmpeg processing 500MB files -- FFmpeg streams internally, but needs empirical validation

---

*Architecture research completed: 2026-02-07*
*Replaces previous client-side batch processing architecture document*
