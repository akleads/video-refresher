---
phase: 06
plan: 01
subsystem: api-server
tags: [express, sqlite, auth, backend]
requires: [v1.0]
provides: [express-app, sqlite-db, bearer-auth, health-endpoint]
affects: [06-02, 06-03]
tech-stack:
  added:
    - express@5.2.0
    - better-sqlite3@12.6.0
    - multer@2.0.2
    - nanoid@5.0.0
    - cors@2.8.5
  patterns:
    - ESM modules ("type": "module")
    - HMAC bearer token auth with node:crypto
    - SQLite WAL mode with foreign keys
    - Express 5 async error handling
key-files:
  created:
    - server/package.json
    - server/index.js
    - server/db/index.js
    - server/db/schema.js
    - server/db/queries.js
    - server/lib/token.js
    - server/routes/auth.js
    - server/routes/health.js
    - server/middleware/auth.js
    - server/middleware/error.js
    - server/.env (gitignored)
  modified: []
decisions:
  - id: esm-modules
    choice: Use "type": "module" in package.json for ESM imports
    rationale: nanoid 5 is ESM-only, aligns with Node.js 22 best practices
  - id: hmac-tokens
    choice: HMAC-based bearer tokens instead of JWT
    rationale: No external claims needed, simpler, zero dependencies
  - id: sqlite-wal
    choice: Enable WAL mode on database initialization
    rationale: Allows concurrent reads during writes, prevents SQLITE_BUSY errors
  - id: local-dev-data
    choice: Use ./data directory for local dev instead of /data
    rationale: No Fly Volume in local environment, fallback to relative path
metrics:
  duration: 3m 8s
  tasks_completed: 2/2
  files_created: 11
  commits: 2
completed: 2026-02-07
---

# Phase 06 Plan 01: Server Foundation Summary

**One-liner:** Express 5 API server with SQLite WAL database, HMAC bearer token auth, and health endpoint running on Node.js 22.

## What Was Built

Created the core Express 5 server infrastructure with SQLite database persistence, shared-password authentication using HMAC bearer tokens, and a health check endpoint. The server runs on port 8080 (configurable), uses ESM modules throughout, and validates volume writability on startup.

**Key capabilities delivered:**
- SQLite database with WAL mode, foreign keys, and busy timeout pragmas
- HMAC-based bearer token generation and verification (24-hour expiry)
- Shared password authentication with timing-safe comparison
- Health endpoint returning server status, uptime, and volume mount status
- Express error handler with Multer-specific error code handling
- Volume verification on startup (creates directories, tests writability)
- Local development support with .env file and relative ./data directory

## Tasks Completed

| Task | Description | Files | Commit |
|------|-------------|-------|--------|
| 1 | Server package and database layer | package.json, db/index.js, db/schema.js, db/queries.js | 34b4f73 |
| 2 | Auth system, health route, error handler, Express app | index.js, lib/token.js, routes/, middleware/ | 69df799 |

## Technical Details

### Database Schema
- **jobs table:** id, status, created_at, updated_at, expires_at, total_videos, total_variations, error
- **job_files table:** id, job_id (FK), original_name, upload_path, file_size, status, created_at
- **Indexes:** idx_jobs_status, idx_jobs_expires, idx_job_files_job_id
- **Pragmas:** journal_mode=WAL, busy_timeout=5000, foreign_keys=ON, synchronous=NORMAL

### Authentication Flow
1. Client POSTs password to `/api/auth`
2. Server validates password using `crypto.timingSafeEqual`
3. Server generates HMAC token: `base64url(timestamp:hmac_sha256(timestamp))`
4. Client includes token in `Authorization: Bearer <token>` header
5. `requireAuth` middleware verifies token signature and expiry (24 hours)

### Environment Variables
- `PORT` (default: 8080) - Server listen port
- `DATA_DIR` (default: ./data for local, /data for Fly.io) - Volume mount path
- `DB_PATH` (default: ${DATA_DIR}/video-refresher.db) - SQLite database file
- `UPLOAD_DIR` (default: ${DATA_DIR}/uploads) - Upload storage
- `OUTPUT_DIR` (default: ${DATA_DIR}/output) - Processed video storage
- `AUTH_PASSWORD` (required) - Shared password for authentication
- `TOKEN_SECRET` (optional) - HMAC secret (auto-generated if not set)

### CORS Configuration
- Origins: `https://video-refresher.pages.dev`, `http://localhost:8000`
- Methods: GET, POST, DELETE, OPTIONS
- Headers: Content-Type, Authorization

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

### 1. ESM Modules Throughout
**Context:** nanoid 5 is ESM-only, requires `import` syntax.
**Decision:** Set `"type": "module"` in package.json, use ESM imports for all files.
**Rationale:** Avoids compatibility issues, aligns with Node.js 22 best practices.
**Impact:** All imports use `import` syntax, file extensions required (.js).

### 2. HMAC Tokens Instead of JWT
**Context:** Need bearer token auth for API endpoints.
**Decision:** Use Node.js crypto module to generate HMAC-based tokens.
**Rationale:** No external claims needed, simpler than JWT, zero dependencies.
**Impact:** Token format: `base64url(timestamp:hmac)`, 24-hour expiry.

### 3. SQLite WAL Mode
**Context:** Concurrent API requests need database access.
**Decision:** Enable WAL mode on database initialization.
**Rationale:** Allows concurrent reads during writes, prevents SQLITE_BUSY errors under load.
**Impact:** Database file has -wal and -shm companion files.

### 4. Local Dev Data Directory
**Context:** Local development doesn't have /data volume mount.
**Decision:** Use `./data` as fallback when `DATA_DIR` env var not set.
**Rationale:** Allows local testing without Docker/Fly.io setup.
**Impact:** Created server/.env file with local dev defaults (gitignored).

## Test Results

All verification tests passed:

1. ✓ Health endpoint returns 200 with JSON status
2. ✓ Auth endpoint rejects empty password (400)
3. ✓ Auth endpoint rejects wrong password (401)
4. ✓ Auth endpoint returns bearer token for correct password (200)
5. ✓ Database initializes in WAL mode with jobs and job_files tables
6. ✓ Volume verification creates directories and tests writability
7. ✓ Server starts on port 8080 without errors

## Next Phase Readiness

**Ready for Phase 06-02 (Jobs API):** ✓

The server foundation is complete and ready for the jobs API to be mounted. The database schema, auth middleware, and Express app are all in place.

**Blockers:** None

**Recommendations for 06-02:**
1. Create Multer middleware in server/middleware/upload.js using DiskStorage to UPLOAD_DIR
2. Mount jobs router at /api/jobs with requireAuth middleware
3. Use app.locals.queries for database operations in route handlers
4. Test multi-file upload with Multer file count/size limits

## Files Created

### Core Application
- `server/index.js` - Express 5 app setup, middleware chain, server startup
- `server/package.json` - ESM package with 5 production dependencies

### Database Layer
- `server/db/index.js` - Database initialization with WAL mode and pragmas
- `server/db/schema.js` - CREATE TABLE statements for jobs and job_files
- `server/db/queries.js` - Prepared statement wrappers for CRUD operations

### Authentication
- `server/lib/token.js` - HMAC token generation, verification, password check
- `server/routes/auth.js` - POST /api/auth endpoint
- `server/middleware/auth.js` - Bearer token verification middleware

### Routes and Middleware
- `server/routes/health.js` - GET /api/health endpoint
- `server/middleware/error.js` - Global Express error handler

### Development
- `server/.env` - Local development environment variables (gitignored)

## Metrics

- **Duration:** 3 minutes 8 seconds
- **Tasks completed:** 2/2
- **Files created:** 11
- **Lines of code:** ~270
- **Dependencies installed:** 116 packages (5 direct)
- **Commits:** 2
- **Tests passed:** 7/7

## Dependencies Added

| Package | Version | Purpose |
|---------|---------|---------|
| express | ^5.2.0 | HTTP server and routing |
| better-sqlite3 | ^12.6.0 | SQLite database with WAL mode |
| multer | ^2.0.2 | Multipart file upload (Phase 06-02) |
| nanoid | ^5.0.0 | URL-safe ID generation |
| cors | ^2.8.5 | CORS middleware |

All dependencies are production-ready and up-to-date as of February 2026.
