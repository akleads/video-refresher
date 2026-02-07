# Phase 6: Backend Foundation - Research

**Researched:** 2026-02-07
**Domain:** Express 5 API server, SQLite persistence, shared-password auth, multi-file upload, Docker + Fly.io deployment
**Confidence:** HIGH

## Summary

Phase 6 delivers a running Express 5 API on Fly.io that accepts multi-video uploads, authenticates users with a shared password, and persists job state in SQLite. Processing is stubbed -- the actual FFmpeg pipeline is Phase 7. This phase is infrastructure + API contract + deployment verification.

The standard approach is straightforward: Express 5 with Multer 2.x for disk-streamed uploads, better-sqlite3 for synchronous SQLite access in WAL mode, HMAC-based bearer token auth using Node.js built-in `crypto`, and a single-stage `node:22-slim` Dockerfile deployed to Fly.io with a 3GB persistent volume. The entire server is 7 production dependencies and has no build step.

**Critical update from prior research:** Multer has been upgraded to v2.0.x (released May 2025) which fixes high-severity memory leak vulnerabilities in v1.4.x. The API is backward-compatible -- `diskStorage`, `upload.array()`, and `upload.fields()` work identically. Use Multer 2.0.2+, not 1.4.x. Additionally, nanoid 5.x is ESM-only; the server must use `"type": "module"` in package.json or use `crypto.randomUUID()` instead.

**Primary recommendation:** Use ESM (`"type": "module"`) for the server package.json. This avoids nanoid 5 import issues and aligns with modern Node.js 22 best practices. All dependencies (Express 5, Multer 2, better-sqlite3, cors, nanoid 5) support ESM imports.

## Standard Stack

The established libraries/tools for this phase:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | 5.2.x | HTTP server, API routing | Stable since 5.1.0 (Mar 2025), default on npm, async error handling built-in |
| multer | 2.0.2+ | Multipart file upload | Fixes critical memory leak CVEs in 1.4.x, streams to disk via DiskStorage, Express official middleware |
| better-sqlite3 | 12.6.x | SQLite database | Synchronous API, WAL mode, fastest Node.js SQLite, native addon compiles on node:22-slim |
| nanoid | 5.x | Job/file ID generation | URL-safe, 21-char, collision-resistant. ESM-only -- requires `"type": "module"` |
| cors | 2.8.5 | CORS middleware | Standard Express CORS solution, handles preflight OPTIONS automatically |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:crypto (built-in) | - | HMAC token generation, timingSafeEqual for password check | Auth -- no external dependency needed |
| node:fs (built-in) | - | File system ops, directory creation | Startup checks, file management |
| node:child_process (built-in) | - | FFmpeg spawn (Phase 7, stubbed here) | Stubbed in Phase 6, implemented in Phase 7 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| nanoid | crypto.randomUUID() | UUID is 36 chars vs 21, less URL-friendly. But avoids ESM-only dependency. Use nanoid if going ESM. |
| cors package | Manual CORS headers | cors package handles OPTIONS preflight automatically, edge cases with credentials. Use the package. |
| HMAC tokens | jsonwebtoken (JWT) | JWT adds a dependency for no benefit here -- no claims needed, no third-party verification. HMAC is simpler. |
| better-sqlite3 | node:sqlite (Node.js built-in) | Node.js 22 has experimental built-in SQLite but it is behind `--experimental-sqlite` flag and not production-ready. Use better-sqlite3. |

**Installation:**
```bash
npm install express@5 multer@2 better-sqlite3 nanoid cors
```

**Dev dependencies:**
```bash
# None required -- use node --watch for dev (built into Node 22)
```

## Architecture Patterns

### Recommended Project Structure
```
server/
  index.js              # Express app setup, middleware, listen
  routes/
    auth.js             # POST /api/auth
    jobs.js             # POST /api/jobs, GET /api/jobs/:id, GET /api/jobs
    health.js           # GET /api/health
  middleware/
    auth.js             # Bearer token verification middleware
    upload.js           # Multer configuration (DiskStorage on volume)
    error.js            # Global error handler
  db/
    index.js            # Database initialization, WAL mode, pragmas
    schema.js           # CREATE TABLE statements, migrations
    queries.js          # Prepared statements for jobs, files
  lib/
    token.js            # HMAC token generation and verification
    id.js               # nanoid wrapper for job/file IDs
Dockerfile              # node:22-slim + apt-get ffmpeg
fly.toml                # Fly.io app configuration
.dockerignore           # Exclude frontend files, .planning, .git
```

### Pattern 1: ESM Server with Express 5
**What:** Use `"type": "module"` in the server's package.json, import syntax throughout.
**When to use:** Always for new Node.js 22 projects.
**Example:**
```javascript
// server/index.js
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { jobsRouter } from './routes/jobs.js';
import { healthRouter } from './routes/health.js';
import { errorHandler } from './middleware/error.js';
import { initDatabase } from './db/index.js';

const app = express();
const PORT = process.env.PORT || 8080;

// Initialize database on startup
const db = initDatabase(process.env.DB_PATH || '/data/video-refresher.db');

app.use(cors({
  origin: [
    'https://video-refresher.pages.dev',
    'http://localhost:8000'
  ],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/jobs', jobsRouter(db));
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
```

### Pattern 2: Express 5 Async Error Handling
**What:** Express 5 automatically catches rejected promises in async route handlers. No try-catch wrappers needed.
**When to use:** All async route handlers.
**Example:**
```javascript
// Express 5 -- rejected promises automatically forwarded to error handler
router.post('/', requireAuth, upload.array('videos', 10), async (req, res) => {
  // If this throws, Express 5 catches it and passes to error handler
  const jobId = nanoid();
  // ... create job in SQLite
  res.status(202).json({ jobId, status: 'queued' });
});

// Error handler middleware (4 args)
function errorHandler(err, req, res, next) {
  console.error(err.stack);
  // Handle Multer errors specifically
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large' });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ error: 'Too many files' });
  }
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
}
```

### Pattern 3: Multer 2.x DiskStorage on Fly Volume
**What:** Configure Multer to stream uploads directly to the Fly Volume path, never to `/tmp` or memory.
**When to use:** All file upload endpoints.
**Example:**
```javascript
// server/middleware/upload.js
import multer from 'multer';
import path from 'node:path';
import { nanoid } from 'nanoid';

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${nanoid()}${ext}`);
  }
});

export const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024,  // 500MB per file
    files: 10                       // max 10 files per request
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'video/mp4') {
      cb(null, true);
    } else {
      cb(new Error('Only MP4 files are accepted'), false);
    }
  }
});
```

### Pattern 4: better-sqlite3 Initialization with WAL Mode
**What:** Open SQLite database with WAL mode, busy timeout, and foreign keys enabled immediately.
**When to use:** Database initialization on server startup.
**Example:**
```javascript
// server/db/index.js
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function initDatabase(dbPath) {
  // Ensure directory exists
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);

  // Critical pragmas -- set before any queries
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');  // Safe with WAL mode

  // Run schema migrations
  createTables(db);

  return db;
}
```

### Pattern 5: HMAC Bearer Token Auth (No External Dependencies)
**What:** Generate bearer tokens using Node.js built-in crypto. Password validated via timingSafeEqual.
**When to use:** POST /api/auth and requireAuth middleware.
**Example:**
```javascript
// server/lib/token.js
import crypto from 'node:crypto';

const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export function generateToken() {
  const timestamp = Date.now().toString();
  const hmac = crypto.createHmac('sha256', TOKEN_SECRET)
    .update(timestamp)
    .digest('hex');
  return Buffer.from(`${timestamp}:${hmac}`).toString('base64url');
}

export function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const [timestamp, hmac] = decoded.split(':');
    if (!timestamp || !hmac) return false;

    // Check expiry
    if (Date.now() - parseInt(timestamp) > TOKEN_EXPIRY_MS) return false;

    // Timing-safe HMAC comparison
    const expected = crypto.createHmac('sha256', TOKEN_SECRET)
      .update(timestamp)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(hmac, 'utf8'),
      Buffer.from(expected, 'utf8')
    );
  } catch {
    return false;
  }
}

export function checkPassword(input) {
  const expected = process.env.AUTH_PASSWORD;
  if (!expected || !input) return false;
  if (expected.length !== input.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(input, 'utf8'),
    Buffer.from(expected, 'utf8')
  );
}
```

### Pattern 6: Volume Mount Verification on Startup
**What:** Before accepting any requests, verify the Fly Volume is mounted and writable.
**When to use:** Server startup, before listen().
**Example:**
```javascript
// server/index.js -- startup check
const DATA_DIR = process.env.DATA_DIR || '/data';
const UPLOAD_DIR = `${DATA_DIR}/uploads`;
const OUTPUT_DIR = `${DATA_DIR}/output`;

function verifyVolume() {
  const dirs = [DATA_DIR, UPLOAD_DIR, OUTPUT_DIR];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  // Write test file to verify volume is writable
  const testFile = `${DATA_DIR}/.write-test`;
  try {
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
  } catch (err) {
    console.error(`FATAL: Volume not writable at ${DATA_DIR}:`, err.message);
    process.exit(1);
  }
}
```

### Anti-Patterns to Avoid
- **Memory storage for uploads:** Never use `multer.memoryStorage()` for video files. A 100MB upload consumes 100MB of RAM.
- **Writing to /tmp on Fly.io:** `/tmp` is a RAM disk (tmpfs). Writing videos there eats RAM and causes OOM kills. Always write to the Fly Volume mount path.
- **Long-lived database connections across await:** better-sqlite3 is synchronous, so this is not an issue. But do not wrap better-sqlite3 calls in unnecessary async wrappers.
- **Forgetting CORS preflight:** Browser sends OPTIONS before POST with Authorization header. The cors middleware handles this automatically, but manual CORS setups often miss it.
- **Hardcoding paths:** Use environment variables for DATA_DIR, DB_PATH, UPLOAD_DIR. Fly.io sets these via fly.toml `[env]`; local dev uses `.env` or `--env-file`.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CORS handling | Manual `res.setHeader` calls | `cors` npm package | Handles OPTIONS preflight, origin matching, credentials, and edge cases around null origins |
| Multipart parsing | Manual stream parsing | Multer 2.x with DiskStorage | Handles backpressure, temp file cleanup on error, file count/size limits, content-type validation |
| SQLite connection | Raw `sqlite3` bindings | better-sqlite3 | 10x faster than async sqlite3 package, proper WAL support, prepared statements, synchronous API |
| Password comparison | `===` string comparison | `crypto.timingSafeEqual` | Prevents timing attacks. Even for a shared password, timing-safe comparison is correct practice |
| Unique IDs | `Math.random()` or incrementing int | nanoid or crypto.randomUUID() | URL-safe, collision-resistant, no coordination needed |
| Docker base image | Alpine + build tools | `node:22-slim` | better-sqlite3 native addon requires glibc (not musl). Slim includes what is needed without bloat |

**Key insight:** This phase has zero novel technical challenges. Every component is a well-documented pattern. The risk is in integration (Fly Volume + Multer paths, CORS between Cloudflare Pages and Fly.io, Docker image size) not in individual pieces.

## Common Pitfalls

### Pitfall 1: /tmp is RAM on Fly.io
**What goes wrong:** Multer or FFmpeg writes temporary files to `/tmp`, consuming machine RAM instead of disk.
**Why it happens:** Default behavior on Linux. Developers don't realize Fly.io uses tmpfs for `/tmp`.
**How to avoid:** Set `TMPDIR=/data/tmp` in Dockerfile. Configure Multer destination to `/data/uploads/`. Never use os.tmpdir().
**Warning signs:** OOM kills during upload, memory usage spikes correlated with file size not code allocation.

### Pitfall 2: Multer 1.4.x Memory Leak (CVE-2025-47935)
**What goes wrong:** Multer versions before 2.0.0 have a memory leak caused by improper stream handling when HTTP request errors occur. Unclosed streams accumulate, consuming memory and file descriptors.
**Why it happens:** Using outdated Multer version from old tutorials/examples.
**How to avoid:** Use Multer 2.0.2+ exclusively. The API is backward-compatible with 1.4.x.
**Warning signs:** Server memory growing over time, file descriptor exhaustion, server restart needed periodically.

### Pitfall 3: nanoid 5 ESM-Only Import Error
**What goes wrong:** `require('nanoid')` throws `ERR_REQUIRE_ESM` because nanoid 5 is ESM-only.
**Why it happens:** Many Express tutorials use CommonJS (`require`). nanoid 5 dropped CJS support.
**How to avoid:** Use `"type": "module"` in package.json and `import { nanoid } from 'nanoid'`. Alternative: use `crypto.randomUUID()` which works in both CJS and ESM.
**Warning signs:** Application fails to start with `ERR_REQUIRE_ESM` error.

### Pitfall 4: SQLite "Database is Locked" Under Concurrent Reads/Writes
**What goes wrong:** Multiple concurrent API requests (upload + status poll + another upload) hit SQLite simultaneously. Without WAL mode, readers block writers.
**Why it happens:** Default SQLite journal mode serializes reads and writes.
**How to avoid:** Enable WAL mode immediately: `db.pragma('journal_mode = WAL')`. Set busy timeout: `db.pragma('busy_timeout = 5000')`. Keep write transactions short.
**Warning signs:** `SQLITE_BUSY` errors, status polling returning 500 errors intermittently.

### Pitfall 5: Auto-Stop Kills Machine While Job is Queued
**What goes wrong:** User uploads files, job is created as "queued", user closes browser. Fly.io sees no active HTTP connections and stops the machine. Job never processes.
**Why it happens:** `auto_stop_machines = "stop"` monitors HTTP connections, not background state.
**How to avoid:** Set `min_machines_running = 1` in fly.toml. This keeps one machine always alive in the primary region. Cost is ~$3-5/month instead of ~$1/month.
**Warning signs:** Jobs stay in "queued" state indefinitely, machine logs show stop/start cycles.

### Pitfall 6: Volume Not Created Before First Deploy
**What goes wrong:** `fly deploy` runs but the app crashes because no volume exists at `/data`.
**Why it happens:** The volume must be created before (or during) the first deploy. `fly deploy` does not auto-create volumes.
**How to avoid:** Use `initial_size` in fly.toml mounts section, which auto-creates the volume on first deploy. Or manually create: `fly volumes create vr_data -s 3 -r iad` before deploying.
**Warning signs:** App crashes immediately on startup with "ENOENT /data/..." errors.

### Pitfall 7: Docker Build Fails for better-sqlite3
**What goes wrong:** `npm ci` fails when compiling better-sqlite3's native addon. Missing build tools in Docker image.
**Why it happens:** better-sqlite3 requires a C++ compiler to build its native SQLite binding. Alpine images need extra packages.
**How to avoid:** Use `node:22-slim` (Debian-based), which includes `python3`, `make`, and `g++` needed for native addon compilation. If using a production-only image, install `build-essential` before `npm ci`, then remove it.
**Warning signs:** `npm ci` fails with "gyp ERR!" or "g++ not found" during Docker build.

## Code Examples

Verified patterns from official sources and project-specific requirements:

### SQLite Schema for Phase 6
```sql
-- server/db/schema.js
-- Run on database initialization

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  total_videos INTEGER NOT NULL DEFAULT 0,
  total_variations INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS job_files (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  upload_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_expires ON jobs(expires_at);
CREATE INDEX IF NOT EXISTS idx_job_files_job_id ON job_files(job_id);
```

### Health Check Endpoint
```javascript
// server/routes/health.js
import { Router } from 'express';
import fs from 'node:fs';

export const healthRouter = Router();

healthRouter.get('/', (req, res) => {
  const dataDir = process.env.DATA_DIR || '/data';
  const volumeMounted = fs.existsSync(dataDir);

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    volumeMounted,
    nodeVersion: process.version,
    uptime: Math.floor(process.uptime())
  });
});
```

### Auth Route (Password to Bearer Token)
```javascript
// server/routes/auth.js
import { Router } from 'express';
import { checkPassword, generateToken } from '../lib/token.js';

export const authRouter = Router();

authRouter.post('/', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }
  if (!checkPassword(password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = generateToken();
  res.json({ token });
});
```

### Auth Middleware
```javascript
// server/middleware/auth.js
import { verifyToken } from '../lib/token.js';

export function requireAuth(req, res, next) {
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

### Job Creation Endpoint (Upload + SQLite Insert)
```javascript
// server/routes/jobs.js -- POST handler
router.post('/', requireAuth, upload.array('videos', 10), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No video files uploaded' });
  }

  const jobId = nanoid();
  const variationsPerVideo = parseInt(req.body.variations) || 5;

  // Insert job
  db.prepare(`
    INSERT INTO jobs (id, status, total_videos, total_variations, expires_at)
    VALUES (?, 'queued', ?, ?, datetime('now', '+24 hours'))
  `).run(jobId, req.files.length, req.files.length * variationsPerVideo);

  // Insert file records
  const insertFile = db.prepare(`
    INSERT INTO job_files (id, job_id, original_name, upload_path, file_size, status)
    VALUES (?, ?, ?, ?, ?, 'queued')
  `);

  const files = req.files.map(f => {
    const fileId = nanoid();
    insertFile.run(fileId, jobId, f.originalname, f.path, f.size);
    return { id: fileId, name: f.originalname, size: f.size };
  });

  res.status(202).json({
    jobId,
    status: 'queued',
    files,
    variationsPerVideo,
    totalVariations: req.files.length * variationsPerVideo,
    statusUrl: `/api/jobs/${jobId}`
  });
});
```

### Job Status Endpoint
```javascript
// server/routes/jobs.js -- GET handler
router.get('/:id', requireAuth, (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const files = db.prepare('SELECT * FROM job_files WHERE job_id = ?').all(req.params.id);

  res.json({
    jobId: job.id,
    status: job.status,
    totalVideos: job.total_videos,
    totalVariations: job.total_variations,
    files: files.map(f => ({
      id: f.id,
      name: f.original_name,
      size: f.file_size,
      status: f.status
    })),
    createdAt: job.created_at,
    expiresAt: job.expires_at,
    error: job.error
  });
});
```

### Dockerfile
```dockerfile
FROM node:22-slim

# Install FFmpeg (needed for Phase 7, but install now to verify Docker works)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Set TMPDIR to volume path (avoid /tmp RAM disk on Fly.io)
ENV TMPDIR=/data/tmp

WORKDIR /app

# Copy package files and install dependencies
COPY server/package.json server/package-lock.json* ./
RUN npm ci --production

# Copy server code
COPY server/ .

# Verify FFmpeg is accessible
RUN ffmpeg -version > /dev/null 2>&1

EXPOSE 8080

CMD ["node", "index.js"]
```

### fly.toml
```toml
app = "video-refresher-api"
primary_region = "iad"
kill_signal = "SIGTERM"
kill_timeout = 30

[build]

[env]
  NODE_ENV = "production"
  PORT = "8080"
  DATA_DIR = "/data"
  DB_PATH = "/data/video-refresher.db"
  UPLOAD_DIR = "/data/uploads"
  OUTPUT_DIR = "/data/output"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 1

[[http_service.checks]]
  grace_period = "10s"
  interval = "30s"
  timeout = "5s"
  method = "GET"
  path = "/api/health"

[mounts]
  source = "vr_data"
  destination = "/data"
  initial_size = "3GB"

[[vm]]
  memory = "512MB"
  cpu_kind = "shared"
  cpus = 2
```

### .dockerignore
```
.git
.gitignore
.planning
node_modules
*.md
README*
DEPLOYMENT*
server.py
wrangler.toml
_headers
_redirects
app.js
index.html
styles.css
ffmpeg-worker.js
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Multer 1.4.x | Multer 2.0.2+ | May 2025 | Must upgrade -- 1.4.x has critical memory leak CVEs |
| Express 4.x | Express 5.2.x | Mar 2025 (5.1 = default) | Async error handling built-in, no asyncHandler wrapper needed |
| fluent-ffmpeg | child_process.spawn | May 2025 (archived) | Do not use fluent-ffmpeg for new projects |
| CommonJS `require()` | ESM `import` | Node.js 22 stable | nanoid 5 requires ESM. Node 22 supports `require()` of ESM but ESM-first is cleaner |
| dotenv | node --env-file | Node.js 22 | No dotenv package needed for local dev |

**Deprecated/outdated:**
- Multer 1.4.x: Critical CVEs (CVE-2025-47935, CVE-2025-48997). Use 2.0.2+.
- fluent-ffmpeg: Archived May 2025. Use child_process.spawn.
- `node:sqlite` (built-in): Experimental, behind `--experimental-sqlite` flag. Not production-ready. Use better-sqlite3.

## Open Questions

Things that could not be fully resolved:

1. **Multer 2.0 API surface**
   - What we know: Multer 2.0 fixes security vulnerabilities. The README shows the same API (diskStorage, upload.array, upload.fields). Minimum Node.js version is 10.16.0.
   - What is unclear: Whether there are any subtle behavioral changes in stream handling or error codes. The GitHub releases page does not document breaking API changes beyond the Node.js minimum version bump.
   - Recommendation: Use Multer 2.0.2+. Test upload error scenarios (oversized file, wrong content type, connection drop) to verify behavior matches expectations.

2. **Fly.io volume auto-creation via initial_size**
   - What we know: `initial_size` in fly.toml `[mounts]` creates the volume on first deploy. Community discussion confirms this works.
   - What is unclear: Whether `initial_size` creates the volume only on the very first deploy or on every deploy where no volume exists. Edge case: what happens if the volume is deleted and app is re-deployed.
   - Recommendation: Use `initial_size = "3GB"` in fly.toml. If it does not auto-create, fall back to manual `fly volumes create vr_data -s 3 -r iad`.

3. **better-sqlite3 compilation on node:22-slim**
   - What we know: better-sqlite3 requires native compilation. `node:22-slim` is Debian-based and should include necessary build tools. Prior research confirms this works.
   - What is unclear: Whether `node:22-slim` includes all required build dependencies (`python3`, `make`, `g++`) out of the box, or if `build-essential` needs to be installed.
   - Recommendation: If `npm ci` fails in Docker build, add `RUN apt-get update && apt-get install -y build-essential` before the `npm ci` step. The prebuilt binary may also work via `node-pre-gyp`.

4. **Server package.json location**
   - What we know: The project root has a package.json for the frontend (v1 client-side app). The server needs its own package.json with `"type": "module"` and server dependencies.
   - What is unclear: Whether to put the server package.json in `server/` subdirectory or in the project root (overwriting the existing one).
   - Recommendation: Create `server/package.json` as a separate package. The Dockerfile COPY context is the `server/` directory. The root package.json remains for the frontend/deployment. This keeps frontend and backend cleanly separated.

## Sources

### Primary (HIGH confidence)
- [Express 5.1.0 release -- now default on npm](https://expressjs.com/2025/03/31/v5-1-latest-release.html) -- Express 5 stable status
- [Express 5 error handling docs](https://expressjs.com/en/guide/error-handling.html) -- async promise forwarding
- [Multer GitHub releases](https://github.com/expressjs/multer/releases) -- v2.0.0 security fixes, v2.0.2 latest
- [Express May 2025 Security Releases](https://expressjs.com/2025/05/19/security-releases.html) -- Multer CVE details
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) -- v12.6.x, WAL mode documentation
- [nanoid GitHub](https://github.com/ai/nanoid) -- ESM-only in v5, require() works in Node 22.12+
- [Fly.io app configuration reference](https://fly.io/docs/reference/configuration/) -- fly.toml options, kill_timeout, mounts, vm, http_service
- [Fly.io volumes create command](https://fly.io/docs/flyctl/volumes-create/) -- volume creation with size flag
- [Fly.io autostop/autostart](https://fly.io/docs/launch/autostop-autostart/) -- min_machines_running behavior
- [Fly.io volume storage guide](https://fly.io/docs/launch/volume-storage/) -- mounts configuration, initial_size
- [Fly.io health checks](https://fly.io/docs/reference/health-checks/) -- http_service.checks configuration
- [Node.js crypto documentation](https://nodejs.org/api/crypto.html) -- timingSafeEqual, createHmac

### Secondary (MEDIUM confidence)
- [Fly.io community: initial_size clarification](https://community.fly.io/t/clarification-on-volume-initial-size-and-scaling-up/24614) -- volume auto-creation on first deploy
- [Fly.io community: /tmp is RAM disk](https://community.fly.io/t/tmp-storage-and-small-volumes/9854) -- tmpfs behavior
- [Multer 2.0 breaking changes issue](https://github.com/expressjs/multer/issues/1160) -- API compatibility discussion

### Tertiary (LOW confidence)
- better-sqlite3 compilation on node:22-slim -- expected to work based on Debian toolchain, but not explicitly verified in a Fly.io Docker build for this exact combination

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all versions verified against npm/GitHub, Multer upgrade to 2.0.x confirmed
- Architecture: HIGH -- patterns are standard Express 5 + SQLite, verified against official docs
- Pitfalls: HIGH -- Fly.io-specific issues verified via official docs and community posts
- Deployment: HIGH -- fly.toml configuration verified against official reference docs

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (30 days -- stable ecosystem, no expected breaking changes)
