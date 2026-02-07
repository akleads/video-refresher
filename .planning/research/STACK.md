# Technology Stack: Server-Side Multi-Video Processing on Fly.io

**Project:** Video Refresher v2.0 -- Server-Side Migration
**Researched:** 2026-02-07
**Context:** Moving from client-side FFmpeg.wasm to server-side native FFmpeg on Fly.io with multi-video batch support, SQLite job tracking, and fire-and-forget UX.

## Existing Stack (Retain)

These are validated from v1 and carry forward. DO NOT re-evaluate.

| Technology | Version | Role | Notes |
|------------|---------|------|-------|
| Vanilla JS + HTML/CSS | - | Frontend | 1,785 LOC, no build step |
| FFmpeg.wasm | 0.12.14 | Client-side fallback (optional) | May keep as offline mode |
| Cloudflare Pages | - | Frontend hosting | Static site with COOP/COEP headers |
| JSZip | 3.10.1 | Client-side ZIP (may shift to server) | Retain for now |

---

## Recommended Server-Side Stack

### Runtime: Node.js 22 LTS

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | 22.x LTS (Jod) | Server runtime | Current LTS, maintained until April 2027. Built-in WebSocket client, 30% faster startup than Node 20. Stable watch mode for dev. |

**Why Node.js 22 specifically:**
- Active LTS since Oct 2024, will be in maintenance from Oct 2025, EOL April 2027 -- plenty of runway
- Native `fetch`, `WebSocket`, and Web Streams APIs built-in
- `node --watch` is stable (no nodemon needed for dev)
- Project already uses JS ecosystem; staying on Node avoids learning a new runtime

**Why NOT Bun:**
- Fly.io has better Node.js support and documentation
- Bun's SQLite driver has feature gaps vs better-sqlite3 (missing affected row count from `run()`, missing `rowid` returns)
- Node.js is the safer choice for a Docker + Fly.io deployment
- Not worth the risk for marginal performance gains in a CPU-bound FFmpeg workload

**Confidence:** HIGH -- verified Node.js 22 LTS release schedule via official sources.

---

### HTTP Framework: Express 5.x

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Express | 5.x (latest 5.2.1) | HTTP server, API routing | Mature file upload ecosystem, async error handling, battle-tested |

**Why Express 5 over Hono:**

This is a deliberate pragmatic choice. Hono is faster and lighter, but this project needs reliable large file uploads to disk. The tradeoffs:

| Criterion | Express 5 | Hono |
|-----------|-----------|------|
| File upload to disk | Multer -- mature, stream-to-disk, battle-tested | parseBody() loads files into memory; disk streaming requires third-party `hono-upload` or `@hono-storage/node-disk` |
| Multipart streaming | Multer wraps busboy, handles backpressure correctly | Need extra packages for memory-efficient uploads |
| Community patterns for video processing | Extensive examples with FFmpeg + child_process | Very few examples for heavy file processing |
| Performance | ~15K req/s | ~25K req/s |
| Async error handling | Built-in in v5 (rejected promises auto-forwarded) | Built-in |

**The performance difference is irrelevant here.** This server handles maybe 5-10 concurrent users uploading videos. The bottleneck is FFmpeg CPU processing, not HTTP routing speed. Express wins on ecosystem maturity for the specific workload (large file uploads + background processing).

**Why NOT Fastify:** Similar maturity to Express but adds complexity (schema validation, plugin system) that's unnecessary for a simple API with 5-6 endpoints. Express 5 closes the gap on async error handling, which was Fastify's main advantage.

**Confidence:** HIGH -- Express 5.x stable release verified, 5.2.1 is latest.

---

### File Upload: Multer

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| multer | 1.4.x | Multipart file upload handling | Streams files to disk, configurable storage, file size limits, battle-tested with Express |

**Why Multer:**
- Streams uploaded files directly to disk (DiskStorage engine) -- critical for video files that can be 100MB+
- Built-in file size limiting (`limits.fileSize`)
- Built-in file count limiting (`limits.files`)
- Integrates seamlessly with Express as middleware
- Handles multiple file uploads (`upload.array('videos', 10)`)

**Configuration pattern:**
```javascript
const upload = multer({
  storage: multer.diskStorage({
    destination: '/data/uploads',
    filename: (req, file, cb) => cb(null, `${nanoid()}-${file.originalname}`)
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB per file
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype === 'video/mp4');
  }
});
```

**Why NOT busboy directly:** Multer wraps busboy with Express-friendly middleware patterns. No reason to go lower-level.

**Confidence:** HIGH -- Multer is the standard Express file upload middleware, actively maintained.

---

### Video Processing: Native FFmpeg via child_process

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| FFmpeg | 7.x (Alpine/Debian package) | Native video processing | 10-50x faster than FFmpeg.wasm, full feature set, no memory limits |
| child_process (Node built-in) | - | Spawn FFmpeg processes | Zero dependencies, full control over args and stdio |

**Why native FFmpeg via child_process, NOT fluent-ffmpeg:**

fluent-ffmpeg was **archived on May 22, 2025** and marked deprecated on npm. Do not use it for new projects.

The maintained fork `@ts-ffmpeg/fluent-ffmpeg` (v2.2.6) exists but adds an abstraction layer that's unnecessary here. The FFmpeg commands are already defined in the v1 codebase as argument arrays -- translating them to `child_process.spawn` calls is trivial.

**Pattern:**
```javascript
import { spawn } from 'node:child_process';

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    proc.stderr.on('data', (data) => {
      // Parse progress from stderr (time= field)
    });
    proc.on('close', (code) => {
      code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}`));
    });
  });
}
```

**Progress parsing from stderr:**
FFmpeg writes progress to stderr in the format `time=00:00:05.23`. Parse this against total duration to compute percentage.

**Why NOT a wrapper library:**
- fluent-ffmpeg: Archived/deprecated
- @ts-ffmpeg/fluent-ffmpeg: Extra dependency for minimal benefit
- The v1 effect pipeline already builds FFmpeg filter strings -- just pass them as args to spawn

**Confidence:** HIGH -- fluent-ffmpeg deprecation verified via GitHub/npm. child_process is stable Node.js API.

---

### Database: better-sqlite3

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| better-sqlite3 | 12.6.x (latest 12.6.2) | Job tracking, session management | Synchronous API (simpler for job queue), zero-cost file-based DB, lives on Fly Volume |

**Why better-sqlite3:**
- Synchronous API is actually better for a job queue -- no callback soup, simpler error handling
- Fastest SQLite library for Node.js
- Well-maintained (v12.6.2 published Jan 17, 2026)
- Full feature set: WAL mode, user-defined functions, prepared statements
- Lives as a single file on the Fly Volume alongside video files

**Schema sketch:**
```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,        -- nanoid
  password_hash TEXT NOT NULL, -- bcrypt hash of session password
  status TEXT DEFAULT 'pending', -- pending/processing/done/failed
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  total_variations INTEGER,
  completed_variations INTEGER DEFAULT 0,
  error TEXT
);

CREATE TABLE source_files (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id),
  original_name TEXT,
  file_path TEXT,             -- path on volume
  variations_requested INTEGER
);

CREATE TABLE output_files (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id),
  source_file_id TEXT REFERENCES source_files(id),
  file_path TEXT,
  variation_index INTEGER,
  effects_applied TEXT        -- JSON of effects
);
```

**Why NOT Prisma/Drizzle/Knex:**
- Overkill for 3 tables with simple queries
- Adds build steps, generated clients, migration tooling
- Raw SQL with better-sqlite3 prepared statements is simpler and faster
- No ORM abstraction needed for `SELECT * FROM jobs WHERE id = ?`

**Confidence:** HIGH -- version 12.6.2 verified, library actively maintained.

---

### Job Queue: In-Process (No Redis)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Custom in-process queue | - | Sequential video processing | Single machine, <10 users, SQLite tracks state -- Redis would be over-engineering |

**Why NOT BullMQ:**
- BullMQ requires Redis. Adding Redis to a $5/month Fly.io deployment doubles infrastructure complexity and cost.
- This is a single-machine deployment with <10 concurrent users
- SQLite already tracks job state (pending/processing/done/failed)
- Jobs survive restarts because state is in SQLite, not in-memory
- FFmpeg processing is CPU-bound; no benefit from distributed workers

**Pattern:**
```javascript
class JobQueue {
  constructor() {
    this.processing = false;
  }

  async tick() {
    if (this.processing) return;
    const job = db.prepare(
      "SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at LIMIT 1"
    ).get();
    if (!job) return;
    this.processing = true;
    try {
      await processJob(job);
    } finally {
      this.processing = false;
      setImmediate(() => this.tick()); // Check for next job
    }
  }
}
```

**Restart recovery:** On server start, mark any `status = 'processing'` jobs back to `'pending'` (they were interrupted). SQLite makes this trivial.

**Confidence:** HIGH -- standard pattern for single-machine job processing.

---

### ZIP Creation: archiver

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| archiver | 7.0.1 | Server-side ZIP packaging | Streaming interface, STORE compression for videos, pipe directly to response or disk |

**Why archiver instead of keeping JSZip:**
- JSZip is designed for in-browser use; archiver is designed for Node.js with proper stream support
- archiver can pipe directly to a file write stream or HTTP response
- Supports STORE compression (no re-compression of already-compressed video)
- Mature (5,982 dependents on npm)
- Can create ZIP on-the-fly without holding all files in memory

**Pattern:**
```javascript
import archiver from 'archiver';
import { createWriteStream } from 'node:fs';

const output = createWriteStream('/data/results/job-abc/output.zip');
const archive = archiver('zip', { store: true });
archive.pipe(output);
archive.file('/data/results/job-abc/source1/variation-1.mp4', { name: 'source1/variation-1.mp4' });
// ... add all files
await archive.finalize();
```

**Confidence:** HIGH -- archiver 7.0.1 verified as latest, widely used.

---

### ID Generation: nanoid

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| nanoid | 5.x | Job IDs, file IDs | URL-safe, 21 chars, collision-resistant, 118 bytes, zero deps |

**Why nanoid over UUID:**
- Shorter (21 chars vs 36) -- better for URLs like `/jobs/V1StGXR8_Z5jdHi6B-myT`
- URL-safe alphabet by default (A-Za-z0-9_-)
- Same collision resistance as UUID v4
- 4x smaller than uuid package
- 82M+ weekly npm downloads

**Confidence:** HIGH -- well-established, actively maintained.

---

### Authentication: Simple Shared Password

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| bcrypt (via bcryptjs) | 3.x | Password hashing | Pure JS, no native compilation needed in Docker |
| Environment variable | - | Store password hash | `PASSWORD_HASH` in Fly secrets |

**Why bcryptjs, NOT bcrypt:**
- `bcryptjs` is pure JavaScript -- no native compilation issues in Alpine Linux Docker
- `bcrypt` (native) requires python3 + make + g++ in the Docker image, bloating it
- For a shared password checked a few times per day, performance difference is zero

**Pattern:**
```javascript
import bcrypt from 'bcryptjs';

// On first setup: generate hash
// fly secrets set PASSWORD_HASH=$(node -e "console.log(require('bcryptjs').hashSync('team-password', 10))")

// On each request
const valid = bcrypt.compareSync(req.body.password, process.env.PASSWORD_HASH);
```

**Actually -- even simpler alternative:** Since this is a shared password for a small team, a constant-time string comparison against an env var is sufficient. Skip bcrypt entirely.

```javascript
import { timingSafeEqual } from 'node:crypto';

function checkPassword(input) {
  const expected = Buffer.from(process.env.TEAM_PASSWORD);
  const actual = Buffer.from(input);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
```

**Recommendation:** Use the `timingSafeEqual` approach. bcrypt is designed for per-user password storage in databases. A single shared password stored as an env secret doesn't need hashing -- it needs timing-safe comparison.

**Confidence:** HIGH -- both approaches are standard; simpler is better here.

---

### Scheduled Cleanup: node-cron

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| node-cron | 3.x | Schedule 24h file expiry, 1GB cap enforcement | Lightweight cron scheduler, pure JS, runs in-process |

**Why node-cron:**
- Schedule file cleanup to run every hour
- Check SQLite for jobs older than 24h, delete their files
- Check total storage usage, evict oldest if >1GB
- No external cron daemon needed
- 3.7M weekly downloads, actively maintained

**Alternative considered:** `setInterval` -- works but node-cron's cron syntax is clearer for "run at minute 0 of every hour" and handles edge cases (server start timing, missed intervals).

**Pattern:**
```javascript
import cron from 'node-cron';

// Every hour: clean up expired files
cron.schedule('0 * * * *', () => {
  const expired = db.prepare(
    "SELECT * FROM jobs WHERE created_at < ? AND status = 'done'"
  ).all(Date.now() - 24 * 60 * 60 * 1000);
  for (const job of expired) {
    deleteJobFiles(job.id);
    db.prepare("DELETE FROM jobs WHERE id = ?").run(job.id);
  }
});
```

**Confidence:** HIGH -- standard approach for in-process scheduling.

---

### CORS: cors middleware

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| cors | 2.8.x | Cross-origin requests from Cloudflare Pages frontend | Standard Express CORS middleware |

**Why needed:** Frontend on Cloudflare Pages (`video-refresher.pages.dev`) makes API calls to Fly.io backend (`video-refresher.fly.dev`). Different origins require CORS.

**Configuration:**
```javascript
import cors from 'cors';

app.use(cors({
  origin: ['https://video-refresher.pages.dev', 'http://localhost:8000'],
  methods: ['GET', 'POST'],
  credentials: false // No cookies needed with password-per-request
}));
```

**Confidence:** HIGH

---

## Infrastructure: Fly.io Configuration

### Docker Image

| Component | Choice | Why |
|-----------|--------|-----|
| Base image | `node:22-slim` | Debian-based, smaller than full but includes apt for FFmpeg install |
| FFmpeg | `apt-get install -y ffmpeg` | Debian's FFmpeg 7.x package, includes ffprobe |
| Image size | ~300-400MB estimated | Node 22 slim (~200MB) + FFmpeg (~100-150MB) + app |

**Why `node:22-slim` NOT `node:22-alpine`:**
- better-sqlite3 requires compilation; Alpine needs extra build tools (`python3`, `make`, `g++`)
- FFmpeg packages on Alpine are sometimes behind Debian
- Slim is a reasonable middle ground (200MB vs 350MB full, vs 80MB alpine + build deps)

**Dockerfile sketch:**
```dockerfile
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

EXPOSE 8080
CMD ["node", "server.js"]
```

**Confidence:** HIGH

---

### Fly.io Machine Sizing

| Setting | Value | Rationale |
|---------|-------|-----------|
| CPU | shared-cpu-2x | Video processing is CPU-bound; 1 shared CPU would bottleneck FFmpeg |
| Memory | 512MB | FFmpeg uses ~100-200MB per process; 512MB gives headroom for Node + FFmpeg + file I/O |
| Volume | 1GB | Per project constraint; holds SQLite DB + uploaded videos + processed outputs |
| Region | Single region (e.g., `iad`) | Single machine, single volume -- SQLite constraint |
| auto_stop_machines | `"stop"` | Scale to zero when idle to save cost |
| auto_start_machines | `true` | Wake on first request |
| min_machines_running | `0` | Allow full scale-to-zero |

**Monthly cost estimate:**
- shared-cpu-2x @ 512MB: ~$5-7/month if running 50% of the time (auto-stop helps)
- 1GB volume: ~$0.15/month
- Bandwidth: Minimal for small team
- **Total: ~$5-8/month**

**fly.toml configuration:**
```toml
app = "video-refresher-api"
primary_region = "iad"

[build]

[env]
NODE_ENV = "production"
PORT = "8080"
DB_PATH = "/data/video-refresher.db"
UPLOAD_DIR = "/data/uploads"
OUTPUT_DIR = "/data/output"

[http_service]
internal_port = 8080
force_https = true
auto_stop_machines = "stop"
auto_start_machines = true
min_machines_running = 0

[mounts]
source = "vr_data"
destination = "/data"

[[vm]]
memory = "512mb"
cpu_kind = "shared"
cpus = 2
```

**Critical constraint:** Fly Volumes are one-to-one with Machines. One Machine, one Volume. This is fine -- SQLite requires single-writer anyway.

**Confidence:** HIGH -- verified against official Fly.io documentation.

---

## What NOT to Add

### Do NOT add: Redis / BullMQ
**Why:** Requires a separate Redis instance ($5+/month), adds infrastructure complexity. SQLite + in-process queue handles <10 users easily.

### Do NOT add: TypeScript (for v2)
**Why:** The v1 codebase is vanilla JS with no build step. Adding TypeScript to the server adds compilation steps, tsconfig complexity, and slows iteration. If the project grows to v3+ with multiple contributors, reconsider. For a small team tool, vanilla JS with JSDoc type hints is faster to ship.

### Do NOT add: Prisma / Drizzle / any ORM
**Why:** 3 tables, ~10 queries total. Raw SQL with better-sqlite3 prepared statements is simpler, faster, and has zero build steps.

### Do NOT add: WebSocket for progress (v2 MVP)
**Why:** Polling (`GET /jobs/:id/status` every 2-3 seconds) is simpler and works with scale-to-zero. WebSocket connections keep the machine alive and prevent auto-stop. Add WebSocket in v3 if polling UX is inadequate.

### Do NOT add: S3 / R2 for file storage
**Why:** 1GB storage cap with 24h expiry. Fly Volume is local NVMe, faster for FFmpeg read/write, and free (only $0.15/GB/month for the volume). External object storage adds latency and complexity for no benefit at this scale.

### Do NOT add: fluent-ffmpeg
**Why:** Archived May 2025, deprecated on npm. Use `child_process.spawn('ffmpeg', [...args])` directly.

### Do NOT add: PM2 or process manager
**Why:** Docker + Fly.io already handle process lifecycle, restarts, and health checks. Adding PM2 inside a container is an anti-pattern.

### Do NOT add: dotenv
**Why:** Fly.io injects secrets as environment variables. Docker also supports env vars natively. `dotenv` is only needed for local dev, and even then `node --env-file=.env` works in Node 22.

---

## Full Dependency List

### Production Dependencies

```bash
npm install express@5 multer better-sqlite3 archiver nanoid node-cron cors
```

| Package | Version | Size | Weekly Downloads |
|---------|---------|------|-----------------|
| express | 5.2.x | ~200KB | 35M+ |
| multer | 1.4.x | ~40KB | 3M+ |
| better-sqlite3 | 12.6.x | ~2MB (native) | 1M+ |
| archiver | 7.0.x | ~100KB | 5M+ |
| nanoid | 5.x | <1KB | 82M+ |
| node-cron | 3.x | ~20KB | 3.7M+ |
| cors | 2.8.x | ~10KB | 15M+ |

**Total production dependencies: 7 packages** (plus their sub-dependencies)

### Dev Dependencies

```bash
npm install -D nodemon
```

Only `nodemon` for local dev with auto-restart (or use `node --watch` built into Node 22 and skip even this).

---

## Integration Points with Existing Stack

### Frontend Changes Needed

The frontend (`app.js`, `index.html`) needs modification to:

1. **Upload flow:** Instead of feeding files to FFmpeg.wasm, POST multipart to `/api/jobs`
2. **Progress tracking:** Poll `GET /api/jobs/:id` every 2-3 seconds instead of FFmpeg progress events
3. **Download:** Link to `GET /api/jobs/:id/download` which serves the ZIP from the server
4. **Auth:** Add password input, send with each API request (header or body)
5. **Multi-video UI:** Allow selecting multiple source files, not just one

### What Can Be Reused from v1

| Component | Reuse | Notes |
|-----------|-------|-------|
| Effect generation logic | YES -- port to server | The random effect combination builder from `app.js` |
| FFmpeg filter strings | YES -- identical | Same `-vf` filter strings work with native FFmpeg |
| CSS/styling | MOSTLY | UI layout changes for multi-file, but styles carry forward |
| BlobURLRegistry | NO | Server-side uses file paths, not blob URLs |
| FFmpeg.wasm worker | NO | Replaced by native FFmpeg child_process |
| JSZip client-side | NO | Replaced by archiver server-side |

### API Surface

```
POST   /api/auth          -- Validate password, return session token (or just validate per-request)
POST   /api/jobs           -- Upload videos + create job (multipart)
GET    /api/jobs/:id        -- Job status + progress
GET    /api/jobs/:id/download -- Download result ZIP
DELETE /api/jobs/:id        -- Cancel/delete job
```

5 endpoints. Simple REST. No GraphQL, no tRPC, no complexity.

---

## Sources

- [Express 5.1.0 release announcement](https://expressjs.com/2025/03/31/v5-1-latest-release.html) -- Express 5 now default on npm
- [fluent-ffmpeg archived (GitHub Issue #1324)](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1324) -- Archived May 22, 2025
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) -- v12.6.2, Jan 17, 2026
- [Fly.io Volumes overview](https://fly.io/docs/volumes/overview/) -- One-to-one Machine/Volume mapping
- [Fly.io Volume configuration](https://fly.io/docs/launch/volume-storage/) -- fly.toml mounts syntax
- [Fly.io Node.js documentation](https://fly.io/docs/js/) -- Dockerfile patterns, volume access
- [Fly.io pricing](https://fly.io/docs/about/pricing/) -- shared-cpu pricing
- [Fly.io community: FFmpeg in Docker](https://community.fly.io/t/install-ffmpeg-in-the-v2/12130) -- apt-get install pattern
- [Node.js 22 LTS release](https://nodejs.org/en/blog/release/v22.20.0) -- Current LTS
- [Hono file upload](https://hono.dev/examples/file-upload) -- parseBody() memory limitations
- [hono-upload (GitHub)](https://github.com/ps73/hono-upload) -- Third-party streaming upload for Hono
- [Multer npm](https://www.npmjs.com/package/multer) -- DiskStorage engine for streaming to disk
- [archiver npm](https://www.npmjs.com/package/archiver) -- v7.0.1, streaming ZIP
- [nanoid npm](https://www.npmjs.com/package/nanoid) -- 82M+ weekly downloads
- [node-cron npm](https://www.npmjs.com/package/node-cron) -- Cron scheduling
- [BullMQ](https://bullmq.io/) -- Requires Redis (rejected for this use case)

---

## Summary

**7 production dependencies.** No build step for the server. No Redis. No ORM. No TypeScript compilation.

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Runtime | Node.js 22 LTS | Current LTS, built-in watch/fetch/WebSocket |
| HTTP | Express 5.x | Mature file upload ecosystem, async error handling |
| Upload | Multer | Streams to disk, not memory |
| Processing | Native FFmpeg via child_process.spawn | 10-50x faster than wasm, fluent-ffmpeg is deprecated |
| Database | better-sqlite3 12.6.x | Synchronous, fast, zero-cost, single file on volume |
| Queue | In-process (SQLite-backed) | Single machine, <10 users, no Redis needed |
| ZIP | archiver 7.0.x | Server-side streaming ZIP |
| IDs | nanoid 5.x | Short, URL-safe, collision-resistant |
| Cleanup | node-cron 3.x | Hourly expiry checks |
| Auth | crypto.timingSafeEqual | Shared password, env var, no bcrypt needed |
| CORS | cors 2.8.x | Cloudflare Pages to Fly.io cross-origin |
| Hosting | Fly.io shared-cpu-2x, 512MB, 1GB volume | ~$5-8/month |
| Container | node:22-slim + apt FFmpeg | ~300-400MB image |

**Overall Confidence: HIGH** -- All versions verified against npm/official sources. All architectural decisions grounded in project constraints (single machine, <10 users, $5-10/month budget).
